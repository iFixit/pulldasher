import { readFileSync } from 'fs';
import db from './db.js';

/**
 * What each hand-run migration adds, oldest first. The image runs
 * bin/pulldasher, so migrations/*.sql never run on a deploy: one deployed
 * before its migrations fails in pieces (every pull refresh fails without
 * pulls.date_pushed, every roadmap read without roadmap_items.status_at).
 * A check at startup names what's missing instead, and bin/migrate-missing
 * applies it before a deploy.
 */
export const MIGRATIONS = [
   { file: '0022-roadmap-items--add-table.sql', table: 'roadmap_items' },
   { file: '0023-roadmap-updates--add-table.sql', table: 'roadmap_updates' },
   { file: '0024-project-settings--add-table.sql', table: 'project_settings' },
   { file: '0025-roadmap-items--add-origin.sql', table: 'roadmap_items', column: 'origin' },
   { file: '0026-issues--add-fields.sql', table: 'issues', column: 'field_priority' },
   { file: '0027-pulls--add-date-pushed.sql', table: 'pulls', column: 'date_pushed' },
   { file: '0028-projects--add-issues-and-links.sql', table: 'project_issues' },
   { file: '0028-projects--add-issues-and-links.sql', table: 'issue_pull_links' },
   { file: '0029-roadmap-items--add-status-at.sql', table: 'roadmap_items', column: 'status_at' },
   // one statement adds both columns, so one stands for the pair
   {
      file: '0030-project-issues--add-linked-by-removed-at.sql',
      table: 'project_issues',
      column: 'removed_at',
   },
   { file: '0031-roadmap-items--add-removed-at.sql', table: 'roadmap_items', column: 'removed_at' },
   // one statement adds both columns, so one stands for the pair
   {
      file: '0032-roadmap-items--add-end-kind-done-when.sql',
      table: 'roadmap_items',
      column: 'end_kind',
   },
   // indexes, not columns; one statement per file, so each is all or nothing
   { file: '0034-comments--add-date-index.sql', table: 'comments', index: 'comments_date' },
   {
      file: '0035-pull-signatures--add-date-index.sql',
      table: 'pull_signatures',
      index: 'pull_signatures_date',
   },
   { file: '0036-reviews--add-date-index.sql', table: 'reviews', index: 'reviews_date' },
   // one statement adds both, so one stands for the pair
   { file: '0037-pulls--add-date-indexes.sql', table: 'pulls', index: 'pulls_date_merged' },
   // a widened column: the length is what changed
   {
      file: '0038-roadmap-items--widen-project.sql',
      table: 'roadmap_items',
      column: 'project',
      length: 64,
   },
];

/** The migration files this database hasn't had yet, oldest first. */
export async function missingMigrations() {
   // columns (with their length), and indexes as `key:<name>`, in one read
   const rows = await db.query(
      'SELECT `TABLE_NAME` AS `t`, `COLUMN_NAME` AS `c`, `CHARACTER_MAXIMUM_LENGTH` AS `n` FROM information_schema.COLUMNS WHERE `TABLE_SCHEMA` = DATABASE() ' +
         "UNION ALL SELECT `TABLE_NAME`, CONCAT('key:', `INDEX_NAME`), NULL FROM information_schema.STATISTICS WHERE `TABLE_SCHEMA` = DATABASE()"
   );
   const tables = new Set(rows.map(r => r.t));
   const columns = new Map(rows.map(r => [`${r.t}.${r.c}`, r.n]));
   const missing = MIGRATIONS.filter(m =>
      m.index
         ? !columns.has(`${m.table}.key:${m.index}`)
         : m.length
         ? !(Number(columns.get(`${m.table}.${m.column}`)) >= m.length)
         : m.column
         ? !columns.has(`${m.table}.${m.column}`)
         : !tables.has(m.table)
   );
   return [...new Set(missing.map(m => m.file))];
}

/**
 * Apply the migrations this database is missing, oldest first, with
 * `run(file, sql)`: each one only while information_schema says it's still
 * missing, read again after each, so none runs twice (0029's backfill must
 * run once). Stops at one that ran without adding what it adds, rather than
 * run what follows on top of it. Resolves the files still missing after.
 */
export async function applyMissing(run) {
   let missing = await missingMigrations();
   while (missing.length) {
      const [file] = missing;
      await run(file, readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
      const after = await missingMigrations();
      if (after.includes(file)) return after;
      missing = after;
   }
   return missing;
}
