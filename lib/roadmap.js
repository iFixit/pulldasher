import db from './db.js';
import { loadProjects, projectSettings } from './projects.js';
import {
   dayStart,
   isUnderWay,
   mondayOf,
   moveBefore,
   planLately,
   utcDay,
} from '../shared/dist/index.js';

/**
 * The roadmap's storage: one row per planned item in `roadmap_items`, the
 * one thing in the Projects tab Pulldasher keeps itself rather than reading
 * off GitHub (a plan's start, length and order have nowhere to live there).
 * The shared model (shared/model/roadmap.ts) owns the item's shape and the
 * checks on what a person sends; this file only reads and writes rows.
 */

// DATE_FORMAT keeps `start` a plain YYYY-MM-DD string: mysql2 would hand a
// DATE back as a Date at the server's local midnight, and every later step
// would have to undo that
const COLUMNS =
   "`id`, `name`, `project`, `team`, `lead_login`, `status`, `origin`, DATE_FORMAT(`start`, '%Y-%m-%d') AS `start`, " +
   '`weeks`, `end_kind`, `done_when`, `priority`, `notes`, `waits_on`, `updated_by`, `updated_at`, ' +
   '`created_at`, `status_at`';

const UPDATE_COLUMNS =
   "`id`, `item_id`, `health`, `body`, DATE_FORMAT(`plan_start`, '%Y-%m-%d') AS `plan_start`, " +
   '`plan_weeks`, `created_by`, `created_at`';

/** A roadmap_updates row as the wire's RoadmapUpdate. */
export function updateFromRow(row) {
   return {
      id: Number(row.id),
      item_id: Number(row.item_id),
      health: row.health,
      body: row.body || '',
      plan_start: row.plan_start,
      plan_weeks: Number(row.plan_weeks),
      author: row.created_by,
      at: Number(row.created_at),
   };
}

/** A roadmap_items row as the wire's RoadmapItem, with its latest update. */
export function itemFromRow(row, update = null) {
   return {
      id: Number(row.id),
      name: row.name,
      project: row.project || null,
      team: row.team || null,
      lead: row.lead_login || null,
      status: row.status,
      origin: row.origin || null,
      start: row.start,
      weeks: Number(row.weeks),
      // the column's default: a plan is an estimate until someone commits
      end_kind: row.end_kind || 'soft',
      done_when: row.done_when || '',
      priority: Number(row.priority),
      notes: row.notes || '',
      // stored as "3,7": a short list of ids, read back as numbers
      waits_on: row.waits_on ? String(row.waits_on).split(',').map(Number) : [],
      updated_by: row.updated_by || null,
      updated_at: row.updated_at == null ? null : Number(row.updated_at),
      created_at: row.created_at == null ? null : Number(row.created_at),
      status_at: row.status_at == null ? null : Number(row.status_at),
      update,
   };
}

// the wire's field names to the table's (only the lead differs: LEAD is a
// reserved word in MySQL 8)
const COLUMN_OF = {
   name: 'name',
   project: 'project',
   team: 'team',
   lead: 'lead_login',
   status: 'status',
   origin: 'origin',
   start: 'start',
   weeks: 'weeks',
   end_kind: 'end_kind',
   done_when: 'done_when',
   notes: 'notes',
   waits_on: 'waits_on',
};

/** A field's value as its column stores it. */
function toColumn(key, value) {
   return key === 'waits_on' ? (value.length ? value.join(',') : null) : value;
}

// a removed item keeps its row (and its updates) until someone puts it back
const LIVE = '`removed_at` IS NULL';

/** Every item on the roadmap, in priority order (lowest first), oldest first
 * on a tie, each with its latest update. A removed item stays in the lists
 * of what others wait on, so putting it back brings those back too; until
 * then it's left out of them. */
export async function listItems() {
   const [rows, latest] = await Promise.all([
      db.query(
         `SELECT ${COLUMNS} FROM \`roadmap_items\` WHERE ${LIVE} ORDER BY \`priority\`, \`id\``
      ),
      db.query(
         `SELECT ${UPDATE_COLUMNS} FROM \`roadmap_updates\` WHERE \`id\` IN ` +
            '(SELECT MAX(`id`) FROM `roadmap_updates` GROUP BY `item_id`)'
      ),
   ]);
   const byItem = new Map(latest.map(r => [Number(r.item_id), updateFromRow(r)]));
   const live = new Set(rows.map(r => Number(r.id)));
   return rows.map(row => {
      const item = itemFromRow(row, byItem.get(Number(row.id)) ?? null);
      return { ...item, waits_on: item.waits_on.filter(other => live.has(other)) };
   });
}

/** One item with its latest update; null when there's no such item, or it
 * was removed.
 * ponytail: reads the whole roadmap, which is what hides removed items from
 * its waits_on; a query of its own if the roadmap grows past a few hundred. */
export async function getItem(id) {
   return (await listItems()).find(i => i.id === id) ?? null;
}

/** An item's updates, newest first. */
export async function listUpdates(itemId, limit = 200) {
   const rows = await db.query(
      `SELECT ${UPDATE_COLUMNS} FROM \`roadmap_updates\` WHERE \`item_id\` = ? ORDER BY \`id\` DESC LIMIT ?`,
      [itemId, limit]
   );
   return rows.map(updateFromRow);
}

/**
 * Post an update on an item, keeping the plan as it stands now beside it.
 * Null when there's no such item (or it was removed).
 */
export async function addUpdate(itemId, fields, login, now = Math.floor(Date.now() / 1000)) {
   const rows = await db.query(
      "SELECT DATE_FORMAT(`start`, '%Y-%m-%d') AS `start`, `weeks` FROM `roadmap_items` " +
         `WHERE \`id\` = ? AND ${LIVE}`,
      [itemId]
   );
   if (!rows.length) return null;
   const row = {
      item_id: itemId,
      health: fields.health,
      body: fields.body,
      plan_start: rows[0].start,
      plan_weeks: Number(rows[0].weeks),
      created_by: login,
      created_at: now,
   };
   const result = await db.query('INSERT INTO `roadmap_updates` SET ?', [row]);
   return updateFromRow({ id: result.insertId, ...row });
}

/**
 * Take back an update its author posted: the Undo beside a post. Someone
 * else's update is theirs to take back, not this login's. Hands back the
 * item's latest update now, the one before it (null with none):
 * `{ missing: true }` when the item has no such update, `{ notYours: true }`
 * when another login posted it.
 */
export async function deleteUpdate(itemId, updateId, login) {
   const [row] = await db.query(
      'SELECT `created_by` FROM `roadmap_updates` WHERE `id` = ? AND `item_id` = ?',
      [updateId, itemId]
   );
   if (!row) return { missing: true };
   // GitHub logins ignore case
   if (String(row.created_by).toLowerCase() !== String(login).toLowerCase()) {
      return { notYours: true };
   }
   await db.query('DELETE FROM `roadmap_updates` WHERE `id` = ?', [updateId]);
   const [latest] = await listUpdates(itemId, 1);
   return { latest: latest ?? null };
}

/** GitHub's Priority field's options, most urgent first, as the issues table
 * keeps them (lowercased); the roadmap writes them back (lib/issue-fields.js). */
const PRIORITIES = ['urgent', 'high', 'medium', 'low'];
const rankOf = priority => PRIORITIES.indexOf(String(priority ?? '').toLowerCase());

/**
 * Add an item. Fields the person didn't send get the plan a blank item
 * starts with: planned, four weeks from this week's Monday, a soft end (an
 * estimate: a commitment is a call someone makes), at the bottom.
 * A plan for a project takes what its project's issue says on GitHub
 * instead: its Start date field's week, when no start was sent, and a place
 * by its Priority field, just above the first plan under way whose own
 * issue says a lower one (plans whose issue says none keep their places).
 * The dummy board's twin is model/roadmapData.ts.
 */
export async function createItem(fields, login, now = Math.floor(Date.now() / 1000)) {
   const settings = fields.project ? projectSettings() : null;
   const projects = settings ? await loadProjects(settings) : [];
   const fieldsOf = slug => projects.find(p => p.slug === slug)?.fields ?? null;
   const issue = fieldsOf(fields.project);
   const start = issue?.start && dayStart(issue.start) != null ? issue.start : utcDay(now);
   const item = {
      project: null,
      team: null,
      lead: null,
      status: 'planned',
      origin: null,
      start: mondayOf(start),
      weeks: 4,
      end_kind: 'soft',
      done_when: '',
      notes: '',
      waits_on: [],
      ...fields,
   };
   const [{ top }] = await db.query('SELECT MAX(`priority`) AS `top` FROM `roadmap_items`');
   const row = {};
   for (const [key, column] of Object.entries(COLUMN_OF)) row[column] = toColumn(key, item[key]);
   row.priority = top == null ? 0 : Number(top) + 1;
   row.created_by = row.updated_by = login;
   row.created_at = row.updated_at = row.status_at = now;
   const { insertId: id } = await db.query('INSERT INTO `roadmap_items` SET ?', [row]);
   const rank = rankOf(issue?.priority);
   if (rank >= 0) {
      const items = await listItems();
      const below = items.find(
         i => i.id !== id && isUnderWay(i.status) && rankOf(fieldsOf(i.project)?.priority) > rank
      );
      // someone else adding a plan at the same moment leaves this one at the bottom
      if (below) await reorderItems(moveBefore(items.map(i => i.id), id, below.id));
   }
   return getItem(id);
}

/**
 * What each project did lately, by slug (shared/model/roadmap.ts
 * planLately), for the items the roadmap sends: from Today (lib/projects.js
 * todayFromBoard), its merges, its open PRs by stage, how many more are open
 * than two weeks ago and how old they are, and its newest PR activity; from
 * `pace`, its issues' pace by slug, which a project with no end (`ongoing`)
 * goes without, having no finish to forecast. The dummy board's twin is
 * model/roadmapData.ts.
 */
export function latelyBySlug(today, pace, ongoing, now = Date.now() / 1000) {
   const out = new Map();
   for (const g of [...today.live, ...today.quiet]) {
      out.set(g.slug, planLately(g, ongoing.has(g.slug) ? null : pace[g.slug] ?? null, now));
   }
   return out;
}

/**
 * Change only the fields sent, and say who did. A change of status says when
 * too (status_at), so when a plan stopped doesn't move with a later edit; a
 * status sent as it already was isn't a change, unless `restate` says the
 * person made that call again (Decide's Finish on a plan already done, which
 * accepts the PRs that came after). `undo` puts back the times a call
 * replaced, so Decide's Undo leaves the plan as if the call never happened:
 * stamped now, a call it undid would count as answered. Null when there's no
 * such item, or it was removed.
 */
export async function updateItem(
   id,
   fields,
   login,
   { now = Math.floor(Date.now() / 1000), restate = false, undo = null } = {}
) {
   const row = { updated_by: login, updated_at: undo ? undo.updated_at : now };
   for (const [key, value] of Object.entries(fields)) {
      if (COLUMN_OF[key]) row[COLUMN_OF[key]] = toColumn(key, value);
   }
   if (undo) row.status_at = undo.status_at;
   else if (fields.status) {
      const [was] = await db.query('SELECT `status` FROM `roadmap_items` WHERE `id` = ?', [id]);
      if (was && (was.status !== fields.status || restate)) row.status_at = now;
   }
   const result = await db.query(`UPDATE \`roadmap_items\` SET ? WHERE \`id\` = ? AND ${LIVE}`, [
      row,
      id,
   ]);
   return result.affectedRows ? getItem(id) : null;
}

/**
 * Take an item off the roadmap, keeping its row: its updates hang off it, so
 * Undo (restoreItem) puts it back whole, in its place, with what waited on
 * it. Every read leaves it out until then. False when there was no such item
 * on the roadmap.
 */
export async function removeItem(id, now = Math.floor(Date.now() / 1000)) {
   const result = await db.query(
      `UPDATE \`roadmap_items\` SET \`removed_at\` = ? WHERE \`id\` = ? AND ${LIVE}`,
      [now, id]
   );
   return result.affectedRows > 0;
}

/**
 * Put a removed item back, as it was: its fields and times untouched, its
 * updates and its place in the order kept, and back on the lists of what
 * waited on it. Null when no removed item has that id.
 * ponytail: a waits_on loop someone closed while it was away comes back
 * with it, shown as clashing, like two saves at once (controllers/roadmap.js).
 */
export async function restoreItem(id) {
   const result = await db.query(
      'UPDATE `roadmap_items` SET `removed_at` = NULL WHERE `id` = ? AND `removed_at` IS NOT NULL',
      [id]
   );
   return result.affectedRows ? getItem(id) : null;
}

/**
 * Move one item to just before another (to the bottom when `beforeId` is
 * null), for a caller that wants "put this above that" without sending the
 * whole order. `{ missing: true }` when either item isn't on the roadmap.
 */
export async function moveItem(id, beforeId) {
   const ids = (await listItems()).map(i => i.id);
   if (!ids.includes(id) || (beforeId != null && !ids.includes(beforeId))) return { missing: true };
   return reorderItems(moveBefore(ids, id, beforeId));
}

/**
 * Put the items in the order given. `ids` must name every item exactly
 * once: when it doesn't, someone added or removed an item since this person
 * loaded the roadmap, so nothing changes and they get the list as it is now.
 * One UPDATE rewrites every priority, so a half-done reorder can't happen.
 */
export async function reorderItems(ids) {
   const current = await listItems();
   const known = new Set(current.map(i => i.id));
   const same = ids.length === known.size && new Set(ids).size === ids.length && ids.every(id => known.has(id));
   if (!same) return { conflict: true, items: current };
   if (ids.length) {
      const cases = ids.map(() => 'WHEN ? THEN ?').join(' ');
      const params = ids.flatMap((id, i) => [id, i]);
      await db.query(
         `UPDATE \`roadmap_items\` SET \`priority\` = CASE \`id\` ${cases} END WHERE \`id\` IN (?)`,
         [...params, ids]
      );
   }
   return { items: await listItems() };
}
