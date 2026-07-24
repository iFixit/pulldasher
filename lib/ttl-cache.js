/**
 * Shared building blocks for the hand-rolled TTL caches scattered across
 * controllers/stats.js, controllers/user-names.js, and lib/api-auth.js -- each
 * memoizes something slow-changing (a query, a GitHub lookup, a token) behind
 * its own "is this entry still fresh?" check. Factored out so that check --
 * and the get-or-compute shape built on it -- isn't hand-rolled three times.
 */

/**
 * Whether a cache entry timestamped `entry.at` (epoch ms) is still within
 * `ttlMs` of `now`. A missing/falsy entry is never fresh.
 */
export function isFresh(entry, ttlMs, now = Date.now()) {
   return Boolean(entry) && now - entry.at < ttlMs;
}

/**
 * Get `key`'s entry from `cache` (a Map) if it's still fresh under `ttlMs`;
 * otherwise `compute()` a replacement (may be async), store it stamped with
 * the current time under `at`, and return that instead.
 *
 * `compute` returns the entry's other fields (e.g. `{ name }`, `{ entry }`) --
 * `at` is added here, not by the caller, so every cache stamps it the same
 * way.
 */
export async function getOrSet(cache, key, ttlMs, compute, now = Date.now()) {
   const hit = cache.get(key);
   if (isFresh(hit, ttlMs, now)) {
      return hit;
   }

   const value = await compute();
   const entry = { ...value, at: Date.now() };
   cache.set(key, entry);
   return entry;
}
