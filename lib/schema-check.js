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
];

/** The migration files this database hasn't had yet, oldest first. */
export async function missingMigrations() {
   const rows = await db.query(
      'SELECT `TABLE_NAME` AS `t`, `COLUMN_NAME` AS `c` FROM information_schema.COLUMNS WHERE `TABLE_SCHEMA` = DATABASE()'
   );
   const tables = new Set(rows.map(r => r.t));
   const columns = new Set(rows.map(r => `${r.t}.${r.c}`));
   const missing = MIGRATIONS.filter(m =>
      m.column ? !columns.has(`${m.table}.${m.column}`) : !tables.has(m.table)
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
