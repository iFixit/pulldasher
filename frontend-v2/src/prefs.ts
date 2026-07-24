import { createMemoryStore, removeStorage } from './storage';

/**
 * Scope is TRANSIENT view state — which repos and people the board is
 * narrowed to right now. Empty arrays mean everything. It lives in memory
 * and in the URL hash (repos=/authors=/xauthors=), never in localStorage:
 * the hash is the view state, and a second, invisible persistence resurrected
 * months-old allow-lists on hash-less loads — a stale scope naming a hidden
 * repo counted as an "explicit reveal" and kept its pulls on the board no
 * matter how often the user hid it (the prod mute bug). Durable curation
 * (hidden repos/people, rosters) belongs to settings, not scope.
 */
export interface Scope {
   repos: string[];
   authors: string[];
   /** logins scoped OUT — "everyone except" (an excluding saved search).
    * Always present: the store's defaults merge fills it in. */
   notAuthors: string[];
}

/**
 * Toggle one member of a scope's allow-list (authors or repos) — the trio
 * PeopleFilter and RepoFilter each hand-rolled identically (a `commit`, a
 * `toggleScope`, fused here into one pure step). Encodes the two conventions
 * both panels rely on: an empty list means "everyone"/"every repo", so
 * toggling the first member off a blank slate starts from the full `all`
 * list (selecting everyone else); and selecting every member back out
 * collapses to empty rather than storing the full list explicitly, so the
 * filter reads as "off" again instead of a fully-enumerated no-op scope.
 */
export function toggleScopeMember(
   scope: Scope,
   field: 'authors' | 'repos',
   value: string,
   all: string[]
): Scope {
   const cur = scope[field].length ? [...scope[field]] : [...all];
   const i = cur.indexOf(value);
   if (i >= 0) cur.splice(i, 1);
   else cur.push(value);
   return { ...scope, [field]: all.length && all.every(x => cur.includes(x)) ? [] : cur };
}

const store = createMemoryStore<Scope>({ repos: [], authors: [], notAuthors: [] });

// housekeeping for the persistence this store used to have: drop the old
// key so a future reader can't mistake it for live state
removeStorage('pd2.scope');

/** Apply a scope from the URL hash (load or hashchange). Same as setScope —
 * kept as a named door because the hash is scope's one durable carrier. */
export function primeScope(next: Scope) {
   store.set(next);
}

export function useScope(): [Scope, (next: Scope) => void] {
   // store.set is a stable module-level reference, so it's safe to hand out
   // directly as the setter without wrapping it in useCallback.
   return [store.useValue(), store.set];
}
