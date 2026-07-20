import { test } from 'node:test';
import assert from 'node:assert/strict';
import claims, { TTL_MS, MAX_TTL_MS } from '../lib/claims.js';

// lib/claims.js holds one module-level Map, so give every test its own
// repo#number keys (rather than resetting shared state between tests).
const NOW = 1_700_000_000_000; // fixed clock (ms); TTL math is NOW-relative

test('claim records who claimed a pull and when', () => {
   const entry = claims.claim('test/repo', 1, 'alice', NOW);
   assert.deepEqual(entry, { login: 'alice', at: NOW });
   assert.deepEqual(claims.all(NOW)['test/repo#1'], { login: 'alice', at: NOW });
});

test("claim is last-writer-wins: claiming over someone else's claim replaces it", () => {
   claims.claim('test/repo', 2, 'alice', NOW);
   const replaced = claims.claim('test/repo', 2, 'bob', NOW + 1000);

   assert.deepEqual(replaced, { login: 'bob', at: NOW + 1000 });
   assert.deepEqual(claims.all(NOW + 1000)['test/repo#2'], {
      login: 'bob',
      at: NOW + 1000,
   });
});

test('release removes the claim when the releaser owns it', () => {
   claims.claim('test/repo', 3, 'alice', NOW);
   const released = claims.release('test/repo', 3, 'alice', NOW);

   assert.equal(released, true);
   assert.equal(claims.all(NOW)['test/repo#3'], undefined);
});

test('release is a no-op when the releaser does not own the claim', () => {
   claims.claim('test/repo', 4, 'alice', NOW);
   const released = claims.release('test/repo', 4, 'bob', NOW);

   assert.equal(released, false);
   assert.deepEqual(claims.all(NOW)['test/repo#4'], { login: 'alice', at: NOW });
});

test('release on a pull with no claim returns false', () => {
   const released = claims.release('test/repo', 999, 'alice', NOW);
   assert.equal(released, false);
});

test('prune removes entries older than TTL_MS as of the given `now`', () => {
   claims.claim('test/repo', 5, 'alice', NOW);

   const prunedTooSoon = claims.prune(NOW + TTL_MS - 1);
   assert.equal(prunedTooSoon, false);
   assert.deepEqual(claims.all(NOW + TTL_MS - 1)['test/repo#5'], {
      login: 'alice',
      at: NOW,
   });

   const prunedAfterTtl = claims.prune(NOW + TTL_MS + 1);
   assert.equal(prunedAfterTtl, true);
   assert.equal(claims.all(NOW + TTL_MS + 1)['test/repo#5'], undefined);
});

test("a claim's own ttl decides when it expires, independent of others", () => {
   const shortTtl = 30 * 60 * 1000; // 30 minutes
   claims.claim('ttl/repo', 20, 'alice', NOW, shortTtl);
   claims.claim('ttl/repo', 21, 'bob', NOW); // default 4h

   // just before alice's 30m expiry: both still present
   assert.deepEqual(claims.all(NOW + shortTtl - 1)['ttl/repo#20'], {
      login: 'alice',
      at: NOW,
   });
   // just after: alice is gone, bob (default ttl) remains
   const snapshot = claims.all(NOW + shortTtl + 1);
   assert.equal(snapshot['ttl/repo#20'], undefined);
   assert.deepEqual(snapshot['ttl/repo#21'], { login: 'bob', at: NOW });
});

test('an out-of-range ttl is clamped to MAX_TTL_MS, not honored as-is', () => {
   claims.claim('ttl/repo', 22, 'alice', NOW, 10 * 365 * 24 * 60 * 60 * 1000); // 10y
   // still alive past the default 4h (clamp didn't drop it to the default)...
   assert.deepEqual(claims.all(NOW + TTL_MS + 1)['ttl/repo#22'], { login: 'alice', at: NOW });
   // ...but gone once the 24h clamp elapses, never the requested 10 years
   assert.equal(claims.all(NOW + MAX_TTL_MS + 1)['ttl/repo#22'], undefined);
});

test('an absent ttl falls back to the default 4h', () => {
   claims.claim('ttl/repo', 24, 'dave', NOW); // no ttl
   assert.deepEqual(claims.all(NOW + TTL_MS - 1)['ttl/repo#24'], { login: 'dave', at: NOW });
   assert.equal(claims.all(NOW + TTL_MS + 1)['ttl/repo#24'], undefined);
});

test('the broadcast entry never leaks expiresAt', () => {
   claims.claim('ttl/repo', 23, 'carol', NOW, 60 * 60 * 1000);
   assert.deepEqual(Object.keys(claims.all(NOW)['ttl/repo#23']).sort(), ['at', 'login']);
});

test('all() lazily prunes expired entries as a side effect of reading', () => {
   claims.claim('test/repo', 6, 'alice', NOW);

   const snapshot = claims.all(NOW + TTL_MS + 1);

   assert.equal(snapshot['test/repo#6'], undefined);
});

test('all() returns a plain object shaped { "repo#number": { login, at } }', () => {
   claims.claim('shape/repo', 7, 'carol', NOW);

   const snapshot = claims.all(NOW);

   assert.equal(Object.getPrototypeOf(snapshot), Object.prototype);
   assert.deepEqual(snapshot['shape/repo#7'], { login: 'carol', at: NOW });
});

test('claim and release only affect their own repo#number key', () => {
   claims.claim('multi/repo', 10, 'alice', NOW);
   claims.claim('multi/repo', 11, 'bob', NOW);

   claims.release('multi/repo', 10, 'alice', NOW);

   const snapshot = claims.all(NOW);
   assert.equal(snapshot['multi/repo#10'], undefined);
   assert.deepEqual(snapshot['multi/repo#11'], { login: 'bob', at: NOW });
});
