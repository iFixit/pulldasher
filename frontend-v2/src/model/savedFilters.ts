import { createPersistentStore } from '../storage';

/**
 * A named bookmark of the SESSION filter state — the same fields buildHash
 * (app.tsx) writes to location.hash: lens, q, repos, authors, weight, state,
 * hidden, reveal, drafts. `hash` is stored verbatim (no leading '#') so
 * applying one is just `location.hash = hash`; the app's existing hashchange
 * listener does the rest. Durable per-browser prefs (hidden repos/people, stars, myTeam)
 * are deliberately NOT part of this — they aren't in the hash to begin with.
 */
export interface SavedFilter {
   name: string;
   hash: string;
}

/** Oldest saved filter is evicted once a save would push the list past this —
 * a save always succeeds, it just ages out your least-recently-saved one
 * rather than making the user delete something first. */
export const SAVED_FILTERS_CAP = 8;

interface SavedFiltersData {
   items: SavedFilter[];
}

const store = createPersistentStore<SavedFiltersData>('pd2.savedFilters', { items: [] });

/**
 * Two starter filters shown only until the user has saved one of their own —
 * not persisted, so they can't be "removed" (they just stop being offered).
 */
export const SUGGESTED_FILTERS: SavedFilter[] = [
   { name: 'Waiting on you', hash: 'state=review,qa,restamp,mine' },
   { name: 'Quick wins', hash: 'weight=xs,s&state=review,qa' },
];

/**
 * Pure add: saving under a name that already exists replaces that entry
 * in place (and counts as the most-recently-saved one for eviction) instead
 * of growing the list with a duplicate label. Once the list would exceed
 * SAVED_FILTERS_CAP, the oldest entries age out. A blank (post-trim) name is
 * a no-op — the caller's form disables Save for that case, but this stays
 * correct either way.
 */
export function addSavedFilter(items: SavedFilter[], name: string, hash: string): SavedFilter[] {
   const trimmed = name.trim();
   if (!trimmed) return items;
   const next = [...items.filter(f => f.name !== trimmed), { name: trimmed, hash }];
   return next.length > SAVED_FILTERS_CAP ? next.slice(next.length - SAVED_FILTERS_CAP) : next;
}

/** Pure remove, by name. Removing a name that isn't present is a no-op. */
export function removeSavedFilter(items: SavedFilter[], name: string): SavedFilter[] {
   return items.filter(f => f.name !== name);
}

/** Save (or overwrite) a named filter to the persistent store. */
export function saveFilter(name: string, hash: string): void {
   store.set({ items: addSavedFilter(store.get().items, name, hash) });
}

/** Remove a saved filter from the persistent store. */
export function deleteFilter(name: string): void {
   store.set({ items: removeSavedFilter(store.get().items, name) });
}

export function useSavedFilters(): SavedFilter[] {
   return store.useValue().items;
}

/** Navigate to a saved/suggested filter's hash — the app's hashchange
 * listener (app.tsx) reads it back into every piece of session state. */
export function applySavedFilter(hash: string): void {
   location.hash = hash;
}

const LENS_LABEL: Record<string, string> = {
   review: 'Review',
   mine: 'My work',
   team: 'Team',
   // legacy: the People tab merged into Team; old saved hashes still say it
   people: 'Team',
   classic: 'Classic',
   stats: 'Stats',
};

/**
 * A muted one-line gloss of a stored hash, e.g.
 * "state: qa, review · weight: xs, s · Review lens" — parses the same
 * param names buildHash (app.tsx) writes, so a saved/suggested filter can
 * describe itself without needing the live session state it came from.
 * Unrecognized or absent params are silently skipped; a hash with nothing
 * recognizable describes itself as "everything" (which is also what
 * applying it does: no narrowing at all).
 */
export function describeHash(hash: string): string {
   const p = new URLSearchParams(hash);
   const parts: string[] = [];
   const list = (key: string, label: string) => {
      const v = p.get(key);
      if (v) parts.push(`${label}: ${v.split(',').filter(Boolean).join(', ')}`);
   };
   list('state', 'state');
   list('weight', 'weight');
   const q = p.get('q');
   if (q) parts.push(`"${q}"`);
   list('repos', 'repo');
   list('authors', 'author');
   const drafts = p.get('drafts');
   if (drafts) parts.push(`drafts: ${drafts}`);
   if (p.get('hidden') === '1') parts.push('showing hidden');
   const person = p.get('person');
   if (person) parts.push(`person: ${person}`);
   const team = p.get('team');
   if (team) parts.push(`team: ${team}`);
   const lens = p.get('lens');
   if (lens) parts.push(`${LENS_LABEL[lens] ?? lens} lens`);
   return parts.length ? parts.join(' · ') : 'everything';
}
