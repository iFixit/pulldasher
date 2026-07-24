import { test } from 'node:test';
import assert from 'node:assert/strict';

// Fixture config (test/fixtures/config.js) carries a github.* block so
// importing lib/git-manager.js (transitively, via controllers/user-names.js)
// doesn't blow up at module-load time. Nothing here makes a real GitHub call
// -- only the pure/injectable bits are exercised (see test/stats.test.js for
// the same pattern).
const { parseLoginsParam, isValidLogin, isFresh, resolveNames, CACHE_TTL_MS } = await import(
   '../controllers/user-names.js'
);

test('parseLoginsParam trims, drops blanks, and dedupes preserving order', () => {
   assert.deepEqual(parseLoginsParam('alice, bob,,alice , carol'), ['alice', 'bob', 'carol']);
});

test('parseLoginsParam returns an empty array for empty/missing input', () => {
   assert.deepEqual(parseLoginsParam(''), []);
   assert.deepEqual(parseLoginsParam(undefined), []);
});

test('isValidLogin accepts GitHub logins and the [bot] suffix', () => {
   assert.equal(isValidLogin('jarstelfox'), true);
   assert.equal(isValidLogin('renovate-bot'), true);
   assert.equal(isValidLogin('dependabot[bot]'), true);
   assert.equal(isValidLogin('UPPER-Case123'), true);
});

test('isValidLogin rejects logins with spaces or injection-y characters', () => {
   assert.equal(isValidLogin('foo bar'), false);
   assert.equal(isValidLogin('foo/bar'), false);
   assert.equal(isValidLogin('foo_bar'), false);
   assert.equal(isValidLogin(''), false);
   assert.equal(isValidLogin(null), false);
});

test('isFresh is false for a missing entry and true within the TTL', () => {
   const now = 1_000_000;
   assert.equal(isFresh(undefined, now), false);
   assert.equal(isFresh({ name: 'Alice', at: now - 1000 }, now), true);
});

test('isFresh is false once an entry is older than CACHE_TTL_MS', () => {
   const now = 1_000_000;
   assert.equal(isFresh({ name: 'Alice', at: now - (CACHE_TTL_MS + 1) }, now), false);
});

test('resolveNames reuses fresh cache entries without calling the fetcher', async () => {
   const now = 1_000_000;
   const cache = new Map([['alice', { name: 'Alice A', at: now - 1000 }]]);
   let calls = 0;
   const fetcher = async login => {
      calls += 1;
      return login === 'bob' ? 'Bob B' : null;
   };

   const names = await resolveNames(['alice', 'bob'], { cache, fetcher, now });

   assert.equal(calls, 1);
   assert.deepEqual(names, { alice: 'Alice A', bob: 'Bob B' });
   assert.equal(cache.get('bob').name, 'Bob B');
});

test('resolveNames refetches a stale cache entry and negative-caches a null result', async () => {
   const now = 1_000_000;
   const cache = new Map([['alice', { name: 'Old Name', at: now - (CACHE_TTL_MS + 1) }]]);
   const seen = [];
   const fetcher = async login => {
      seen.push(login);
      return null; // simulates a 404/deleted account
   };

   const names = await resolveNames(['alice'], { cache, fetcher, now });

   assert.deepEqual(seen, ['alice']);
   assert.deepEqual(names, { alice: null });
   assert.equal(cache.get('alice').name, null);
});

test('resolveNames caps concurrency without dropping any login', async () => {
   const cache = new Map();
   let inFlight = 0;
   let maxInFlight = 0;
   const logins = Array.from({ length: 12 }, (_, i) => `user${i}`);
   const fetcher = async login => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 1));
      inFlight -= 1;
      return `Name ${login}`;
   };

   const names = await resolveNames(logins, { cache, fetcher, concurrency: 5 });

   assert.ok(maxInFlight <= 5, `expected concurrency <= 5, got ${maxInFlight}`);
   for (const login of logins) {
      assert.equal(names[login], `Name ${login}`);
   }
});
