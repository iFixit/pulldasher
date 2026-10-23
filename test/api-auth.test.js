import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import apiAuth, { _clearAuthCache } from '../lib/api-auth.js';

// apiAuth against a stubbed GitHub: an installation token (ghs_) reads when
// its installation is on the org this Pulldasher serves (the fixture's repos
// are test/...), and never writes.

const realFetch = globalThis.fetch;
let calls;
let answer;

beforeEach(() => {
   _clearAuthCache();
   calls = [];
   globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), auth: init.headers.Authorization });
      return answer();
   };
});
afterEach(() => {
   globalThis.fetch = realFetch;
});

const json = (status, body) => () => ({ status, ok: status < 300, json: async () => body });
const reposOf = owner => json(200, { total_count: 1, repositories: [{ owner: { login: owner } }] });

/** Run apiAuth on one request; resolves {status, body} or {next: true, user}. */
function run(method, token) {
   return new Promise(resolve => {
      const req = { method, get: () => `Bearer ${token}` };
      const res = {
         code: 200,
         status(code) {
            this.code = code;
            return this;
         },
         json(body) {
            resolve({ status: this.code, body });
         },
      };
      apiAuth(req, res, () => resolve({ next: true, user: req.apiUser }));
   });
}

test('an installation token on the served org reads', async () => {
   answer = reposOf('Test');
   const got = await run('GET', 'ghs_abc');
   assert.deepEqual(got, { next: true, user: { login: null, installation: true } });
   assert.equal(calls.length, 1);
   assert.match(calls[0].url, /\/installation\/repositories\?per_page=1$/);
});

test('its verdict is kept, so a burst of reads asks GitHub once', async () => {
   answer = reposOf('test');
   await run('GET', 'ghs_abc');
   await run('GET', 'ghs_abc');
   assert.equal(calls.length, 1);
});

test('an installation token never writes, and GitHub is not asked', async () => {
   answer = reposOf('test');
   for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const got = await run(method, 'ghs_abc');
      assert.equal(got.status, 403);
      assert.match(got.body.error, /can only read/);
   }
   assert.equal(calls.length, 0);
});

test('an installation on another org is refused', async () => {
   answer = reposOf('someone-else');
   const got = await run('GET', 'ghs_abc');
   assert.equal(got.status, 403);
});

test('an installation with no repositories is refused', async () => {
   answer = json(200, { total_count: 0, repositories: [] });
   assert.equal((await run('GET', 'ghs_abc')).status, 403);
});

test('a bad installation token is a 401', async () => {
   answer = json(401, { message: 'Bad credentials' });
   assert.equal((await run('GET', 'ghs_abc')).status, 401);
});

test('a GitHub blip is not kept as a verdict', async () => {
   answer = json(502, {});
   assert.equal((await run('GET', 'ghs_abc')).status, 500);
   answer = reposOf('test');
   assert.equal((await run('GET', 'ghs_abc')).next, true);
   assert.equal(calls.length, 2);
});

test("a person's token still resolves to its login", async () => {
   answer = json(200, { login: 'dana' });
   const got = await run('PATCH', 'gho_xyz');
   assert.deepEqual(got, { next: true, user: { login: 'dana' } });
   assert.match(calls[0].url, /\/user$/);
});
