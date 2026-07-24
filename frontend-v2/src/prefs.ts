import type { Weight } from './model/status';
import { createMemoryStore, removeStorage } from './storage';

const WEIGHTS: ReadonlySet<string> = new Set(['XS', 'S', 'M', 'L', 'XL']);

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

export interface SiteConfig {
   /** bot logins beyond the `[bot]` suffix GitHub Apps carry */
   bots: string[];
   /** label title → weight bucket. A PR carrying one of these labels takes
    * that weight instead of the diff-size guess, so an auto weight label (and
    * any manual override of it) drives the board. Empty = heuristic only. */
   weightLabels: Record<string, Weight>;
}

/**
 * Deployment-specific config, served as a static file next to the app (see
 * config.example.json). Absent file means suffix-only bot detection and
 * heuristic-only weights; everything else still works. A `teams` key in an
 * older config.json is simply ignored — org teams retired in favor of
 * personal rosters and their pinned saved searches.
 */
export async function loadSiteConfig(): Promise<SiteConfig> {
   const none: SiteConfig = { bots: [], weightLabels: {} };
   try {
      const res = await fetch(`${import.meta.env.BASE_URL}config.json`);
      if (!res.ok) return none;
      const raw = (await res.json()) as {
         bots?: unknown;
         weightLabels?: unknown;
      };
      const bots = Array.isArray(raw.bots) ? raw.bots : [];
      return {
         bots: bots.filter((b): b is string => typeof b === 'string'),
         weightLabels: parseWeightLabels(raw.weightLabels),
      };
   } catch {
      return none;
   }
}

/** Keep only entries that map a label title to a real weight bucket, so a typo
 * in config can't inject a bogus weight (the model would sort it as unknown). */
function parseWeightLabels(raw: unknown): Record<string, Weight> {
   if (!raw || typeof raw !== 'object') return {};
   const out: Record<string, Weight> = {};
   for (const [title, w] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof w === 'string' && WEIGHTS.has(w)) out[title] = w as Weight;
   }
   return out;
}
