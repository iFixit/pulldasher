/**
 * In-memory "who's reviewing this PR" review-claim map, keyed `repo#number`.
 *
 * This is purely social, not a lock: claiming over someone else's claim is
 * allowed on purpose (a deliberate correction, not blocked -- last writer
 * wins). Nothing here is persisted anywhere; a server restart clears every
 * claim, by design.
 *
 * Entries are pruned lazily (on any read or write) once they're older than
 * TTL_MS, so a stale claim never lingers past the next touch. app.js also
 * runs a periodic sweep on SWEEP_INTERVAL_MS so a claim goes away even if
 * nobody claims/releases/reads in the meantime.
 */
import debug from "./debug.js";

const claimsDebug = debug("pulldasher:claims");

export const TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
export const SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

const claims = new Map();

function keyFor(repo, number) {
  return `${repo}#${number}`;
}

// Deletes claims older than TTL_MS as of `now`. Returns whether anything was
// removed, so callers can tell whether the map actually changed.
function pruneExpired(now) {
  let prunedAny = false;
  for (const [key, entry] of claims) {
    if (now - entry.at > TTL_MS) {
      claims.delete(key);
      prunedAny = true;
    }
  }
  if (prunedAny) {
    claimsDebug("pruned expired claims");
  }
  return prunedAny;
}

export default {
  /**
   * Claims a review for `login`, replacing any existing claim on this pull
   * (last-writer-wins). `now` defaults to Date.now() but can be injected for
   * testing.
   */
  claim(repo, number, login, now = Date.now()) {
    pruneExpired(now);
    const entry = { login, at: now };
    claims.set(keyFor(repo, number), entry);
    claimsDebug("claim %s by %s", keyFor(repo, number), login);
    return entry;
  },

  /**
   * Releases a review claim, but only if `login` is the one who currently
   * holds it. Returns whether the release took effect.
   */
  release(repo, number, login, now = Date.now()) {
    pruneExpired(now);
    const key = keyFor(repo, number);
    const entry = claims.get(key);
    const owned = Boolean(entry) && entry.login === login;
    if (owned) {
      claims.delete(key);
      claimsDebug("release %s by %s", key, login);
    }
    return owned;
  },

  /**
   * The whole claims map as a plain object: `{ "repo#number": { login, at } }`.
   */
  all(now = Date.now()) {
    pruneExpired(now);
    return Object.fromEntries(claims);
  },

  /**
   * Removes expired entries without touching a specific claim. Used by the
   * periodic sweep in app.js, and exposed so TTL behavior can be tested
   * directly by injecting `now` instead of mocking Date. Returns whether
   * anything was removed.
   */
  prune(now = Date.now()) {
    return pruneExpired(now);
  },
};
