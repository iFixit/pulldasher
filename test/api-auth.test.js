import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import config from '../lib/config-loader.js';
import apiAuth, { _clearAuthCache, isReadKey } from '../lib/api-auth.js';

// apiAuth with a stubbed GitHub: a read key (config.js apiReadKeys holds its
// SHA-256) reads without asking GitHub, and never writes.

const KEY = 'pd-read-0123456789abcdef';
const digest = key => crypto.createHash('sha256').update(key).digest('hex');
const realFetch = globalThis.fetch;
let calls;
let answer;

beforeEach(() => {
   _clearAuthCache();
   config.apiReadKeys = [digest('another key'), digest(KEY).toUpperCase()];
   calls = [];
   globalThis.fetch = async url => {
      calls.push(String(url));
      return answer();
   };
});
afterEach(() => {
   globalThis.fetch = realFetch;
   delete config.apiReadKeys;
});

const json = (status, body) => () => ({ status, ok: status < 300, json: async () => body });

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

test('a read key reads, and GitHub is never asked', async () => {
   const got = await run('GET', KEY);
   assert.deepEqual(got, { next: true, user: { login: null, readKey: true } });
   assert.equal(calls.length, 0);
});

test('a read key never writes, refused before anything else', async () => {
   for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const got = await run(method, KEY);
      assert.equal(got.status, 403);
      assert.match(got.body.error, /can only read/);
   }
   assert.equal(calls.length, 0);
});

test('a value matching no read key is checked as a GitHub token', async () => {
   answer = json(401, { message: 'Bad credentials' });
   assert.equal((await run('GET', 'pd-read-wrong')).status, 401);
   assert.match(calls[0], /\/user$/);
   assert.equal(isReadKey(KEY, []), false);
   // a digest of the wrong length or not hex matches nothing
   assert.equal(isReadKey(KEY, ['abc', 'not hex']), false);
});

test("a person's token still resolves to its login", async () => {
   answer = json(200, { login: 'dana' });
   const got = await run('PATCH', 'gho_xyz');
   assert.deepEqual(got, { next: true, user: { login: 'dana' } });
});
