import crypto from 'crypto';
import config from './config-loader.js';
import debug from './debug.js';
import { confirmOrgMembership } from './authentication.js';
import { getOrSet } from './ttl-cache.js';

const authDebug = debug('pulldasher:api-auth');
const FAKE_USER = process.env.MOCK_AUTH_AS_USER;
const TTL_MS = 5 * 60 * 1000;
/** a GitHub App installation token lives an hour, so its verdict can too */
const INSTALLATION_TTL_MS = 60 * 60 * 1000;
/** methods an installation token may use: it reads, never writes */
const READS = new Set(['GET', 'HEAD']);

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
   if (res.status === 401) {
      // a definitively bad/revoked token: safe to remember as invalid for the TTL
      authDebug('token /user lookup unauthorized: %s', res.status);
      return null;
   }
   if (!res.ok) {
      // transient (secondary rate limit, 5xx): throwing keeps getOrSet from
      // caching a blip as "invalid token" and locking out a valid caller for 5 min
      throw new Error(`github /user lookup failed: ${res.status}`);
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

/** The organizations this Pulldasher serves: config.js's requireOrg, else
 * the owners of its repos, lowercased. */
function servedOrgs() {
   if (config.github.requireOrg) return new Set([config.github.requireOrg.toLowerCase()]);
   return new Set(config.repos.map(r => r.name.split('/')[0].toLowerCase()));
}

/**
 * Whether a GitHub App installation token (`ghs_...`, what a workflow's
 * GitHub App step hands a job) belongs to an installation on an
 * organization this Pulldasher serves: GitHub lists an installation's
 * repositories to its own token, and the first one's owner says whose it
 * is. Throws on a transient failure, like githubLoginForToken.
 */
async function installationAllowed(token) {
   const res = await fetch('https://api.github.com/installation/repositories?per_page=1', {
      headers: {
         Authorization: `Bearer ${token}`,
         'User-Agent': 'pulldasher',
         Accept: 'application/vnd.github+json',
      },
   });
   if (res.status === 401) return { invalid: true };
   if (!res.ok) throw new Error(`github installation lookup failed: ${res.status}`);
   const data = await res.json();
   const owner = data.repositories?.[0]?.owner?.login;
   return owner && servedOrgs().has(owner.toLowerCase())
      ? { installation: true }
      : { forbidden: true };
}

async function resolveInstallation(token) {
   const cached = await getOrSet(cache, keyFor(token), INSTALLATION_TTL_MS, async () => ({
      entry: await installationAllowed(token),
   }));
   return cached.entry;
}

async function resolveUser(token) {
   const key = keyFor(token);
   const cached = await getOrSet(cache, key, TTL_MS, async () => {
      const login = await githubLoginForToken(token);
      if (!login) return { entry: { invalid: true } };
      if (await isOrgAllowed(login)) return { entry: { login } };
      return { entry: { forbidden: true } };
   });
   return cached.entry;
}

/**
 * Bearer auth for /api/v1: the caller sends its OWN GitHub token
 * (`Authorization: Bearer <gh token>`). We resolve it to a login against
 * GitHub (cached ~5 min) and apply the same org gate the web login uses. No
 * new credential is minted or stored -- the token is the caller's, scoped and
 * revocable by them, and the same one the downstream review work already
 * needs. MOCK_AUTH_AS_USER bypasses for local dev, mirroring lib/authentication.
 * A GitHub App installation token (`ghs_`, a CI job's) reads only: it has no
 * login to record a write as, so anything but a GET is refused before
 * GitHub is asked, and a GET is let in when the installation is on the org
 * this Pulldasher serves (req.apiUser then has a null login).
 */
export default function apiAuth(req, res, next) {
   if (FAKE_USER) {
      req.apiUser = { login: FAKE_USER };
      return next();
   }
   const header = req.get('authorization') || '';
   const match = header.match(/^Bearer\s+(.+)$/i);
   if (!match) return res.status(401).json({ error: 'missing bearer token' });
   const token = match[1].trim();
   const installation = token.startsWith('ghs_');
   if (installation && !READS.has(req.method)) {
      return res.status(403).json({
         error: "a GitHub App installation token can only read; send a person's GitHub token to make changes",
      });
   }

   (installation ? resolveInstallation(token) : resolveUser(token))
      .then(entry => {
         if (entry.invalid) return res.status(401).json({ error: 'invalid github token' });
         if (entry.forbidden) {
            const whose = installation
               ? 'an installation on another organization'
               : `not a member of ${config.github.requireOrg}`;
            return res.status(403).json({ error: whose });
         }
         req.apiUser = installation ? { login: null, installation: true } : { login: entry.login };
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
