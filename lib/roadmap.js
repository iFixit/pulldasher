import db from './db.js';
import { mondayOf, moveBefore, utcDay } from '../shared/dist/index.js';

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
   "`id`, `name`, `project`, `team`, `lead_login`, `status`, DATE_FORMAT(`start`, '%Y-%m-%d') AS `start`, " +
   '`weeks`, `priority`, `notes`, `waits_on`, `updated_by`, `updated_at`';

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
      start: row.start,
      weeks: Number(row.weeks),
      priority: Number(row.priority),
      notes: row.notes || '',
      // stored as "3,7": a short list of ids, read back as numbers
      waits_on: row.waits_on ? String(row.waits_on).split(',').map(Number) : [],
      updated_by: row.updated_by || null,
      updated_at: row.updated_at == null ? null : Number(row.updated_at),
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
   start: 'start',
   weeks: 'weeks',
   notes: 'notes',
   waits_on: 'waits_on',
};

/** A field's value as its column stores it. */
function toColumn(key, value) {
   return key === 'waits_on' ? (value.length ? value.join(',') : null) : value;
}

/** Every item, in priority order (lowest first), oldest first on a tie,
 * each with its latest update. */
export async function listItems() {
   const [rows, latest] = await Promise.all([
      db.query(`SELECT ${COLUMNS} FROM \`roadmap_items\` ORDER BY \`priority\`, \`id\``),
      db.query(
         `SELECT ${UPDATE_COLUMNS} FROM \`roadmap_updates\` WHERE \`id\` IN ` +
            '(SELECT MAX(`id`) FROM `roadmap_updates` GROUP BY `item_id`)'
      ),
   ]);
   const byItem = new Map(latest.map(r => [Number(r.item_id), updateFromRow(r)]));
   return rows.map(row => itemFromRow(row, byItem.get(Number(row.id)) ?? null));
}

/** One item with its latest update; null when there's no such item. */
export async function getItem(id) {
   const rows = await db.query(`SELECT ${COLUMNS} FROM \`roadmap_items\` WHERE \`id\` = ?`, [id]);
   if (!rows.length) return null;
   const [latest] = await listUpdates(id, 1);
   return itemFromRow(rows[0], latest ?? null);
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
 * Null when there's no such item.
 */
export async function addUpdate(itemId, fields, login, now = Math.floor(Date.now() / 1000)) {
   const rows = await db.query(
      "SELECT DATE_FORMAT(`start`, '%Y-%m-%d') AS `start`, `weeks` FROM `roadmap_items` WHERE `id` = ?",
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
 * Add an item at the bottom of the order. Fields the person didn't send get
 * the plan a blank item starts with: planned, four weeks from this week's
 * Monday.
 */
export async function createItem(fields, login, now = Math.floor(Date.now() / 1000)) {
   const item = {
      project: null,
      team: null,
      lead: null,
      status: 'planned',
      start: mondayOf(utcDay(now)),
      weeks: 4,
      notes: '',
      waits_on: [],
      ...fields,
   };
   const [{ top }] = await db.query('SELECT MAX(`priority`) AS `top` FROM `roadmap_items`');
   const row = {};
   for (const [key, column] of Object.entries(COLUMN_OF)) row[column] = toColumn(key, item[key]);
   row.priority = top == null ? 0 : Number(top) + 1;
   row.created_by = row.updated_by = login;
   row.created_at = row.updated_at = now;
   const result = await db.query('INSERT INTO `roadmap_items` SET ?', [row]);
   return getItem(result.insertId);
}

/** Change only the fields sent, and say who did. Null when there's no such item. */
export async function updateItem(id, fields, login, now = Math.floor(Date.now() / 1000)) {
   const row = { updated_by: login, updated_at: now };
   for (const [key, value] of Object.entries(fields)) {
      if (COLUMN_OF[key]) row[COLUMN_OF[key]] = toColumn(key, value);
   }
   const result = await db.query('UPDATE `roadmap_items` SET ? WHERE `id` = ?', [row, id]);
   return result.affectedRows ? getItem(id) : null;
}

/**
 * Remove an item and its updates, and take it off every list of what other
 * items wait on: a waits_on naming a missing item would fail the next save
 * of the item that waited. False when there was no such item.
 */
export async function deleteItem(id) {
   const result = await db.query('DELETE FROM `roadmap_items` WHERE `id` = ?', [id]);
   await db.query('DELETE FROM `roadmap_updates` WHERE `item_id` = ?', [id]);
   for (const item of await listItems()) {
      if (!item.waits_on.includes(id)) continue;
      const rest = item.waits_on.filter(other => other !== id);
      await db.query('UPDATE `roadmap_items` SET ? WHERE `id` = ?', [
         { waits_on: toColumn('waits_on', rest) },
         item.id,
      ]);
   }
   return result.affectedRows > 0;
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
