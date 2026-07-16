import { useCallback, useSyncExternalStore } from 'react';
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

const SCOPE_KEY = 'pd2.scope';

function loadScope(): Scope {
   try {
      return {
         repos: [],
         authors: [],
         ...(JSON.parse(localStorage.getItem(SCOPE_KEY) ?? '{}') as object),
      };
   } catch {
      return { repos: [], authors: [] };
   }
}

let scope = loadScope();
const listeners = new Set<() => void>();

export function useScope(): [Scope, (next: Scope) => void] {
   const value = useSyncExternalStore(
      fn => {
         listeners.add(fn);
         return () => listeners.delete(fn);
      },
      () => scope
   );
   const setScope = useCallback((next: Scope) => {
      scope = next;
      localStorage.setItem(SCOPE_KEY, JSON.stringify(next));
      for (const fn of listeners) fn();
   }, []);
   return [value, setScope];
}

/**
 * Team → members config for the Teams lens and the scope presets. Served as
 * a static file next to the app (see teams.example.json); absent file means
 * no team features, everything else still works.
 */
export async function loadTeams(): Promise<Team[]> {
   try {
      const res = await fetch(`${import.meta.env.BASE_URL}teams.json`);
      if (!res.ok) return [];
      const teams = (await res.json()) as Team[];
      return Array.isArray(teams) ? teams : [];
   } catch {
      return [];
   }
}
