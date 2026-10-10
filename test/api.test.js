import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Pull from '../models/pull.js';
import pullManager from '../lib/pull-manager.js';
import apiAuth, { _clearAuthCache } from '../lib/api-auth.js';
import apiController from '../controllers/api.js';

// A real Express app with just the /api/v1 routes, so we exercise the actual
// Bearer middleware + controller over HTTP, not a hand-rolled call.
function makeApp() {
   const app = express();
   app.get('/api/v1/me', apiAuth, apiController.getMe);
   app.get('/api/v1/pulls', apiAuth, apiController.getPulls);
   return app;
}

function listen(app) {
   return new Promise(resolve => {
      const server = app.listen(0, () => {
         resolve({ port: server.address().port, server });
      });
   });
}

// A `pulls` DB row (mysql2 shape) for a plain needs-CR pull with no sign-offs
// and no CI -- so derive() must land it in `needs_cr`, ci `none`, weight `S`.
function seedNeedsCr() {
   const row = {
      repo: 'test/repo-a',
      number: 42,
      state: 'open',
      title: 'Fixture PR',
      body: '',
      draft: 0,
      date: 1753200000,
      date_updated: 1753300000,
      date_closed: null,
      mergeable: 1,
      date_merged: null,
      difficulty: null,
      additions: 100,
      deletions: 10,
      changed_files: 3,
      milestone_title: null,
      milestone_due_on: null,
      head_branch: 'f',
      head_sha: 'sha1',
      base_branch: 'main',
      owner: 'bob',
      assignees: [],
      requested_reviewers: [],
      cr_req: 2,
      qa_req: 1,
   };
   pullManager.updatePull(Pull.getFromDB(row, [], [], [], [], []));
}

// A pull authored by a configured bot (fixture config.js bots: ['fixture-bot']),
// so the record's is_bot must be true even without a `[bot]` suffix.
function seedBot() {
   const row = {
      repo: 'test/repo-a',
      number: 43,
      state: 'open',
      title: 'Bot PR',
      body: '',
      draft: 0,
      date: 1753200000,
      date_updated: 1753300000,
      date_closed: null,
      mergeable: 1,
      date_merged: null,
      difficulty: null,
      additions: 100,
      deletions: 10,
      changed_files: 3,
      milestone_title: null,
      milestone_due_on: null,
      head_branch: 'f',
      head_sha: 'sha2',
      base_branch: 'main',
      owner: 'fixture-bot',
      assignees: [],
      requested_reviewers: [],
      cr_req: 2,
      qa_req: 1,
   };
   pullManager.updatePull(Pull.getFromDB(row, [], [], [], [], []));
}

const realFetch = globalThis.fetch;

before(() => {
   // Stub GitHub's token->login lookup: only "goodtoken" resolves, to `carol`.
   // The fixture config sets no requireOrg, so no membership call is made.
   globalThis.fetch = async (url, opts) => {
      const authz = (opts && opts.headers && opts.headers.Authorization) || '';
      if (url === 'https://api.github.com/user' && authz === 'Bearer goodtoken') {
         return { ok: true, json: async () => ({ login: 'carol' }) };
      }
      return { ok: false, status: 401, json: async () => ({}) };
   };
   seedNeedsCr();
   seedBot();
});

after(() => {
   globalThis.fetch = realFetch;
});

afterEach(() => _clearAuthCache());

test('rejects a request with no bearer token (401)', async () => {
   const { port, server } = await listen(makeApp());
   const res = await realFetch(`http://127.0.0.1:${port}/api/v1/me`);
   assert.equal(res.status, 401);
   server.close();
});

test('rejects an invalid github token (401)', async () => {
   const { port, server } = await listen(makeApp());
   const res = await realFetch(`http://127.0.0.1:${port}/api/v1/me`, {
      headers: { Authorization: 'Bearer badtoken' },
   });
   assert.equal(res.status, 401);
   server.close();
});

test('resolves the caller identity from a valid token (/me)', async () => {
   const { port, server } = await listen(makeApp());
   const res = await realFetch(`http://127.0.0.1:${port}/api/v1/me`, {
      headers: { Authorization: 'Bearer goodtoken' },
   });
   assert.equal(res.status, 200);
   assert.deepEqual(await res.json(), { login: 'carol' });
   server.close();
});

test('serves the board classified server-side (/pulls)', async () => {
   const { port, server } = await listen(makeApp());
   const res = await realFetch(`http://127.0.0.1:${port}/api/v1/pulls`, {
      headers: { Authorization: 'Bearer goodtoken' },
   });
   assert.equal(res.status, 200);
   const body = await res.json();
   assert.ok(Number.isInteger(body.server_time));
   const rec = body.pulls.find(p => p.id === 'test/repo-a#42');
   assert.ok(rec, 'seeded pull present in the response');
   assert.equal(rec.status, 'needs_cr'); // the server-computed bucket
   assert.equal(rec.ci, 'none');
   assert.equal(rec.weight, 'S');
   assert.equal(rec.signoffs.cr.req, 2);
   assert.equal(rec.signoffs.cr.have, 0);
   assert.equal(rec.url, 'https://github.com/test/repo-a/pull/42');
   assert.equal(rec.is_bot, false); // bob isn't a configured bot
   const botRec = body.pulls.find(p => p.id === 'test/repo-a#43');
   assert.equal(botRec.is_bot, true); // fixture-bot is, via config.js bots
   server.close();
});
