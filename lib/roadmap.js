import db from './db.js';
import { mondayOf, utcDay } from '../shared/dist/index.js';

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
   '`weeks`, `priority`, `notes`, `updated_by`, `updated_at`';

/** A roadmap_items row as the wire's RoadmapItem. */
export function itemFromRow(row) {
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
      updated_by: row.updated_by || null,
      updated_at: row.updated_at == null ? null : Number(row.updated_at),
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
};

/** Every item, in priority order (lowest first), oldest first on a tie. */
export async function listItems() {
   const rows = await db.query(
      `SELECT ${COLUMNS} FROM \`roadmap_items\` ORDER BY \`priority\`, \`id\``
   );
   return rows.map(itemFromRow);
}

async function getItem(id) {
   const rows = await db.query(`SELECT ${COLUMNS} FROM \`roadmap_items\` WHERE \`id\` = ?`, [id]);
   return rows.length ? itemFromRow(rows[0]) : null;
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
      ...fields,
   };
   const [{ top }] = await db.query('SELECT MAX(`priority`) AS `top` FROM `roadmap_items`');
   const row = {};
   for (const [key, column] of Object.entries(COLUMN_OF)) row[column] = item[key];
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
      if (COLUMN_OF[key]) row[COLUMN_OF[key]] = value;
   }
   const result = await db.query('UPDATE `roadmap_items` SET ? WHERE `id` = ?', [row, id]);
   return result.affectedRows ? getItem(id) : null;
}

/** Remove an item; false when there was none. */
export async function deleteItem(id) {
   const result = await db.query('DELETE FROM `roadmap_items` WHERE `id` = ?', [id]);
   return result.affectedRows > 0;
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
