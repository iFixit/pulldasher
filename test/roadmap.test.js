import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import bodyParser from 'body-parser';
import db from '../lib/db.js';
import { itemFromRow } from '../lib/roadmap.js';
import roadmapController, { canWrite } from '../controllers/roadmap.js';
import { API_ROUTES } from '../controllers/api-routes.js';

// In-memory roadmap_items and roadmap_updates tables behind a stubbed
// db.query, so each write is visible to the next read the way it would be in
// MySQL. They answer only the statements lib/roadmap.js sends.
let rows = [];
let updates = [];
let nextId = 1;
let nextUpdateId = 1;
function fakeUpdatesQuery(sql, params) {
   if (sql.startsWith('INSERT INTO `roadmap_updates` SET ?')) {
      const row = { id: nextUpdateId++, ...params[0] };
      updates.push(row);
      return { insertId: row.id, affectedRows: 1 };
   }
   if (sql.startsWith('DELETE FROM `roadmap_updates`')) {
      const before = updates.length;
      updates = updates.filter(u => u.item_id !== params[0]);
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
   if (sql.includes('`roadmap_updates`')) return fakeUpdatesQuery(sql, params);
   const byOrder = () =>
      [...rows].sort((a, b) => a.priority - b.priority || a.id - b.id);
   if (sql.startsWith('SELECT MAX(`priority`)')) {
      return [{ top: rows.length ? Math.max(...rows.map(r => r.priority)) : null }];
   }
   if (sql.startsWith('SELECT') && sql.includes('WHERE `id` = ?')) {
      return rows.filter(r => r.id === params[0]);
   }
   if (sql.startsWith('SELECT')) return byOrder();
   if (sql.startsWith('INSERT INTO `roadmap_items` SET ?')) {
      const row = { id: nextId++, ...params[0] };
      rows.push(row);
      return { insertId: row.id, affectedRows: 1 };
   }
   if (sql.startsWith('UPDATE `roadmap_items` SET ? WHERE `id` = ?')) {
      const row = rows.find(r => r.id === params[1]);
      if (row) Object.assign(row, params[0]);
      return { affectedRows: row ? 1 : 0 };
   }
   if (sql.startsWith('UPDATE `roadmap_items` SET `priority` = CASE')) {
      const pairs = params.slice(0, -1);
      for (let i = 0; i < pairs.length; i += 2) {
         rows.find(r => r.id === pairs[i]).priority = pairs[i + 1];
      }
      return { affectedRows: pairs.length / 2 };
   }
   if (sql.startsWith('DELETE FROM `roadmap_items`')) {
      const before = rows.length;
      rows = rows.filter(r => r.id !== params[0]);
      return { affectedRows: before - rows.length };
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
   app.post('/roadmap', canWrite, roadmapController.create);
   app.put('/roadmap/order', canWrite, roadmapController.reorder);
   app.patch('/roadmap/:id', canWrite, roadmapController.update);
   app.delete('/roadmap/:id', canWrite, roadmapController.remove);
   app.get('/roadmap/:id/updates', roadmapController.updates);
   app.post('/roadmap/:id/updates', canWrite, roadmapController.postUpdate);
   app.get('/roadmap/:id', roadmapController.get);
   app.post('/roadmap/:id/move', canWrite, roadmapController.move);
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
         start: '2026-09-28',
         weeks: '6',
         priority: '2',
         notes: null,
         waits_on: '1,4',
         updated_by: 'alice',
         updated_at: '1790000000',
      }),
      {
         id: 3,
         name: 'Store picker',
         project: null,
         team: 'Store',
         lead: 'dana',
         status: 'active',
         start: '2026-09-28',
         weeks: 6,
         priority: 2,
         notes: '',
         waits_on: [1, 4],
         updated_by: 'alice',
         updated_at: 1790000000,
         update: null,
      }
   );
});

test('a new item starts planned, four weeks from a Monday, at the bottom', async () => {
   const first = await call('POST', '/roadmap', { name: '  Checkout redesign ' });
   assert.equal(first.status, 201);
   assert.equal(first.body.item.name, 'Checkout redesign');
   assert.equal(first.body.item.status, 'planned');
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

test('delete removes the item and its updates', async () => {
   const { body } = await call('POST', '/roadmap', { name: 'Gone soon' });
   await call('POST', `/roadmap/${body.item.id}/updates`, { health: 'off_track' });
   const res = await call('DELETE', `/roadmap/${body.item.id}`, undefined, {});
   assert.equal(res.status, 200);
   assert.equal(updates.length, 0);
   assert.equal((await call('GET', '/roadmap', undefined, {})).body.items.length, 0);
   assert.equal((await call('DELETE', `/roadmap/${body.item.id}`, undefined, {})).status, 404);
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
