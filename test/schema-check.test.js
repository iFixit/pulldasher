import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import db from '../lib/db.js';
import { MIGRATIONS, missingMigrations } from '../lib/schema-check.js';

// information_schema rows for a database that has every migration
const all = MIGRATIONS.map(m => ({ t: m.table, c: m.column ?? 'id' }));

test('a database with every migration is missing none', async () => {
   mock.method(db, 'query', async () => all);
   assert.deepEqual(await missingMigrations(), []);
   mock.restoreAll();
});

test('names each missing migration once, oldest first', async () => {
   // 0027's column and both of 0028's tables are missing, and with them the
   // columns 0030 adds to one
   const rows = all.filter(
      r =>
         !(r.t === 'pulls' && r.c === 'date_pushed') &&
         r.t !== 'project_issues' &&
         r.t !== 'issue_pull_links'
   );
   mock.method(db, 'query', async () => rows);
   assert.deepEqual(await missingMigrations(), [
      '0027-pulls--add-date-pushed.sql',
      '0028-projects--add-issues-and-links.sql',
      '0030-project-issues--add-linked-by-removed-at.sql',
   ]);
   mock.restoreAll();
});
