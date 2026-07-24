import { useSyncExternalStore } from 'react';
import { isDummy } from '../backend/dummy';
import { readSessionStorage, writeSessionStorage } from '../storage';

/**
 * Login -> human display name, resolved server-side via GET /user-names (the
 * server's own Octokit-backed cache -- see controllers/user-names.js). PRs
 * only ever carry GitHub logins on the wire; this is the one place that
 * turns them into names for display, following the same
 * subscribe/useSyncExternalStore store shape as store.ts and settings.ts.
 *
 * `raw[login]` states:
 *   - absent:  never requested, or a request for it is still pending/in flight
 *   - null:    resolved -- GitHub has no name on file (or the login 404s)
 *   - string:  resolved -- this is the name
 */

const STORAGE_KEY = 'pd2.names';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEBOUNCE_MS = 250;
// Mirrors the server's own per-request cap (controllers/user-names.js
// MAX_LOGINS) -- chunk instead of risking a 400 if a lot piles up in one
// debounce window (e.g. a big Team view mounting at once).
const MAX_LOGINS_PER_FETCH = 100;

interface StoredNames {
   at: number; // epoch ms this was written
   names: Record<string, string | null>;
}

function loadCache(): Record<string, string | null> {
   try {
      const stored = readSessionStorage(STORAGE_KEY);
      if (!stored) return {};
      const parsed = JSON.parse(stored) as Partial<StoredNames>;
      if (typeof parsed.at !== 'number' || Date.now() - parsed.at > CACHE_TTL_MS) return {};
      return parsed.names ?? {};
   } catch {
      return {};
   }
}

const raw: Record<string, string | null> = loadCache();
let snapshot: Readonly<Record<string, string | null>> = raw;
const listeners = new Set<() => void>();

function publish() {
   snapshot = { ...raw };
   const stored: StoredNames = { at: Date.now(), names: raw };
   writeSessionStorage(STORAGE_KEY, JSON.stringify(stored));
   for (const fn of listeners) fn();
}

// A handful of the dummy fixture's own logins (frontend-v2/public/dummy-pulls.json
// user.logins), given plausible human names so the demo board (?dummy=1)
// shows real-looking display names fully offline. Every other login resolves
// to null, same as a real login GitHub has no public name for.
const DUMMY_NAMES: Record<string, string> = {
   danielbeardsley: 'Daniel Beardsley',
   sctice: 'Scott Tice',
   jarstelfox: 'Jarred Stelfox',
   'addison-grant': 'Addison Grant',
   evannoronha: 'Evan Noronha',
   zdmitchell: 'Zach Mitchell',
   cdcline: 'Casey Cline',
   ardelato: 'Art Delato',
};

let pendingBatch = new Set<string>();
const inFlight = new Set<string>();
let scheduled = false;

function chunk<T>(items: T[], size: number): T[][] {
   const out: T[][] = [];
   for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
   return out;
}

function flushBatch() {
   scheduled = false;
   if (pendingBatch.size === 0) return;
   const batch = [...pendingBatch];
   pendingBatch = new Set();
   for (const login of batch) inFlight.add(login);

   for (const group of chunk(batch, MAX_LOGINS_PER_FETCH)) {
      fetch(`/user-names?${new URLSearchParams({ logins: group.join(',') })}`)
         .then(r => (r.ok ? (r.json() as Promise<{ names: Record<string, string | null> }>) : null))
         .then(result => {
            for (const login of group) {
               raw[login] = result?.names?.[login] ?? null;
               inFlight.delete(login);
            }
            publish();
         })
         .catch(() => {
            // Transient failure: drop from in-flight but leave it out of
            // `raw` entirely, so it stays "unknown" rather than permanently
            // caching a null from a network blip -- a later requestNames()
            // call for the same login retries it.
            for (const login of group) inFlight.delete(login);
         });
   }
}

function scheduleFetch() {
   if (scheduled) return;
   scheduled = true;
   setTimeout(flushBatch, DEBOUNCE_MS);
}

/**
 * Ask to resolve `logins` to display names. Dedupes against logins already
 * known (resolved, even to null) or currently pending/in flight, then folds
 * every new login requested within one DEBOUNCE_MS window into a single
 * /user-names fetch -- a lane full of rows mounting at once (My work, Review)
 * asks once, not once per row.
 *
 * Dummy mode (?dummy=1) never touches the network: it resolves synchronously
 * from a small fixture map so the demo board works fully offline.
 */
export function requestNames(logins: Iterable<string>): void {
   const toResolve: string[] = [];
   for (const login of logins) {
      if (!login) continue;
      if (Object.prototype.hasOwnProperty.call(raw, login)) continue;
      if (inFlight.has(login) || pendingBatch.has(login)) continue;
      toResolve.push(login);
   }
   if (toResolve.length === 0) return;

   if (isDummy()) {
      for (const login of toResolve) raw[login] = DUMMY_NAMES[login] ?? null;
      publish();
      return;
   }

   for (const login of toResolve) pendingBatch.add(login);
   scheduleFetch();
}

/** Plain getter for non-React callers, mirroring settings.ts's getSettings(). */
export function getNames(): Readonly<Record<string, string | null>> {
   return snapshot;
}

export function useNames(): Readonly<Record<string, string | null>> {
   return useSyncExternalStore(
      fn => {
         listeners.add(fn);
         return () => listeners.delete(fn);
      },
      () => snapshot
   );
}

/** The name if known and non-null, else null -- never "" or undefined, so
 * callers can render it directly or fall back to the login. */
export function displayName(
   names: Readonly<Record<string, string | null>>,
   login: string
): string | null {
   const name = names[login];
   return typeof name === 'string' && name.length > 0 ? name : null;
}
