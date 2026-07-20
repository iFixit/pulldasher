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
   /** desktop notifications when your PR is ready to merge / a re-review is owed */
   notify: boolean;
   /** play a chime alongside those notifications */
   notifySound: boolean;
   /** in-app "cheers": playful rewards when your reviews land and gentle nags
    * when they pile up. Session-only, fires while you're on the board. */
   cheers: boolean;
   /** rows a lane shows before folding into "+N more"; 0 = no cap (show all) */
   laneCap: number;
   /** teams that self-review (iFixit) don't gate on CR, so lining up QA is the
    * real stall: surface "Find a QA-er" on your own PR as a home to-do, not a
    * My-work afterthought. Off leaves getting QA in My work only. */
   selfReview: boolean;
   /** the repos you actually review, so the review queue leads with them and
    * folds the rest away. Repo relevance is per-person (a web dev and a
    * firmware dev share a monorepo but little else). Empty = infer from the
    * repos where you've authored or stamped on the current board. */
   primaryRepos: string[];
   /** logins of your teammates (you are implicit; not GitHub teams — a
    * per-browser list powering the Team lens and the "Your team" filter). */
   myTeam: string[];
   /** logins you star — their pulls float to the front of the review queue,
    * Needs QA, and the People chip list. No org baseline (unlike repos): a
    * simple two-state per-person toggle. */
   starredPeople: string[];
   /** logins whose pulls stay off your board until an explicit reveal (a
    * scope pick or an author: query term) brings them back for the session.
    * Mirrors repoPrefs' mute, but people have no org baseline to fall back
    * to — muting is the whole state. */
   mutedPeople: string[];
   /** free-text areas you own or care about (e.g. "Growthbook", "Shopify").
    * A PR whose title, body, labels, branch, or repo partial-matches any of
    * these floats to the top of the review queue. Arbitrary strings, not a
    * known set — unlike repos/logins. */
   codeRegions: string[];
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
   notify: false,
   notifySound: false,
   cheers: true,
   laneCap: 10,
   selfReview: true,
   primaryRepos: [],
   myTeam: [],
   starredPeople: [],
   mutedPeople: [],
   codeRegions: [],
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

/** Add or remove a repo from your primary (actively-reviewed) set. */
export function togglePrimaryRepo(repo: string, primary: boolean) {
   const cur = store.get().primaryRepos;
   const next = primary ? [...new Set([...cur, repo])] : cur.filter(r => r !== repo);
   setSettings({ primaryRepos: next });
}

/** Add or remove a teammate. Deduped and sorted so the Team view and picker
 * render in a stable order regardless of insertion order. */
export function toggleTeammate(login: string, add: boolean) {
   const cur = store.get().myTeam;
   const next = add ? [...new Set([...cur, login])].sort() : cur.filter(l => l !== login);
   setSettings({ myTeam: next });
}

/** Star or unstar a person. Deduped and sorted for a stable render order. */
export function toggleStarredPerson(login: string, on: boolean) {
   const cur = store.get().starredPeople;
   const next = on ? [...new Set([...cur, login])].sort() : cur.filter(l => l !== login);
   setSettings({ starredPeople: next });
}

/** Mute or unmute a person. Deduped and sorted for a stable render order. */
export function toggleMutedPerson(login: string, on: boolean) {
   const cur = store.get().mutedPeople;
   const next = on ? [...new Set([...cur, login])].sort() : cur.filter(l => l !== login);
   setSettings({ mutedPeople: next });
}

/** Add a code region (trimmed). Deduped case-insensitively so "Shopify" and
 * "shopify" don't both land; stored as first typed, newest last so the editor
 * reads in the order you added them. */
export function addCodeRegion(region: string) {
   const trimmed = region.trim();
   if (!trimmed) return;
   const cur = store.get().codeRegions;
   if (cur.some(r => r.toLowerCase() === trimmed.toLowerCase())) return;
   setSettings({ codeRegions: [...cur, trimmed] });
}

/** Remove a code region (exact match). */
export function removeCodeRegion(region: string) {
   setSettings({ codeRegions: store.get().codeRegions.filter(r => r !== region) });
}

export function useSettings(): Settings {
   return store.useValue();
}

/** Non-React subscription, for the store to re-derive when a setting that
 * feeds the model (the aging threshold) changes. Returns an unsubscribe. */
export const subscribeSettings = store.subscribe;
