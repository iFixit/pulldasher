import { ROT_DAYS, STARVE_DAYS } from './model/status';
import { createPersistentStore } from './storage';

/**
 * User settings: the knobs that are a matter of personal taste, not team
 * policy (that's config.json) or model correctness (that's the sort and
 * starvation math). Persisted per-browser, same as scope. New fields fall
 * back to their default so an old saved blob never breaks.
 */
export interface Settings {
   /** 'system' follows the OS; the others pin it */
   theme: 'system' | 'light' | 'dark';
   /** row height: comfortable is the default, compact packs more on screen */
   density: 'comfortable' | 'compact';
   /** which lens a bare /v2/ URL opens */
   defaultLens: string;
   /** a PR's age turns amber at this many days (display only) */
   ageWarnDays: number;
   /** and red at this many (display only) */
   ageRotDays: number;
   /** seconds of attention before leaving stamps "last seen" (the glance guard) */
   seenAfterSecs: number;
   /** per-repo override of the org baseline: 'mute' hides a shown repo,
    * 'show' reveals an org-hidden one. Absent = follow the org default. */
   repoPrefs: Record<string, 'mute' | 'show'>;
   /** your default for other people's drafts: 'mine' hides them (your own
    * always show), 'all' shows everyone's */
   draftsMode: 'mine' | 'all';
   /** your default for Cryogenic-Storage (parked) PRs */
   showCryo: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
   theme: 'system',
   density: 'comfortable',
   defaultLens: 'review',
   ageWarnDays: STARVE_DAYS,
   ageRotDays: ROT_DAYS,
   seenAfterSecs: 45,
   repoPrefs: {},
   draftsMode: 'mine',
   showCryo: false,
};

const store = createPersistentStore('pd2.settings', DEFAULT_SETTINGS);

/** Plain getter for non-React readers (the store's glance guard). */
export function getSettings(): Settings {
   return store.get();
}

export function setSettings(patch: Partial<Settings>) {
   store.set({ ...store.get(), ...patch });
}

/** Set or clear one repo's visibility override. null follows the org default. */
export function setRepoPref(repo: string, pref: 'mute' | 'show' | null) {
   const next = { ...store.get().repoPrefs };
   if (pref == null) delete next[repo];
   else next[repo] = pref;
   setSettings({ repoPrefs: next });
}

export function useSettings(): Settings {
   return store.useValue();
}
