/**
 * In-memory "who's reviewing this PR" review-claim map, keyed `repo#number`.
 *
 * This is purely social, not a lock: claiming over someone else's claim is
 * allowed on purpose (a deliberate correction, not blocked -- last writer
 * wins). Nothing here is persisted anywhere; a server restart clears every
 * claim, by design.
 *
 * Each claim carries its own expiry: the claimer's client sends how long the
 * claim should last, so one person's 1-hour claim and another's 8-hour claim
 * age independently. An absent or out-of-range length falls back to
 * DEFAULT_TTL_MS, clamped to [MIN_TTL_MS, MAX_TTL_MS] so a client can't pin a
 * claim forever. `expiresAt` stays server-side; the broadcast entry is still
 * just `{ login, at }`, so older clients are unaffected.
 *
 * Entries are pruned lazily (on any read or write) once they're past their own
 * expiry, so a stale claim never lingers past the next touch. app.js also runs
 * a periodic sweep on SWEEP_INTERVAL_MS so a claim goes away even if nobody
 * claims/releases/reads in the meantime.
 */
import debug from './debug.js';

const claimsDebug = debug('pulldasher:claims');

export const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
// kept as TTL_MS for backwards compatibility with existing importers/tests
export const TTL_MS = DEFAULT_TTL_MS;
export const MIN_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

const claims = new Map();

function keyFor(repo, number) {
   return `${repo}#${number}`;
}

// A claim length the caller asked for, defaulted and clamped so a claim always
// has a sane, finite lifetime.
function clampTtl(ttlMs) {
   if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs)) {
      return DEFAULT_TTL_MS;
   }
   return Math.max(MIN_TTL_MS, Math.min(MAX_TTL_MS, ttlMs));
}

// The wire/return shape: expiry is a server-internal detail, so callers and the
// broadcast only ever see { login, at }.
function publicEntry(entry) {
   return { login: entry.login, at: entry.at };
}

// Deletes claims past their own expiry as of `now`. Returns whether anything
// was removed, so callers can tell whether the map actually changed.
function pruneExpired(now) {
   let prunedAny = false;
   for (const [key, entry] of claims) {
      if (now > entry.expiresAt) {
         claims.delete(key);
         prunedAny = true;
      }
   }
   if (prunedAny) {
      claimsDebug('pruned expired claims');
   }
   return prunedAny;
}

export default {
   /**
    * Claims a review for `login`, replacing any existing claim on this pull
    * (last-writer-wins). `now` defaults to Date.now() but can be injected for
    * testing. `ttlMs` is the requested claim length; absent/out-of-range falls
    * back to DEFAULT_TTL_MS, clamped to [MIN_TTL_MS, MAX_TTL_MS]. Returns the
    * public `{ login, at }` entry.
    */
   claim(repo, number, login, now = Date.now(), ttlMs) {
      pruneExpired(now);
      const entry = { login, at: now, expiresAt: now + clampTtl(ttlMs) };
      claims.set(keyFor(repo, number), entry);
      claimsDebug('claim %s by %s until %d', keyFor(repo, number), login, entry.expiresAt);
      return publicEntry(entry);
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
         claimsDebug('release %s by %s', key, login);
      }
      return owned;
   },

   /**
    * The whole claims map as a plain object: `{ "repo#number": { login, at } }`.
    */
   all(now = Date.now()) {
      pruneExpired(now);
      const out = {};
      for (const [key, entry] of claims) {
         out[key] = publicEntry(entry);
      }
      return out;
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
