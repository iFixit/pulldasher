import { createPersistentStore } from './storage';
import type { Team } from './types';

/**
 * Scope is the one saved customization: which repos and people are "my
 * board". Empty arrays mean everything — a full selection is stored as
 * empty so new repos and new teammates are never silently excluded by a
 * stale saved list.
 */
export interface Scope {
   repos: string[];
   authors: string[];
}

const store = createPersistentStore<Scope>('pd2.scope', { repos: [], authors: [] });

/**
 * Apply a scope from a shared URL for this session WITHOUT persisting it —
 * opening a teammate's link must not silently overwrite your saved board.
 * The moment the user edits the scope themselves, useScope's setter saves
 * as usual.
 */
export function primeScope(next: Scope) {
   store.prime(next);
}

export function useScope(): [Scope, (next: Scope) => void] {
   // store.set is a stable module-level reference, so it's safe to hand out
   // directly as the setter without wrapping it in useCallback.
   return [store.useValue(), store.set];
}

export interface SiteConfig {
   /** team → members, for the People lens chips and scope presets */
   teams: Team[];
   /** bot logins beyond the `[bot]` suffix GitHub Apps carry */
   bots: string[];
}

/**
 * Deployment-specific config, served as a static file next to the app (see
 * config.example.json). Absent file means no team features and suffix-only
 * bot detection; everything else still works.
 */
export async function loadSiteConfig(): Promise<SiteConfig> {
   const none: SiteConfig = { teams: [], bots: [] };
   try {
      const res = await fetch(`${import.meta.env.BASE_URL}config.json`);
      if (!res.ok) return none;
      const raw = (await res.json()) as { teams?: unknown; bots?: unknown };
      const teams = Array.isArray(raw.teams) ? raw.teams : [];
      const bots = Array.isArray(raw.bots) ? raw.bots : [];
      return {
         // one malformed entry must not white-screen the whole app
         teams: teams.filter(
            (t): t is Team =>
               !!t &&
               typeof (t as Team).team === 'string' &&
               Array.isArray((t as Team).members) &&
               (t as Team).members.every(m => typeof m === 'string')
         ),
         bots: bots.filter((b): b is string => typeof b === 'string'),
      };
   } catch {
      return none;
   }
}
