import crypto from 'crypto';
import config from './config-loader.js';
import debug from './debug.js';
import { confirmOrgMembership } from './authentication.js';

const authDebug = debug('pulldasher:api-auth');
const FAKE_USER = process.env.MOCK_AUTH_AS_USER;
const TTL_MS = 5 * 60 * 1000;

// tokenHash -> { entry, at }. entry is { login } | { invalid: true } |
// { forbidden: true }. A short-lived identity cache so a burst of API calls
// costs one GitHub /user lookup, not one per request. Lost on restart (fine --
// it just re-resolves), never persisted, and keyed by a SHA-256 of the token
// so raw credentials aren't held as Map keys.
const cache = new Map();

function keyFor(token) {
   return crypto.createHash('sha256').update(token).digest('hex');
}

// Resolve a GitHub token to its login. Spends the *caller's* rate budget (the
// token is theirs), never the bot's. Returns null on any non-200.
async function githubLoginForToken(token) {
   const res = await fetch('https://api.github.com/user', {
      headers: {
         Authorization: `Bearer ${token}`,
         'User-Agent': 'pulldasher',
         Accept: 'application/vnd.github+json',
      },
   });
   if (!res.ok) {
      authDebug('token /user lookup failed: %s', res.status);
      return null;
   }
   const data = await res.json();
   return typeof data.login === 'string' ? data.login : null;
}

async function isOrgAllowed(login) {
   if (!config.github.requireOrg) return true;
   try {
      await confirmOrgMembership({ username: login });
      return true;
   } catch (err) {
      authDebug('membership check rejected %s: %s', login, (err && err.status) || err);
      return false;
   }
}

async function resolveUser(token) {
   const key = keyFor(token);
   const hit = cache.get(key);
   if (hit && Date.now() - hit.at < TTL_MS) return hit.entry;

   const login = await githubLoginForToken(token);
   let entry;
   if (!login) entry = { invalid: true };
   else if (await isOrgAllowed(login)) entry = { login };
   else entry = { forbidden: true };
   cache.set(key, { entry, at: Date.now() });
   return entry;
}

/**
 * Bearer auth for /api/v1: the caller sends its OWN GitHub token
 * (`Authorization: Bearer <gh token>`). We resolve it to a login against
 * GitHub (cached ~5 min) and apply the same org gate the web login uses. No
 * new credential is minted or stored -- the token is the caller's, scoped and
 * revocable by them, and the same one the downstream review work already
 * needs. MOCK_AUTH_AS_USER bypasses for local dev, mirroring lib/authentication.
 */
export default function apiAuth(req, res, next) {
   if (FAKE_USER) {
      req.apiUser = { login: FAKE_USER };
      return next();
   }
   const header = req.get('authorization') || '';
   const match = header.match(/^Bearer\s+(.+)$/i);
   if (!match) return res.status(401).json({ error: 'missing bearer token' });

   resolveUser(match[1].trim())
      .then(entry => {
         if (entry.invalid) return res.status(401).json({ error: 'invalid github token' });
         if (entry.forbidden) {
            return res.status(403).json({ error: `not a member of ${config.github.requireOrg}` });
         }
         req.apiUser = { login: entry.login };
         next();
      })
      .catch(err => {
         console.error('api auth failed:', err);
         res.status(500).json({ error: 'auth check failed' });
      });
}

/** test hook: reset the identity cache between cases. */
export function _clearAuthCache() {
   cache.clear();
}
