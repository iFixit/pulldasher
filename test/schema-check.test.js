import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import db from '../lib/db.js';
import { MIGRATIONS, applyMissing, missingMigrations } from '../lib/schema-check.js';

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

test('names the migration that gives plans their end kind until it’s in', async () => {
   mock.method(db, 'query', async () =>
      all.filter(r => !(r.t === 'roadmap_items' && r.c === 'end_kind'))
   );
   assert.deepEqual(await missingMigrations(), ['0032-roadmap-items--add-end-kind-done-when.sql']);
   mock.restoreAll();
});

test('every migration the check names is a file bin/migrate-missing can run', () => {
   for (const { file } of MIGRATIONS) {
      assert.ok(existsSync(new URL(`../migrations/${file}`, import.meta.url)), file);
   }
});

test(
   'applyMissing runs each missing file once, in order, and stops at one that added nothing',
   { timeout: 5000 },
   async () => {
      // what the database has: all but 0027, 0028 and 0030; running a file adds
      // what the check looks for
      let has = all.filter(
         r =>
            !(r.t === 'pulls' && r.c === 'date_pushed') &&
            r.t !== 'project_issues' &&
            r.t !== 'issue_pull_links'
      );
      // a turn of the event loop per read, so a loop that never stops times out
      mock.method(db, 'query', () => new Promise(resolve => setImmediate(() => resolve(has))));
      const ran = [];
      const missing = await applyMissing(async (file, sql) => {
         ran.push(file);
         assert.ok(sql.trim().length > 0, file);
         has = [...has, ...all.filter((r, i) => MIGRATIONS[i].file === file)];
      });
      assert.deepEqual(ran, [
         '0027-pulls--add-date-pushed.sql',
         '0028-projects--add-issues-and-links.sql',
         '0030-project-issues--add-linked-by-removed-at.sql',
      ]);
      assert.deepEqual(missing, []);
      // one that runs and adds nothing stops it, and what's left is named
      has = all.filter(
         r => !(r.t === 'pulls' && r.c === 'date_pushed') && r.t !== 'project_issues'
      );
      ran.length = 0;
      const left = await applyMissing(async file => ran.push(file));
      assert.deepEqual(ran, ['0027-pulls--add-date-pushed.sql']);
      assert.deepEqual(left, [
         '0027-pulls--add-date-pushed.sql',
         '0028-projects--add-issues-and-links.sql',
         '0030-project-issues--add-linked-by-removed-at.sql',
      ]);
      mock.restoreAll();
   }
);
