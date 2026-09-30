import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import bodyParser from 'body-parser';
import db from '../lib/db.js';
import { itemFromRow } from '../lib/roadmap.js';
import roadmapController, { canWrite } from '../controllers/roadmap.js';

// An in-memory roadmap_items table behind a stubbed db.query, so each write
// is visible to the next read the way it would be in MySQL. It answers only
// the statements lib/roadmap.js sends.
let rows = [];
let nextId = 1;
function fakeQuery(sql, params = []) {
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
      next();
   });
   app.get('/roadmap', roadmapController.list);
   app.post('/roadmap', canWrite, roadmapController.create);
   app.put('/roadmap/order', canWrite, roadmapController.reorder);
   app.patch('/roadmap/:id', canWrite, roadmapController.update);
   app.delete('/roadmap/:id', canWrite, roadmapController.remove);
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
   nextId = 1;
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
         updated_by: 'alice',
         updated_at: 1790000000,
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

test('delete removes the item', async () => {
   const { body } = await call('POST', '/roadmap', { name: 'Gone soon' });
   const res = await call('DELETE', `/roadmap/${body.item.id}`, undefined, {});
   assert.equal(res.status, 200);
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
