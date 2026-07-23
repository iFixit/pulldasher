import git from '../lib/git-manager.js';
import debug from '../lib/debug.js';

const userNamesDebug = debug('pulldasher:user-names');

// This moves slowly (a login's display name essentially never changes) and
// every open pull re-requests the same handful of authors/reviewers, so cache
// per-login for a day, shared across every request (mirrors controllers/stats.js's
// CACHE_TTL_MS memo). A 404/error caches to `null` too (negative cache) --
// otherwise a bot or deleted account would hit GitHub on every single request.
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// GitHub logins are already short; capping the batch keeps one request from
// fanning out into an unbounded number of concurrent Octokit calls.
export const MAX_LOGINS = 100;

const CONCURRENCY = 5;

// GitHub logins are alphanumeric + hyphens; app-created logins add a
// `[bot]` suffix (e.g. `dependabot[bot]`). Anything else isn't a login this
// endpoint will ever legitimately be asked about.
export const LOGIN_RE = /^[A-Za-z0-9-[\]]+$/;

export function isValidLogin(login) {
   return typeof login === 'string' && LOGIN_RE.test(login);
}

/**
 * Splits "alice, bob,,alice" into ["alice", "bob"] -- trimmed, blanks
 * dropped, de-duplicated (first occurrence wins), order preserved. Does not
 * filter by isValidLogin -- callers decide what to do with the ones that
 * fail sanitization.
 */
export function parseLoginsParam(raw) {
   if (!raw) return [];
   const seen = new Set();
   for (const part of raw.split(',')) {
      const login = part.trim();
      if (login) seen.add(login);
   }
   return [...seen];
}

/**
 * Whether a cache entry ({ name, at }) is still within CACHE_TTL_MS of `now`.
 * A missing entry is never fresh.
 */
export function isFresh(entry, now = Date.now()) {
   return Boolean(entry) && now - entry.at < CACHE_TTL_MS;
}

/**
 * Resolves `logins` (already sanitized, deduplicated) to display names.
 * Reuses any entry in `cache` still fresh under CACHE_TTL_MS; fetches the
 * rest through `fetcher` (real callers pass one backed by Octokit; tests pass
 * a stub) with at most `concurrency` requests in flight at once. GitHub's
 * rate limit is already handled by the Octokit throttling plugin (see
 * lib/git-manager.js) -- this concurrency cap only exists so a 100-login
 * request doesn't open 100 sockets at once, not as a second rate limiter.
 *
 * `cache` is a login -> { name, at } Map, mutated in place -- including
 * negative entries, so a login that 404s or errors is remembered as `null`
 * for CACHE_TTL_MS rather than retried on every request. Production callers
 * share one Map across requests (module-level, below); tests pass a fresh one.
 */
export async function resolveNames(
   logins,
   { cache, fetcher, concurrency = CONCURRENCY, now = Date.now() }
) {
   const toFetch = logins.filter(login => !isFresh(cache.get(login), now));
   const queue = [...toFetch];

   async function worker() {
      let login;
      while ((login = queue.shift()) !== undefined) {
         const name = await fetcher(login);
         cache.set(login, { name, at: Date.now() });
      }
   }

   await Promise.all(Array.from({ length: Math.min(concurrency, toFetch.length) }, worker));

   const names = {};
   for (const login of logins) {
      names[login] = cache.get(login)?.name ?? null;
   }
   return names;
}

/** Real fetcher: one login's `name` field from GitHub (may legitimately be
 * null -- lots of users don't set one). Never rejects -- a 404 (deleted/renamed
 * account) or any other error just resolves to null, same as "no name set". */
function githubFetcher(login) {
   return git.github.users
      .getByUsername({ username: login })
      .then(res => res.data.name ?? null)
      .catch(err => {
         userNamesDebug(
            'Could not fetch name for %s: %s',
            login,
            (err && err.status) || (err && err.message) || err
         );
         return null;
      });
}

// Shared across every request for the life of the process.
const cache = new Map();

export default {
   /**
    * GET /user-names?logins=a,b,c -- resolve GitHub logins to human display
    * names, for the frontend's people-facing UI (PRs only carry logins on
    * the wire). Auth-gated exactly like /token (see lib/authentication.js
    * setupRoutes). Every requested login gets an entry in the response, even
    * ones that fail sanitization or that GitHub has no name for -- those are
    * `null`, never dropped from the response shape.
    */
   getNames: function (req, res) {
      const raw = typeof req.query.logins === 'string' ? req.query.logins : '';
      const requested = parseLoginsParam(raw);

      if (requested.length > MAX_LOGINS) {
         return res.status(400).json({ error: `logins capped at ${MAX_LOGINS} per request` });
      }

      const validLogins = requested.filter(isValidLogin);

      resolveNames(validLogins, { cache, fetcher: githubFetcher })
         .then(names => {
            const body = {};
            for (const login of requested) {
               body[login] = names[login] ?? null;
            }
            res.json({ names: body });
         })
         .catch(err => {
            console.error('user-names query failed:', err);
            res.status(500).json({ error: 'user-names query failed' });
         });
   },
};
