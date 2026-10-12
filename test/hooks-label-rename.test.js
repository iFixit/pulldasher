import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import HooksController from '../controllers/githubHooks.js';
import config from '../lib/config-loader.js';
import db from '../lib/db.js';
import queue from '../lib/pull-queue.js';
import { _resetSettings, loadSettings } from '../lib/settings.js';
import { renameProject } from '../lib/work.js';

afterEach(() => {
   mock.restoreAll();
   _resetSettings();
});

// every query, and what each kind answers
function fakeDb(answers = {}) {
   const queries = [];
   mock.method(db, 'query', async (sql, params) => {
      queries.push({ sql, params });
      for (const [pattern, rows] of Object.entries(answers)) {
         if (sql.includes(pattern)) return typeof rows === 'function' ? rows(params) : rows;
      }
      return sql.includes('COUNT(*)') ? [{ n: 0 }] : [];
   });
   return queries;
}

function send(event, body) {
   const req = {
      query: { secret: 'test-hook-secret' },
      headers: { 'content-type': 'application/json' },
      body,
      get: () => event,
   };
   return new Promise(resolve => {
      const res = { status: () => res, send: resolve };
      HooksController.main(req, res);
   });
}

const renamed = (from, to) => ({
   action: 'edited',
   label: { name: to },
   changes: { name: { from } },
   repository: { full_name: 'o/r' },
});

test('a renamed label moves to the new name on every row in the repo', async () => {
   const saved = config.projects;
   config.projects = undefined;
   const queries = fakeDb({ 'JOIN pulls': [{ number: 7 }] });
   const dirty = [];
   mock.method(queue, 'markPullAsDirty', (repo, number) => dirty.push(`${repo}#${number}`));

   await send('label', renamed('P-strapi-shared-fields', 'P-strapi-cli'));
   config.projects = saved;

   // a row already under the new name goes first, so the update can't collide
   const writes = queries.filter(q => /^(DELETE|UPDATE)/.test(q.sql));
   assert.deepEqual(
      writes.map(q => [q.sql.split(' ')[0], q.params]),
      [
         ['DELETE', ['P-strapi-cli', 'o/r', 'P-strapi-shared-fields']],
         ['UPDATE', ['P-strapi-cli', 'o/r', 'P-strapi-shared-fields']],
      ]
   );
   // the open PR the board shows is sent again
   assert.deepEqual(dirty, ['o/r#7']);
});

test('a case-only rename keeps the renamed rows', async () => {
   const saved = config.projects;
   config.projects = undefined;
   const queries = fakeDb();
   await send('label', renamed('P-Docs', 'P-docs'));
   config.projects = saved;
   assert.ok(queries.some(q => q.sql.startsWith('UPDATE pull_labels')));
   assert.ok(!queries.some(q => q.sql.startsWith('DELETE')));
});

test('a label edit with no new name, a new label, or a deleted one changes nothing', async () => {
   const queries = fakeDb();
   await send('label', { ...renamed('a', 'a'), changes: { color: { from: 'fff' } } });
   await send('label', { ...renamed('a', 'a'), action: 'created', changes: undefined });
   await send('label', { ...renamed('a', 'a'), action: 'deleted', changes: undefined });
   assert.equal(queries.length, 0);
});

const settings = { prefix: 'P-' };

test('a project moves once no repo has a PR or issue under its old label', async () => {
   const queries = fakeDb({
      '`project_settings`': [{ name: 'ongoing_projects', value: '["audit","docs"]' }],
   });
   await loadSettings();
   assert.equal(await renameProject(settings, 'audit', 'remediation'), true);
   const sql = queries.map(q => [q.sql.split(' ').slice(0, 3).join(' '), q.params]);
   assert.deepEqual(
      sql.filter(([s]) => s.startsWith('UPDATE')),
      [
         ['UPDATE IGNORE `project_issues`', ['remediation', 'audit']],
         ['UPDATE `roadmap_items` SET', ['remediation', 'audit']],
      ]
   );
   const ongoing = queries.find(q => q.sql.startsWith('REPLACE INTO `project_settings`'));
   assert.equal(ongoing.params[0].value, '["docs","remediation"]');
});

test('a project another repo still labels the old way stays put', async () => {
   const queries = fakeDb({ '`pull_labels`': [{ n: 2 }] });
   assert.equal(await renameProject(settings, 'audit', 'remediation'), false);
   assert.equal(queries.length, 1);
});

test('a roadmap item already tracking the new slug keeps it', async () => {
   const queries = fakeDb({ '`roadmap_items` WHERE': [{ n: 1 }] });
   await renameProject(settings, 'audit', 'remediation');
   assert.ok(!queries.some(q => q.sql.startsWith('UPDATE `roadmap_items`')));
   assert.ok(queries.some(q => q.sql.startsWith('UPDATE IGNORE `project_issues`')));
});
