import { test } from "node:test";
import assert from "node:assert/strict";
import claims, { TTL_MS } from "../lib/claims.js";

// lib/claims.js holds one module-level Map, so give every test its own
// repo#number keys (rather than resetting shared state between tests).
const NOW = 1_700_000_000_000; // fixed clock (ms); TTL math is NOW-relative

test("claim records who claimed a pull and when", () => {
  const entry = claims.claim("test/repo", 1, "alice", NOW);
  assert.deepEqual(entry, { login: "alice", at: NOW });
  assert.deepEqual(claims.all(NOW)["test/repo#1"], { login: "alice", at: NOW });
});

test("claim is last-writer-wins: claiming over someone else's claim replaces it", () => {
  claims.claim("test/repo", 2, "alice", NOW);
  const replaced = claims.claim("test/repo", 2, "bob", NOW + 1000);

  assert.deepEqual(replaced, { login: "bob", at: NOW + 1000 });
  assert.deepEqual(claims.all(NOW + 1000)["test/repo#2"], {
    login: "bob",
    at: NOW + 1000,
  });
});

test("release removes the claim when the releaser owns it", () => {
  claims.claim("test/repo", 3, "alice", NOW);
  const released = claims.release("test/repo", 3, "alice", NOW);

  assert.equal(released, true);
  assert.equal(claims.all(NOW)["test/repo#3"], undefined);
});

test("release is a no-op when the releaser does not own the claim", () => {
  claims.claim("test/repo", 4, "alice", NOW);
  const released = claims.release("test/repo", 4, "bob", NOW);

  assert.equal(released, false);
  assert.deepEqual(claims.all(NOW)["test/repo#4"], { login: "alice", at: NOW });
});

test("release on a pull with no claim returns false", () => {
  const released = claims.release("test/repo", 999, "alice", NOW);
  assert.equal(released, false);
});

test("prune removes entries older than TTL_MS as of the given `now`", () => {
  claims.claim("test/repo", 5, "alice", NOW);

  const prunedTooSoon = claims.prune(NOW + TTL_MS - 1);
  assert.equal(prunedTooSoon, false);
  assert.deepEqual(claims.all(NOW + TTL_MS - 1)["test/repo#5"], {
    login: "alice",
    at: NOW,
  });

  const prunedAfterTtl = claims.prune(NOW + TTL_MS + 1);
  assert.equal(prunedAfterTtl, true);
  assert.equal(claims.all(NOW + TTL_MS + 1)["test/repo#5"], undefined);
});

test("all() lazily prunes expired entries as a side effect of reading", () => {
  claims.claim("test/repo", 6, "alice", NOW);

  const snapshot = claims.all(NOW + TTL_MS + 1);

  assert.equal(snapshot["test/repo#6"], undefined);
});

test("all() returns a plain object shaped { \"repo#number\": { login, at } }", () => {
  claims.claim("shape/repo", 7, "carol", NOW);

  const snapshot = claims.all(NOW);

  assert.equal(Object.getPrototypeOf(snapshot), Object.prototype);
  assert.deepEqual(snapshot["shape/repo#7"], { login: "carol", at: NOW });
});

test("claim and release only affect their own repo#number key", () => {
  claims.claim("multi/repo", 10, "alice", NOW);
  claims.claim("multi/repo", 11, "bob", NOW);

  claims.release("multi/repo", 10, "alice", NOW);

  const snapshot = claims.all(NOW);
  assert.equal(snapshot["multi/repo#10"], undefined);
  assert.deepEqual(snapshot["multi/repo#11"], { login: "bob", at: NOW });
});
