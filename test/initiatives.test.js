import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import bodyParser from 'body-parser';
import config from '../lib/config-loader.js';
import db from '../lib/db.js';
import Pull from '../models/pull.js';
import Label from '../models/label.js';
import pullManager from '../lib/pull-manager.js';
import { trackedOnly } from '../lib/initiatives.js';
import initiativesController from '../controllers/initiatives.js';
import { canWrite } from '../controllers/roadmap.js';
import { API_ROUTES, PROJECT_WRITES } from '../controllers/api-routes.js';

// In-memory initiatives and initiative_projects tables behind a stubbed
// db.query, so each write shows in the next read as it would in MySQL. They
// answer only the statements lib/initiatives.js sends, plus the roadmap's
// reads (its plans, for each initiative's span and the close check).
let initiatives = [];
let filings = [];
let plans = [];
// labeled PRs: { title, date }
let prs = [];
let nextId = 1;

const byRank = () => [...initiatives].sort((a, b) => a.priority - b.priority || a.id - b.id);

function fakeQuery(sql, params = []) {
   if (sql.includes('`roadmap_updates`')) return [];
   if (sql.includes('FROM `roadmap_items`')) return plans;
   if (sql.startsWith('SELECT `id`, `slug`')) return byRank();
   if (sql.startsWith('SELECT `project`, `initiative_id`')) {
      return [...filings].sort((a, b) => a.project.localeCompare(b.project));
   }
   if (sql.startsWith('SELECT MAX(`priority`)')) {
      return [{ top: initiatives.length ? Math.max(...initiatives.map(i => i.priority)) : null }];
   }
   if (sql.startsWith('INSERT INTO `initiatives` SET ?')) {
      if (initiatives.some(i => i.slug === params[0].slug)) {
         throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
      }
      const row = { id: nextId++, ...params[0] };
      initiatives.push(row);
      return { insertId: row.id, affectedRows: 1 };
   }
   if (sql.startsWith('SELECT `status` FROM `initiatives`')) {
      return initiatives.filter(i => i.id === params[0]);
   }
   if (sql.startsWith('UPDATE `initiatives` SET ? WHERE `id` = ?')) {
      const row = initiatives.find(i => i.id === params[1]);
      if (row) Object.assign(row, params[0]);
      return { affectedRows: row ? 1 : 0 };
   }
   if (sql.startsWith('DELETE FROM `initiatives`')) {
      const [id] = params;
      const held = filings.some(f => f.initiative_id === id);
      const before = initiatives.length;
      if (!held) initiatives = initiatives.filter(i => i.id !== id);
      return { affectedRows: before - initiatives.length };
   }
   if (sql.startsWith('UPDATE `initiatives` SET `priority` = CASE')) {
      const pairs = params.slice(0, -1);
      for (let i = 0; i < pairs.length; i += 2) {
         initiatives.find(r => r.id === pairs[i]).priority = pairs[i + 1];
      }
      return { affectedRows: pairs.length / 2 };
   }
   if (sql.startsWith('SELECT f.`project`')) {
      return filings
         .filter(f => f.project === params[0])
         .map(f => {
            const i = initiatives.find(r => r.id === f.initiative_id);
            return { ...f, slug: i.slug, kind: i.kind };
         });
   }
   if (sql.startsWith('SELECT COUNT(DISTINCT')) {
      const [title, since] = params;
      return [{ n: prs.filter(p => p.title === title && p.date > since).length }];
   }
   if (sql.startsWith('SELECT `id`, `kind`, `status` FROM `initiatives`')) {
      return initiatives.filter(i => i.slug === params[0]);
   }
   if (sql.startsWith('DELETE FROM `initiative_projects`')) {
      filings = filings.filter(f => f.project !== params[0]);
      return { affectedRows: 1 };
   }
   if (sql.startsWith('REPLACE INTO `initiative_projects` SET ?')) {
      filings = [...filings.filter(f => f.project !== params[0].project), { ...params[0] }];
      return { affectedRows: 1 };
   }
   // the board's projects and PR links (the close check's open PRs): none
   if (/FROM issues i|FROM pull_labels l JOIN issues|FROM `project_issues`|FROM `issue_pull_links`/.test(sql)) return [];
   throw new Error(`unexpected query: ${sql}`);
}

function makeApp() {
   const app = express();
   app.use(bodyParser.json());
   app.use((req, res, next) => {
      req.isAuthenticated = () => true;
      req.user = { username: 'alice' };
      next();
   });
   app.get('/initiatives', initiativesController.list);
   app.post('/initiatives', canWrite, initiativesController.create);
   app.put('/initiatives/file', canWrite, initiativesController.file);
   app.patch('/initiatives/:id', canWrite, initiativesController.update);
   app.delete('/initiatives/:id', canWrite, initiativesController.remove);
   app.post('/initiatives/:id/move', canWrite, initiativesController.move);
   return app;
}

let server;
let base;
before(async () => {
   mock.method(db, 'query', async (sql, params) => fakeQuery(sql, params));
   await new Promise(resolve => {
      server = makeApp().listen(0, () => {
         base = `http://127.0.0.1:${server.address().port}`;
         resolve();
      });
   });
});
after(() => {
   mock.restoreAll();
   server.close();
});
beforeEach(() => {
   initiatives = [];
   filings = [];
   plans = [];
   prs = [];
   nextId = 1;
});

async function call(method, path, body) {
   const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
   });
   return { status: res.status, body: await res.json() };
}

const make = (slug, over = {}) => call('POST', '/initiatives', { slug, name: slug, ...over });

/** A roadmap_items row, as lib/roadmap.js selects it. */
const plan = (id, project, over = {}) => ({
   id,
   name: `Plan ${id}`,
   project,
   team: null,
   lead_login: null,
   status: 'active',
   origin: null,
   start: '2026-09-07',
   weeks: 4,
   end_kind: 'soft',
   done_when: '',
   priority: id,
   notes: '',
   waits_on: null,
   updated_by: null,
   updated_at: 1,
   created_at: 1,
   status_at: 1,
   ...over,
});

test('a new initiative is ranked last, open, and its slug is its own', async () => {
   const first = await make('site-speed', { goal: 'Fast\npages', owner: 'dana' });
   assert.equal(first.status, 201);
   assert.deepEqual(
      [first.body.initiative.slug, first.body.initiative.goal, first.body.initiative.owner],
      ['site-speed', 'Fast pages', 'dana']
   );
   assert.deepEqual(
      [first.body.initiative.kind, first.body.initiative.status, first.body.initiative.created_by],
      ['initiative', 'open', 'alice']
   );
   const second = await make('klo', { kind: 'upkeep' });
   assert.equal(second.body.initiative.priority, first.body.initiative.priority + 1);
   assert.equal(second.body.initiative.kind, 'upkeep');
   assert.equal((await make('klo')).status, 409);
   assert.equal((await call('POST', '/initiatives', { name: 'No slug' })).status, 400);
});

test('GET lists them in rank order with their projects and span', async () => {
   await make('site-speed');
   await make('api');
   await call('PUT', '/initiatives/file', { project: 'bot-defense', initiative: 'site-speed' });
   plans = [
      plan(1, 'bot-defense', { start: '2026-07-13', weeks: 16 }),
      plan(2, 'bot-defense', { start: '2026-08-03', end_kind: 'ongoing' }),
      plan(3, 'elsewhere', { start: '2026-01-05' }),
   ];
   const { status, body } = await call('GET', '/initiatives');
   assert.equal(status, 200);
   assert.deepEqual(
      body.initiatives.map(i => [i.slug, i.projects.map(f => f.project)]),
      [
         ['site-speed', ['bot-defense']],
         ['api', []],
      ]
   );
   assert.deepEqual(body.initiatives[0].span, {
      start: '2026-07-13',
      end: '2026-11-01',
      with_end: 1,
      ongoing: 1,
      end_kind: 'soft',
      ended: null,
   });
   assert.equal(body.initiatives[1].span.end_kind, null);
});

test('a move changes only initiatives’ ranks', async () => {
   const a = (await make('a')).body.initiative.id;
   const b = (await make('b')).body.initiative.id;
   const c = (await make('c')).body.initiative.id;
   const moved = await call('POST', `/initiatives/${c}/move`, { before: a });
   assert.deepEqual(
      moved.body.initiatives.map(i => i.slug),
      ['c', 'a', 'b']
   );
   const bottom = await call('POST', `/initiatives/${c}/move`, { before: null });
   assert.deepEqual(
      bottom.body.initiatives.map(i => i.slug),
      ['a', 'b', 'c']
   );
   assert.equal((await call('POST', `/initiatives/${b}/move`, { before: 99 })).status, 404);
   assert.equal((await call('POST', `/initiatives/${b}/move`, {})).status, 400);
});

test('an edit changes what was sent; status says when, Keep open restamps, undo puts times back', async () => {
   const id = (await make('a')).body.initiative.id;
   const renamed = await call('PATCH', `/initiatives/${id}`, { name: 'Alpha', owner: null });
   assert.deepEqual([renamed.body.initiative.name, renamed.body.initiative.owner], ['Alpha', null]);
   assert.equal(renamed.body.initiative.status_at, null);
   assert.equal((await call('PATCH', `/initiatives/${id}`, { slug: 'b' })).status, 400);
   // Keep open: the status it has, said again
   const kept = await call('PATCH', `/initiatives/${id}`, { status: 'open', restate: true });
   assert.ok(kept.body.initiative.status_at > 0);
   const undone = await call('PATCH', `/initiatives/${id}`, {
      status: 'open',
      undo: { updated_at: 5, status_at: null },
   });
   assert.deepEqual([undone.body.initiative.status_at, undone.body.initiative.updated_at], [null, 5]);
   assert.equal((await call('PATCH', '/initiatives/99', { name: 'X' })).status, 404);
});

test('an initiative closes only once nothing in it is going', async () => {
   const id = (await make('firmware')).body.initiative.id;
   await call('PUT', '/initiatives/file', { project: 'hub', initiative: 'firmware' });
   await call('PUT', '/initiatives/file', { project: 'bench', initiative: 'firmware' });
   plans = [plan(1, 'hub'), plan(2, 'bench', { status: 'done' })];
   const refused = await call('PATCH', `/initiatives/${id}`, { status: 'done' });
   assert.equal(refused.status, 409);
   assert.deepEqual(refused.body.live, ['hub']);
   plans = [plan(1, 'hub', { status: 'parked' }), plan(2, 'bench', { status: 'done' })];
   const closed = await call('PATCH', `/initiatives/${id}`, { status: 'done' });
   assert.equal(closed.status, 200);
   assert.equal(closed.body.initiative.status, 'done');
   assert.ok(closed.body.initiative.status_at > 0);
});

test('Not tracked and upkeep are one of each and never close', async () => {
   const shelf = (await make('shelf', { kind: 'untracked' })).body.initiative.id;
   const klo = (await make('klo', { kind: 'upkeep' })).body.initiative.id;
   assert.equal((await make('shelf-2', { kind: 'untracked' })).status, 409);
   assert.equal((await make('klo-2', { kind: 'upkeep' })).status, 409);
   assert.equal((await make('more')).status, 201);
   for (const id of [shelf, klo]) {
      const refused = await call('PATCH', `/initiatives/${id}`, { status: 'dropped' });
      assert.equal(refused.status, 409);
      // still open, and its other fields still change
      const renamed = await call('PATCH', `/initiatives/${id}`, { name: 'Renamed', status: 'open' });
      assert.deepEqual([renamed.status, renamed.body.initiative.status], [200, 'open']);
   }
});

test('an initiative with a finished plan whose PRs are still open does not close', async () => {
   const saved = config.projects;
   config.projects = { repo: 'test/projects' };
   try {
      const id = (await make('firmware')).body.initiative.id;
      await call('PUT', '/initiatives/file', { project: 'hub', initiative: 'firmware' });
      plans = [plan(1, 'hub', { status: 'done' })];
      // hub's plan is done, but a PR labeled with it is open on the board
      const now = Math.floor(Date.now() / 1000);
      const row = {
         repo: 'test/repo-a',
         number: 41,
         state: 'open',
         title: 'PR 41',
         body: '',
         draft: 0,
         date: now - 86400,
         date_updated: now,
         date_closed: null,
         mergeable: 1,
         date_merged: null,
         difficulty: null,
         additions: 1,
         deletions: 0,
         changed_files: 1,
         milestone_title: null,
         milestone_due_on: null,
         head_branch: 'b41',
         head_sha: 'sha41',
         base_branch: 'main',
         owner: 'alice',
         assignees: [],
         requested_reviewers: [],
         cr_req: 1,
         qa_req: 1,
      };
      const labels = [new Label({ name: 'project:hub' }, 41, 'test/repo-a', 'alice')];
      pullManager.updatePull(Pull.getFromDB(row, [], [], [], [], labels));
      const refused = await call('PATCH', `/initiatives/${id}`, { status: 'done' });
      assert.equal(refused.status, 409);
      assert.deepEqual(refused.body.live, ['hub']);
      // closed, the PR no longer holds it open
      pullManager.getPulls()[0].data.state = 'closed';
      pullManager.getPulls()[0].data.date_closed = now;
      assert.equal((await call('PATCH', `/initiatives/${id}`, { status: 'done' })).status, 200);
   } finally {
      config.projects = saved;
      pullManager.getPulls().length = 0;
   }
});

test('only an empty initiative can be deleted', async () => {
   const id = (await make('a')).body.initiative.id;
   await call('PUT', '/initiatives/file', { project: 'p', initiative: 'a' });
   assert.equal((await call('DELETE', `/initiatives/${id}`)).status, 409);
   await call('PUT', '/initiatives/file', { project: 'p', initiative: null });
   assert.equal((await call('DELETE', `/initiatives/${id}`)).status, 200);
   assert.equal((await call('DELETE', `/initiatives/${id}`)).status, 404);
   // its slug is free again
   assert.equal((await make('a')).status, 201);
});

test('nothing is filed into a closed initiative, but an undo puts a filing back there', async () => {
   const id = (await make('a')).body.initiative.id;
   initiatives.find(i => i.id === id).status = 'done';
   const refused = await call('PUT', '/initiatives/file', { project: 'p', initiative: 'a' });
   assert.equal(refused.status, 409);
   assert.match(refused.body.error, /closed/);
   assert.deepEqual(filings, []);
   // an undo restores the filing a move replaced, with its time
   const back = await call('PUT', '/initiatives/file', {
      project: 'p',
      initiative: 'a',
      set_at: 50,
      baseline_prs: 0,
   });
   assert.equal(back.status, 200);
   assert.equal(back.body.home.initiative, 'a');
});

test('filing moves a project’s one home, 409s a stale expect, and says what it replaced', async () => {
   await make('a');
   await make('b');
   const first = await call('PUT', '/initiatives/file', { project: 'p', initiative: 'a', expect: null });
   assert.equal(first.status, 200);
   assert.deepEqual(first.body.before, { initiative: null, set_by: null, set_at: null, baseline_prs: 0 });
   assert.equal(first.body.home.initiative, 'a');
   assert.equal(first.body.home.set_by, 'alice');
   const stale = await call('PUT', '/initiatives/file', { project: 'p', initiative: 'b', expect: null });
   assert.equal(stale.status, 409);
   assert.equal(stale.body.home.initiative, 'a');
   const moved = await call('PUT', '/initiatives/file', { project: 'p', initiative: 'b', expect: 'a' });
   assert.equal(moved.body.before.initiative, 'a');
   assert.deepEqual(
      filings.map(f => f.project),
      ['p']
   );
   assert.equal((await call('PUT', '/initiatives/file', { project: 'p', initiative: 'nope' })).status, 404);
   assert.equal((await call('PUT', '/initiatives/file', { project: 'bad slug', initiative: 'a' })).status, 400);
   const unfiled = await call('PUT', '/initiatives/file', { project: 'p', initiative: null });
   assert.equal(unfiled.body.home, null);
   assert.deepEqual(filings, []);
});

test('filing into Not tracked sets the growth check’s start, and its undo puts it back', async () => {
   await make('not-tracked', { kind: 'untracked' });
   await make('a');
   const now = Math.floor(Date.now() / 1000);
   const DAY = 86400;
   prs = [
      ...Array.from({ length: 5 }, () => ({ title: 'project:ops-ci', date: now - 40 * DAY })),
      // an issue's label isn't counted: lib/initiatives.js joins pulls
   ];
   // with no baseline sent, its PR count now
   const set = await call('PUT', '/initiatives/file', { project: 'ops-ci', initiative: 'not-tracked' });
   assert.equal(set.body.home.baseline_prs, 5);
   // the load sends its count from GitHub
   const loaded = await call('PUT', '/initiatives/file', {
      project: 'ops-ci',
      initiative: 'not-tracked',
      baseline_prs: 40,
   });
   assert.equal(loaded.body.home.baseline_prs, 40);
   // three PRs later, Keep: the old baseline plus the PRs since it was set
   filings[0].set_at = now - 10 * DAY;
   prs.push(...Array.from({ length: 3 }, () => ({ title: 'project:ops-ci', date: now - DAY })));
   const keep = await call('PUT', '/initiatives/file', {
      project: 'ops-ci',
      initiative: 'not-tracked',
      expect: 'not-tracked',
   });
   assert.equal(keep.body.home.baseline_prs, 43);
   assert.deepEqual(keep.body.before, {
      initiative: 'not-tracked',
      set_by: 'alice',
      set_at: now - 10 * DAY,
      baseline_prs: 40,
   });
   // undoing the Keep puts the old start back, so the count doesn't restart
   const undo = await call('PUT', '/initiatives/file', {
      project: 'ops-ci',
      initiative: keep.body.before.initiative,
      expect: 'not-tracked',
      set_at: keep.body.before.set_at,
      baseline_prs: keep.body.before.baseline_prs,
   });
   assert.deepEqual([undo.body.home.set_at, undo.body.home.baseline_prs], [now - 10 * DAY, 40]);
   // a filing anywhere else keeps no baseline
   const tracked = await call('PUT', '/initiatives/file', { project: 'ops-ci', initiative: 'a' });
   assert.equal(tracked.body.home.baseline_prs, 0);
   // an undo time from the future, or a negative count, is refused
   const later = await call('PUT', '/initiatives/file', {
      project: 'ops-ci',
      initiative: 'a',
      set_at: now + 3600,
   });
   assert.equal(later.status, 400);
   const negative = await call('PUT', '/initiatives/file', {
      project: 'ops-ci',
      initiative: 'a',
      baseline_prs: -1,
   });
   assert.equal(negative.status, 400);
});

test('trackedOnly leaves not-tracked projects out of Today, the plans and by-slug numbers', () => {
   const untracked = new Set(['ops']);
   const out = trackedOnly(untracked, {
      today: { live: [{ slug: 'ops' }, { slug: 'store' }], quiet: [{ slug: 'ops' }], misc: [1] },
      items: [{ project: 'ops' }, { project: 'store' }, { project: null }],
      bySlug: { ops: 1, store: 2 },
   });
   assert.deepEqual(out.today, { live: [{ slug: 'store' }], quiet: [], misc: [1] });
   assert.deepEqual(out.items, [{ project: 'store' }, { project: null }]);
   assert.deepEqual(out.bySlug, { store: 2 });
   assert.deepEqual(trackedOnly(untracked, { items: [] }), { today: undefined, items: [], bySlug: undefined });
});

test('every API write is one open boards hear about, initiatives included', () => {
   const writes = API_ROUTES.filter(r => r.method !== 'get');
   for (const { path } of writes) {
      assert.ok(
         PROJECT_WRITES.some(prefix => path === prefix || path.startsWith(`${prefix}/`)),
         `${path} isn't in PROJECT_WRITES`
      );
   }
   for (const prefix of ['/initiatives', '/api/v1/initiatives']) assert.ok(PROJECT_WRITES.includes(prefix));
   const initiativeRoutes = API_ROUTES.filter(r => r.path.startsWith('/api/v1/initiatives'));
   assert.deepEqual(
      initiativeRoutes.map(r => `${r.method} ${r.path}`),
      [
         'get /api/v1/initiatives',
         'post /api/v1/initiatives',
         'put /api/v1/initiatives/file',
         'patch /api/v1/initiatives/:id',
         'delete /api/v1/initiatives/:id',
         'post /api/v1/initiatives/:id/move',
      ]
   );
   for (const r of initiativeRoutes) {
      assert.ok(r.does.length > 20);
      if (r.method !== 'get') assert.equal(r.handlers[0], canWrite);
   }
});
