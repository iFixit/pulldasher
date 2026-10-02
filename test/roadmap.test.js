import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import bodyParser from 'body-parser';
import config from '../lib/config-loader.js';
import db from '../lib/db.js';
import pullManager from '../lib/pull-manager.js';
import Label from '../models/label.js';
import Pull from '../models/pull.js';
import authManager from '../lib/authentication.js';
import { itemFromRow, latelyBySlug } from '../lib/roadmap.js';
import roadmapController, { canWrite, forgetProjectCaches } from '../controllers/roadmap.js';
import { API_ROUTES } from '../controllers/api-routes.js';

// In-memory roadmap_items and roadmap_updates tables behind a stubbed
// db.query, so each write is visible to the next read the way it would be in
// MySQL. They answer only the statements lib/roadmap.js sends.
let rows = [];
let updates = [];
let nextId = 1;
let nextUpdateId = 1;
// set by a test that turns projects on: it answers the project issues' and
// the work model's reads first
let projectQuery = null;
function fakeUpdatesQuery(sql, params) {
   if (sql.startsWith('INSERT INTO `roadmap_updates` SET ?')) {
      const row = { id: nextUpdateId++, ...params[0] };
      updates.push(row);
      return { insertId: row.id, affectedRows: 1 };
   }
   if (sql.startsWith('SELECT `created_by` FROM `roadmap_updates`')) {
      return updates.filter(u => u.id === params[0] && u.item_id === params[1]);
   }
   if (sql.startsWith('DELETE FROM `roadmap_updates`')) {
      const before = updates.length;
      updates = updates.filter(u => u.id !== params[0]);
      return { affectedRows: before - updates.length };
   }
   if (sql.includes('MAX(`id`)')) {
      const latest = new Map();
      for (const u of updates) if (!latest.has(u.item_id) || latest.get(u.item_id).id < u.id) latest.set(u.item_id, u);
      return [...latest.values()];
   }
   if (sql.includes('WHERE `item_id` = ?')) {
      return updates
         .filter(u => u.item_id === params[0])
         .sort((a, b) => b.id - a.id)
         .slice(0, params[1]);
   }
   throw new Error(`unexpected query: ${sql}`);
}
function fakeQuery(sql, params = []) {
   const answer = projectQuery?.(sql);
   if (answer !== undefined) return answer;
   if (sql.includes('`roadmap_updates`')) return fakeUpdatesQuery(sql, params);
   const byOrder = () =>
      [...rows].sort((a, b) => a.priority - b.priority || a.id - b.id);
   // a statement about the items on the roadmap leaves out the removed ones
   const kept = r => !sql.includes('`removed_at` IS NULL') || r.removed_at == null;
   if (sql.startsWith('SELECT MAX(`priority`)')) {
      return [{ top: rows.length ? Math.max(...rows.map(r => r.priority)) : null }];
   }
   if (sql.startsWith('SELECT') && sql.includes('WHERE `id` = ?')) {
      return rows.filter(r => r.id === params[0] && kept(r));
   }
   if (sql.startsWith('SELECT')) return byOrder().filter(kept);
   if (sql.startsWith('INSERT INTO `roadmap_items` SET ?')) {
      const row = { id: nextId++, ...params[0] };
      rows.push(row);
      return { insertId: row.id, affectedRows: 1 };
   }
   if (sql.startsWith('UPDATE `roadmap_items` SET ? WHERE `id` = ?')) {
      const row = rows.find(r => r.id === params[1] && kept(r));
      if (row) Object.assign(row, params[0]);
      return { affectedRows: row ? 1 : 0 };
   }
   // removing stamps when, putting back clears it
   if (sql.startsWith('UPDATE `roadmap_items` SET `removed_at` = ?')) {
      const row = rows.find(r => r.id === params[1] && r.removed_at == null);
      if (row) row.removed_at = params[0];
      return { affectedRows: row ? 1 : 0 };
   }
   if (sql.startsWith('UPDATE `roadmap_items` SET `removed_at` = NULL')) {
      const row = rows.find(r => r.id === params[0] && r.removed_at != null);
      if (row) row.removed_at = null;
      return { affectedRows: row ? 1 : 0 };
   }
   if (sql.startsWith('UPDATE `roadmap_items` SET `priority` = CASE')) {
      const pairs = params.slice(0, -1);
      for (let i = 0; i < pairs.length; i += 2) {
         rows.find(r => r.id === pairs[i]).priority = pairs[i + 1];
      }
      return { affectedRows: pairs.length / 2 };
   }
   throw new Error(`unexpected query: ${sql}`);
}

let signedIn = true;
function makeApp() {
   const app = express();
   app.use(bodyParser.json());
   app.use((req, res, next) => {
      req.isAuthenticated = () => signedIn;
      req.user = { username: 'alice' };
      // stands in for lib/api-auth.js, which checks the token with GitHub
      const bearer = req.get('authorization');
      if (bearer) req.apiUser = { login: bearer.replace(/^Bearer /, '') };
      next();
   });
   app.get('/roadmap', roadmapController.list);
   app.get('/updates-owed', roadmapController.owed);
   app.post('/roadmap', canWrite, roadmapController.create);
   app.put('/roadmap/order', canWrite, roadmapController.reorder);
   app.patch('/roadmap/:id', canWrite, roadmapController.update);
   app.delete('/roadmap/:id', canWrite, roadmapController.remove);
   app.get('/roadmap/:id/updates', roadmapController.updates);
   app.post('/roadmap/:id/updates', canWrite, roadmapController.postUpdate);
   app.delete('/roadmap/:id/updates/:update', canWrite, roadmapController.removeUpdate);
   app.get('/roadmap/:id', roadmapController.get);
   app.post('/roadmap/:id/move', canWrite, roadmapController.move);
   app.get('/project-standing', roadmapController.standing);
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
   rows = [];
   updates = [];
   nextId = 1;
   nextUpdateId = 1;
   signedIn = true;
});

async function call(method, path, body, headers = { 'Content-Type': 'application/json' }) {
   const res = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
   });
   return { status: res.status, body: await res.json() };
}

test('itemFromRow renames the lead and fills the blanks', () => {
   assert.deepEqual(
      itemFromRow({
         id: '3',
         name: 'Store picker',
         project: null,
         team: 'Store',
         lead_login: 'dana',
         status: 'active',
         origin: null,
         start: '2026-09-28',
         weeks: '6',
         priority: '2',
         notes: null,
         waits_on: '1,4',
         updated_by: 'alice',
         updated_at: '1790000000',
         created_at: '1789000000',
         status_at: '1789500000',
      }),
      {
         id: 3,
         name: 'Store picker',
         project: null,
         team: 'Store',
         lead: 'dana',
         status: 'active',
         origin: null,
         start: '2026-09-28',
         weeks: 6,
         priority: 2,
         notes: '',
         waits_on: [1, 4],
         updated_by: 'alice',
         updated_at: 1790000000,
         created_at: 1789000000,
         status_at: 1789500000,
         update: null,
      }
   );
});

test('status_at says when the status changed, and an edit that keeps it leaves it', async () => {
   const { body } = await call('POST', '/roadmap', { name: 'Search' });
   const id = body.item.id;
   assert.ok(body.item.status_at > 0);
   assert.equal(body.item.status_at, body.item.created_at);
   // an old time, so a write that moves it shows
   rows.find(r => r.id === id).status_at = 1000;
   const notes = await call('PATCH', `/roadmap/${id}`, { notes: 'Bigger than it looked' });
   assert.equal(notes.body.item.status_at, 1000);
   // the status it already has isn't a change
   const same = await call('PATCH', `/roadmap/${id}`, { status: 'planned', weeks: 6 });
   assert.equal(same.body.item.status_at, 1000);
   const done = await call('PATCH', `/roadmap/${id}`, { status: 'done' });
   assert.equal(done.body.item.status_at, done.body.item.updated_at);
   assert.ok(done.body.item.status_at > 1000);
   // Finish again on Decide restates it: the PRs before now are accepted
   rows.find(r => r.id === id).status_at = 1000;
   const again = await call('PATCH', `/roadmap/${id}`, { status: 'done', restate: true });
   assert.equal(again.body.item.status_at, again.body.item.updated_at);
   assert.ok(again.body.item.status_at > 1000);
   // Undo puts the old status back with the times the call replaced
   const undone = await call('PATCH', `/roadmap/${id}`, {
      status: 'planned',
      undo: { updated_at: 2000, status_at: 1000 },
   });
   assert.equal(undone.body.item.status, 'planned');
   assert.equal(undone.body.item.updated_at, 2000);
   assert.equal(undone.body.item.status_at, 1000);
   // a time from the future isn't put back: the write stamps now instead
   const later = Math.floor(Date.now() / 1000) + 3600;
   const bad = await call('PATCH', `/roadmap/${id}`, { notes: 'x', undo: { updated_at: later } });
   assert.ok(bad.body.item.updated_at < later);
});

test('a new item starts planned, four weeks from a Monday, at the bottom', async () => {
   const first = await call('POST', '/roadmap', { name: '  Checkout redesign ' });
   assert.equal(first.status, 201);
   assert.equal(first.body.item.name, 'Checkout redesign');
   assert.equal(first.body.item.status, 'planned');
   assert.equal(first.body.item.origin, null);
   assert.equal(first.body.item.weeks, 4);
   assert.equal(new Date(`${first.body.item.start}T00:00:00Z`).getUTCDay(), 1);
   assert.equal(first.body.item.updated_by, 'alice');
   const second = await call('POST', '/roadmap', {
      name: 'Search reindex',
      start: '2026-10-01',
      weeks: 8,
      project: 'search-reindex',
   });
   assert.equal(second.body.item.priority, first.body.item.priority + 1);
   // any day moves to its week's Monday
   assert.equal(second.body.item.start, '2026-09-28');
   assert.equal(rows.find(r => r.id === second.body.item.id).created_by, 'alice');
});

test('a bad item is a 400 that says why', async () => {
   const noName = await call('POST', '/roadmap', { weeks: 3 });
   assert.equal(noName.status, 400);
   assert.match(noName.body.error, /name/);
   const noWeeks = await call('POST', '/roadmap', { name: 'X', weeks: 0 });
   assert.equal(noWeeks.status, 400);
   assert.match(noWeeks.body.error, /weeks/);
});

test('an edit changes only what was sent, and 404s an unknown item', async () => {
   const { body } = await call('POST', '/roadmap', { name: 'Grafana', weeks: 2 });
   const edited = await call('PATCH', `/roadmap/${body.item.id}`, { weeks: 5, lead: 'dana' });
   assert.equal(edited.status, 200);
   assert.equal(edited.body.item.weeks, 5);
   assert.equal(edited.body.item.lead, 'dana');
   assert.equal(edited.body.item.name, 'Grafana');
   assert.equal((await call('PATCH', '/roadmap/99', { weeks: 5 })).status, 404);
   assert.equal((await call('PATCH', '/roadmap/abc', { weeks: 5 })).status, 400);
});

test('updates-owed lists each lead’s plans in progress with no update for two weeks', async () => {
   const old = Date.UTC(2026, 0, 5) / 1000;
   const row = (id, lead, status) => ({
      id,
      name: `Plan ${id}`,
      project: null,
      team: null,
      lead_login: lead,
      status,
      origin: null,
      start: '2026-01-05',
      weeks: 60,
      priority: id,
      notes: '',
      waits_on: null,
      updated_by: lead,
      updated_at: old,
      created_at: old,
   });
   rows.push(row(91, 'dana', 'active'), row(92, 'dana', 'planned'), row(93, null, 'active'));
   const { status, body } = await call('GET', '/updates-owed');
   assert.equal(status, 200);
   const mine = body.leads.filter(l => l.plans.some(p => p.id >= 91));
   // a plan not started yet owes nothing; one with no lead still owes, last
   assert.deepEqual(
      mine.map(l => [l.lead, l.plans.map(p => [p.id, p.owes])]),
      [
         ['dana', [[91, 'a first update']]],
         [null, [[93, 'a first update']]],
      ]
   );
   rows = rows.filter(r => r.id < 91);
});

test('origin says where the work came from, and null clears it', async () => {
   const { body } = await call('POST', '/roadmap', { name: 'Outage fix', origin: 'fire' });
   assert.equal(body.item.origin, 'fire');
   const picked = await call('PATCH', `/roadmap/${body.item.id}`, { origin: 'chosen' });
   assert.equal(picked.body.item.origin, 'chosen');
   const cleared = await call('PATCH', `/roadmap/${body.item.id}`, { origin: null });
   assert.equal(cleared.body.item.origin, null);
   const bad = await call('PATCH', `/roadmap/${body.item.id}`, { origin: 'boss' });
   assert.equal(bad.status, 400);
   assert.match(bad.body.error, /origin is one of asked, fire, chosen/);
});

test('an update keeps the plan beside it; the list shows each item’s latest', async () => {
   const { body } = await call('POST', '/roadmap', { name: 'Search', start: '2026-09-28', weeks: 4 });
   const id = body.item.id;
   assert.equal(body.item.update, null);
   const first = await call('POST', `/roadmap/${id}/updates`, { health: 'on_track', body: ' Fine. ' });
   assert.equal(first.status, 201);
   assert.equal(first.body.update.body, 'Fine.');
   assert.equal(first.body.update.author, 'alice');
   await call('PATCH', `/roadmap/${id}`, { weeks: 6 });
   await call('POST', `/roadmap/${id}/updates`, { health: 'at_risk' });
   const [item] = (await call('GET', '/roadmap', undefined, {})).body.items;
   assert.equal(item.update.health, 'at_risk');
   assert.equal(item.update.body, '');
   assert.equal(item.update.plan_weeks, 6);
   const history = (await call('GET', `/roadmap/${id}/updates`, undefined, {})).body.updates;
   assert.deepEqual(
      history.map(u => [u.health, u.plan_start, u.plan_weeks]),
      [
         ['at_risk', '2026-09-28', 6],
         ['on_track', '2026-09-28', 4],
      ]
   );
});

test('a bad update is a 400; one on an unknown item a 404', async () => {
   const { body } = await call('POST', '/roadmap', { name: 'X' });
   const bad = await call('POST', `/roadmap/${body.item.id}/updates`, { health: 'fine' });
   assert.equal(bad.status, 400);
   assert.match(bad.body.error, /health/);
   assert.equal((await call('POST', '/roadmap/99/updates', { health: 'on_track' })).status, 404);
});

test('waits_on is stored as ids and refuses a loop', async () => {
   const a = (await call('POST', '/roadmap', { name: 'A' })).body.item;
   assert.deepEqual(a.waits_on, []);
   const b = (await call('POST', '/roadmap', { name: 'B', waits_on: [a.id] })).body.item;
   assert.deepEqual(b.waits_on, [a.id]);
   assert.equal(rows.find(r => r.id === b.id).waits_on, String(a.id));
   const loop = await call('PATCH', `/roadmap/${a.id}`, { waits_on: [b.id] });
   assert.equal(loop.status, 400);
   assert.match(loop.body.error, /loop/);
   const missing = await call('POST', '/roadmap', { name: 'C', waits_on: [99] });
   assert.equal(missing.status, 400);
   const cleared = await call('PATCH', `/roadmap/${b.id}`, { waits_on: [] });
   assert.deepEqual(cleared.body.item.waits_on, []);
   assert.equal(rows.find(r => r.id === b.id).waits_on, null);
});

test('a removed item is off what others wait on until it’s put back', async () => {
   const a = (await call('POST', '/roadmap', { name: 'A' })).body.item;
   const b = (await call('POST', '/roadmap', { name: 'B' })).body.item;
   const c = (await call('POST', '/roadmap', { name: 'C', waits_on: [a.id, b.id] })).body.item;
   await call('DELETE', `/roadmap/${a.id}`, undefined, {});
   const after = (await call('GET', `/roadmap/${c.id}`, undefined, {})).body.item;
   assert.deepEqual(after.waits_on, [b.id]);
   // and it saves again, and nothing new can wait on the removed one
   assert.equal((await call('PATCH', `/roadmap/${c.id}`, { notes: 'x' })).status, 200);
   assert.equal((await call('PATCH', `/roadmap/${b.id}`, { waits_on: [a.id] })).status, 400);
   await call('PATCH', `/roadmap/${a.id}`, { restore: true });
   const back = (await call('GET', `/roadmap/${c.id}`, undefined, {})).body.item;
   assert.deepEqual(back.waits_on, [a.id, b.id]);
});

test('removing keeps the item and its updates, and restore puts it back in its place', async () => {
   const ids = [];
   for (const name of ['A', 'B', 'C']) ids.push((await call('POST', '/roadmap', { name })).body.item.id);
   const b = ids[1];
   await call('POST', `/roadmap/${b}/updates`, { health: 'off_track', body: 'Stuck.' });
   const was = rows.find(r => r.id === b);
   const times = { updated_at: was.updated_at, status_at: was.status_at };
   assert.equal((await call('DELETE', `/roadmap/${b}`, undefined, {})).status, 200);
   assert.equal(updates.length, 1);
   const names = async () => (await call('GET', '/roadmap', undefined, {})).body.items.map(i => i.name);
   assert.deepEqual(await names(), ['A', 'C']);
   // gone from every door until it's back
   assert.equal((await call('GET', `/roadmap/${b}`, undefined, {})).status, 404);
   assert.equal((await call('PATCH', `/roadmap/${b}`, { weeks: 3 })).status, 404);
   assert.equal((await call('POST', `/roadmap/${b}/updates`, { health: 'on_track' })).status, 404);
   assert.equal((await call('DELETE', `/roadmap/${b}`, undefined, {})).status, 404);
   const back = await call('PATCH', `/roadmap/${b}`, { restore: true });
   assert.equal(back.status, 200);
   assert.equal(back.body.item.update.body, 'Stuck.');
   assert.deepEqual(
      { updated_at: back.body.item.updated_at, status_at: back.body.item.status_at },
      times
   );
   assert.deepEqual(await names(), ['A', 'B', 'C']);
   // only a removed item can be put back
   assert.equal((await call('PATCH', `/roadmap/${b}`, { restore: true })).status, 404);
});

test('an update’s author can take it back; the one before is the latest again', async () => {
   const { body } = await call('POST', '/roadmap', { name: 'Search' });
   const id = body.item.id;
   const first = (await call('POST', `/roadmap/${id}/updates`, { health: 'on_track' })).body.update;
   const second = (await call('POST', `/roadmap/${id}/updates`, { health: 'at_risk' })).body.update;
   const theirs = await call('DELETE', `/roadmap/${id}/updates/${second.id}`, undefined, {
      Authorization: 'Bearer carol',
   });
   assert.equal(theirs.status, 403);
   const back = await call('DELETE', `/roadmap/${id}/updates/${second.id}`, undefined, {});
   assert.equal(back.status, 200);
   assert.equal(back.body.update.id, first.id);
   const [item] = (await call('GET', '/roadmap', undefined, {})).body.items;
   assert.equal(item.update.health, 'on_track');
   assert.equal((await call('DELETE', `/roadmap/${id}/updates/${second.id}`, undefined, {})).status, 404);
   // the last one gone leaves none
   const none = await call('DELETE', `/roadmap/${id}/updates/${first.id}`, undefined, {});
   assert.equal(none.body.update, null);
   assert.equal((await call('DELETE', `/roadmap/${id}/updates/x`, undefined, {})).status, 400);
});

test('an order naming every item rewrites the priorities; a stale one is a 409', async () => {
   const ids = [];
   for (const name of ['A', 'B', 'C']) ids.push((await call('POST', '/roadmap', { name })).body.item.id);
   const moved = await call('PUT', '/roadmap/order', { ids: [ids[2], ids[0], ids[1]] });
   assert.equal(moved.status, 200);
   assert.deepEqual(
      moved.body.items.map(i => i.name),
      ['C', 'A', 'B']
   );
   const stale = await call('PUT', '/roadmap/order', { ids: [ids[0], ids[1]] });
   assert.equal(stale.status, 409);
   assert.equal(stale.body.items.length, 3);
   assert.equal((await call('PUT', '/roadmap/order', { ids: ['x'] })).status, 400);
});

test('writes need a signed-in person and a JSON body', async () => {
   signedIn = false;
   assert.equal((await call('POST', '/roadmap', { name: 'Nope' })).status, 401);
   signedIn = true;
   const form = await call('POST', '/roadmap', 'name=Nope', {
      'Content-Type': 'application/x-www-form-urlencoded',
   });
   assert.equal(form.status, 415);
   assert.equal(rows.length, 0);
});

test('a Bearer caller can write with no session, as its own login', async () => {
   signedIn = false;
   const res = await call('POST', '/roadmap', { name: 'From the CLI' }, {
      'Content-Type': 'application/json',
      Authorization: 'Bearer carol',
   });
   assert.equal(res.status, 201);
   assert.equal(rows[0].created_by, 'carol');
});

test('one item by id, and a move puts it just above another or at the bottom', async () => {
   const ids = [];
   for (const name of ['A', 'B', 'C']) ids.push((await call('POST', '/roadmap', { name })).body.item.id);
   const one = await call('GET', `/roadmap/${ids[1]}`, undefined, {});
   assert.equal(one.body.item.name, 'B');
   assert.equal((await call('GET', '/roadmap/99', undefined, {})).status, 404);
   const up = await call('POST', `/roadmap/${ids[2]}/move`, { before: ids[0] });
   assert.deepEqual(
      up.body.items.map(i => i.name),
      ['C', 'A', 'B']
   );
   const down = await call('POST', `/roadmap/${ids[0]}/move`, { before: null });
   assert.deepEqual(
      down.body.items.map(i => i.name),
      ['C', 'B', 'A']
   );
   assert.equal((await call('POST', `/roadmap/${ids[0]}/move`, { before: 99 })).status, 404);
   assert.equal((await call('POST', `/roadmap/${ids[0]}/move`, {})).status, 400);
});

test('the API route table names each route once, with what it does', () => {
   const seen = new Set();
   for (const route of API_ROUTES) {
      const key = `${route.method} ${route.path}`;
      assert.ok(!seen.has(key), `${key} is listed twice`);
      seen.add(key);
      assert.ok(route.path.startsWith('/api/v1/'), key);
      assert.ok(route.does && route.handlers.every(h => typeof h === 'function'), key);
      // every write goes through the gate that records who made it
      if (route.method !== 'get') assert.equal(route.handlers[0], canWrite, key);
   }
});

// ---- with projects on: what a plan's project issue and its PRs say ----

const DAY = 86400;
const issueRow = (number, slug, over = {}) => ({
   repo: 'test/projects',
   number,
   title: slug,
   status: 'open',
   state_reason: null,
   assignee: null,
   milestone_title: null,
   milestone_due_on: null,
   field_start: null,
   field_target: null,
   field_priority: null,
   date_created: number,
   date_closed: null,
   ...over,
});

/** Run a test with projects set up and these project issues; the work
 * model's reads find nothing attached or linked. */
async function withProjects(issues, run) {
   config.projects = { repo: 'test/projects' };
   projectQuery = sql => {
      if (sql.startsWith('SELECT i.* FROM issues')) return issues;
      if (sql.startsWith('SELECT l.repo, l.number, l.title, l.date FROM pull_labels')) {
         return issues.map(i => ({ repo: i.repo, number: i.number, title: `project:${i.title}` }));
      }
      return sql.includes('`roadmap_') ? undefined : [];
   };
   forgetProjectCaches();
   try {
      await run();
   } finally {
      delete config.projects;
      projectQuery = null;
      forgetProjectCaches();
   }
}

test('a new plan starts on its issue’s Start date, placed by its Priority', async () => {
   await withProjects(
      [
         issueRow(1, 'alpha', { field_start: '2026-10-07', field_priority: 'High' }),
         issueRow(2, 'beta', { field_priority: 'low' }),
      ],
      async () => {
         await call('POST', '/roadmap', { name: 'No project' });
         await call('POST', '/roadmap', { name: 'Beta', project: 'beta' });
         const alpha = await call('POST', '/roadmap', { name: 'Alpha', project: 'alpha' });
         // the Start date's Monday
         assert.equal(alpha.body.item.start, '2026-10-05');
         // high above low; the plan whose issue says no priority keeps its place
         const order = (await call('GET', '/roadmap', undefined, {})).body.items;
         assert.deepEqual(
            order.map(i => i.name),
            ['No project', 'Alpha', 'Beta']
         );
         // a start the person sent wins
         const sent = await call('POST', '/roadmap', {
            name: 'Alpha again',
            project: 'alpha',
            start: '2026-11-04',
         });
         assert.equal(sent.body.item.start, '2026-11-02');
      }
   );
});

test('a plan whose PRs merged lately owes no update, on the API as on the board', async () => {
   const now = Math.floor(Date.now() / 1000);
   const merged = {
      repo: 'test/repo-a',
      number: 501,
      state: 'closed',
      title: 'PR 501',
      body: '',
      draft: 0,
      date: now - 5 * DAY,
      date_updated: now - DAY,
      date_closed: now - DAY,
      mergeable: 1,
      date_merged: now - DAY,
      additions: 1,
      deletions: 1,
      changed_files: 1,
      head_branch: 'b501',
      head_sha: 'sha501',
      base_branch: 'main',
      owner: 'alice',
      assignees: [],
      requested_reviewers: [],
      cr_req: 1,
      qa_req: 1,
   };
   pullManager.updatePull(
      Pull.getFromDB(merged, [], [], [], [], [
         new Label({ name: 'project:alpha' }, 501, 'test/repo-a', 'job-bot'),
      ])
   );
   // under way since January, through next February, never updated
   const plan = (id, project) => ({
      id,
      name: `Plan ${project}`,
      project,
      team: null,
      lead_login: 'dana',
      status: 'active',
      origin: null,
      start: '2026-01-05',
      weeks: 60,
      priority: id,
      notes: '',
      waits_on: null,
      updated_by: 'dana',
      updated_at: now - 200 * DAY,
      created_at: now - 200 * DAY,
   });
   rows.push(
      plan(81, 'alpha'),
      plan(82, 'beta'),
      // still marked planned, its PRs moving since its start
      { ...plan(83, 'alpha'), status: 'planned' },
      // its lead's last word, three weeks ago, was off track
      plan(84, 'alpha')
   );
   updates.push({
      id: nextUpdateId++,
      item_id: 84,
      health: 'off_track',
      body: 'Blocked on the vendor.',
      plan_start: '2026-01-05',
      plan_weeks: 60,
      created_by: 'dana',
      created_at: now - 21 * DAY,
   });
   await withProjects([issueRow(1, 'alpha'), issueRow(2, 'beta')], async () => {
      const owed = (await call('GET', '/updates-owed', undefined, {})).body;
      // merges never stand over a lead's off track
      assert.deepEqual(
         owed.leads.flatMap(l => l.plans.map(p => p.id)),
         [82, 84]
      );
      const items = (await call('GET', '/roadmap', undefined, {})).body.items;
      const item = id => items.find(i => i.id === id);
      assert.equal(item(81).lately.merged, 1);
      assert.equal(item(82).lately.merged, 0);
      // what the board reads off each, said the board's way
      assert.deepEqual(
         [81, 82, 83, 84].map(id => [item(id).status, item(id).in_progress, item(id).standing]),
         [
            ['active', true, 'vouched'],
            ['active', true, 'owed'],
            ['planned', true, 'vouched'],
            ['active', true, 'owed'],
         ]
      );
   });
});

/** An open PR on the board, as the pulls table keeps it. */
function boardPull(number, over = {}) {
   const now = Math.floor(Date.now() / 1000);
   return Pull.getFromDB(
      {
         repo: 'test/repo-a',
         number,
         state: 'open',
         title: `PR ${number}`,
         body: '',
         draft: 0,
         date: now - 3 * DAY,
         date_updated: now - DAY,
         date_closed: null,
         mergeable: 1,
         date_merged: null,
         additions: 1,
         deletions: 1,
         changed_files: 1,
         head_branch: `b${number}`,
         head_sha: `sha${number}`,
         base_branch: 'main',
         owner: 'erin',
         assignees: [],
         requested_reviewers: [],
         cr_req: 1,
         qa_req: 1,
         ...over,
      },
      [],
      [],
      [],
      [],
      []
   );
}

test('the review board’s project standing: its PRs’ links and each project’s plan, kept a while', async () => {
   const now = Math.floor(Date.now() / 1000);
   // on the board with no project label; #999 isn't on the board
   pullManager.updatePull(boardPull(602));
   const plan = (id, project, status) => ({
      id,
      name: `Plan ${project}`,
      project,
      team: null,
      lead_login: null,
      status,
      origin: null,
      start: '2026-01-05',
      weeks: 60,
      priority: id,
      notes: '',
      waits_on: null,
      updated_by: 'dana',
      updated_at: now - 30 * DAY,
      created_at: now - 30 * DAY,
   });
   rows.push(plan(91, 'alpha', 'planned'), plan(92, 'beta', 'parked'), plan(93, 'gamma', 'planned'));
   await withProjects([issueRow(1, 'alpha'), issueRow(2, 'beta')], async () => {
      const base = projectQuery;
      let linkReads = 0;
      projectQuery = sql => {
         // alpha's own issue carries its label, and #602 and #999 link it
         if (sql.includes('l.date AS labeled_at')) {
            return [{ repo: 'test/projects', number: 1, title: 'alpha', label: 'project:alpha' }];
         }
         if (sql.startsWith('SELECT `issue_repo`')) {
            linkReads++;
            return [602, 999].map(n => ({
               issue_repo: 'test/projects',
               issue_number: 1,
               pull_repo: 'test/repo-a',
               pull_number: n,
            }));
         }
         return base(sql);
      };
      const { status, body } = await call('GET', '/project-standing', undefined, {});
      assert.equal(status, 200);
      assert.deepEqual(body, {
         pull_links: { 'test/repo-a#602': ['alpha'] },
         plans: {
            // planned, and in progress by #602 moving since its start
            alpha: { status: 'planned', in_progress: true, name: 'Plan alpha' },
            beta: { status: 'parked', in_progress: false, name: 'Plan beta' },
            gamma: { status: 'planned', in_progress: false, name: 'Plan gamma' },
         },
      });
      // kept: asked again, nothing is read
      const reads = linkReads;
      await call('GET', '/project-standing', undefined, {});
      assert.equal(linkReads, reads);
      // a project write forgets it, and boards asking at once share one read
      forgetProjectCaches();
      await Promise.all([1, 2, 3].map(() => call('GET', '/project-standing', undefined, {})));
      assert.equal(linkReads, 2 * reads);
   });
});

test('what a project did lately: its merges in the last two weeks, open PRs by stage, its pace', () => {
   const now = Date.UTC(2026, 8, 30) / 1000;
   const iso = t => new Date(t * 1000).toISOString();
   const open = status => ({
      status,
      cryo: false,
      externalBlock: false,
      conflict: false,
      changesRequestedBy: [],
      data: { status: {} },
   });
   const today = {
      live: [
         {
            slug: 'alpha',
            open: [open('needs_cr'), open('ready')],
            merged: [{ merged_at: iso(now - 3 * DAY) }, { merged_at: iso(now - 20 * DAY) }],
            lastActivity: now - 3600,
         },
      ],
      quiet: [{ slug: 'beta', open: [], merged: [], lastActivity: null }],
   };
   const pace = { alpha: { open: 2, closed: 3, added: 1 }, beta: { open: 1, closed: 0, added: 0 } };
   const lately = latelyBySlug(today, pace, new Set(['beta']), now);
   assert.deepEqual(lately.get('alpha'), {
      merged: 1,
      open: { ready: 1, hold: 0, review: 1, work: 0 },
      activityAt: now - 3600,
      issues: pace.alpha,
   });
   // work with no end has no finish to forecast
   assert.equal(lately.get('beta').issues, null);
});

test('the project standing needs a signed-in session, like the board’s other reads', () => {
   const gated = [];
   authManager.setupRoutes({ get: path => gated.push(path) });
   assert.ok(gated.includes('/project-standing'));
});
