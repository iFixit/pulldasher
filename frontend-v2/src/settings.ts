import { STARVE_DAYS } from './model/status';
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
   /** which lens a bare / URL opens */
   defaultLens: string;
   /** a PR's age turns amber at this many days (display only). The heaviest
    * text tier (red) follows automatically at ageWarnDays * 2.5 — callers
    * derive that rotDays for AgeStamp/AgeBaseline (app.tsx, views/Stats.tsx)
    * instead of storing it separately. */
   ageWarnDays: number;
   /** which clock the row's age numeral shows: days since it opened, or days
    * since its last update. Both clocks stay in the numeral's popover, and
    * the urgency weight always follows the OPENED clock — how long a pull
    * has been open is the truth the board ranks by. */
   ageDisplay: 'opened' | 'updated';
   /** per-repo override of the org baseline: 'hide' hides a shown repo,
    * 'show' reveals an org-hidden one. Absent = follow the org default. */
   repoPrefs: Record<string, 'hide' | 'show'>;
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
   /** how long a cheer/nudge toast lingers before it slides away, in ms —
    * or 'sticky' to keep it until you dismiss it (or a newer one pushes it
    * off the top of the stack). */
   cheerDwell: number | 'sticky';
   /** how the recent-nudges bell flags what landed since you last opened it:
    * the running count, a bare dot, or nothing. */
   notifyBadge: 'count' | 'dot' | 'none';
   /** cheer/nudge kinds switched off individually (CHEER_CATALOG keys). A
    * mute-list, not an allow-list, so a newly added kind defaults to on. Only
    * bites when `cheers` is on — the master switch still gates the whole lot. */
   mutedCheers: string[];
   /** rows a lane shows before folding into "+N more"; 0 = no cap (show all).
    * The global default; a lens absent from laneCapByLens uses this. */
   laneCap: number;
   /** per-lens override of laneCap, keyed by the lens id (app.tsx's Lens
    * type minus 'stats', which has no lanes). An absent key means "use the
    * global laneCap" — old saved settings simply lack this field, so they
    * fall back to the object default below. */
   laneCapByLens: Record<string, number>;
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
    * Mirrors repoPrefs' hide, but people have no org baseline to fall back
    * to — hidden is the whole state. */
   hiddenPeople: string[];
   /** free-text areas you own or care about (e.g. "Growthbook", "Shopify").
    * A PR whose title, body, labels, branch, or repo partial-matches any of
    * these floats to the top of the review queue. Arbitrary strings, not a
    * known set — unlike repos/logins. */
   codeRegions: string[];
   /** when an unfinished claim of yours starts nagging you to finish or
    * release it. Claims themselves don't expire on a timer — they clear when
    * the review is submitted, released, or removed on GitHub. */
   claimWarnMins: number;
   /** open a PR in a new tab when you click its card, so the board stays put
    * behind you — this is a hub. Off opens it in the same tab. */
   openPrsNewTab: boolean;
   /** ms the cursor must rest on a hover popover (a card's state, sign-off, CI
    * or age tooltip) before it opens, so brushing the pointer across the board
    * doesn't flash panels open. 0 = open instantly; a click always bypasses it. */
   hoverDelayMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
   theme: 'system',
   density: 'comfortable',
   defaultLens: 'review',
   ageWarnDays: STARVE_DAYS,
   ageDisplay: 'opened',
   repoPrefs: {},
   draftsMode: 'mine',
   showCryo: false,
   notify: false,
   notifySound: false,
   cheers: true,
   cheerDwell: 5000,
   notifyBadge: 'count',
   mutedCheers: [],
   laneCap: 10,
   laneCapByLens: {},
   selfReview: true,
   primaryRepos: [],
   myTeam: [],
   starredPeople: [],
   hiddenPeople: [],
   codeRegions: [],
   claimWarnMins: 120,
   openPrsNewTab: true,
   hoverDelayMs: 250,
};

const store = createPersistentStore('pd2.settings', DEFAULT_SETTINGS);

// "Mute" grew up into "hide" for repos and people — hiding is what actually
// happens (cheer kinds still mute: silencing a notification is real muting).
// Old saved blobs speak the old vocabulary; translate once on load and
// persist, so everything downstream reads only 'hide'/hiddenPeople.
{
   type LegacyBlob = Omit<Settings, 'repoPrefs'> & {
      mutedPeople?: string[];
      repoPrefs: Record<string, 'hide' | 'mute' | 'show'>;
   };
   const raw = store.get() as unknown as LegacyBlob;
   const hadMutedRepos = Object.values(raw.repoPrefs).includes('mute');
   if (hadMutedRepos || raw.mutedPeople?.length) {
      const repoPrefs = Object.fromEntries(
         Object.entries(raw.repoPrefs).map(([r, p]) => [r, p === 'mute' ? 'hide' : p])
      ) as Record<string, 'hide' | 'show'>;
      const { mutedPeople, ...rest } = raw;
      store.set({
         ...rest,
         repoPrefs,
         hiddenPeople: rest.hiddenPeople.length ? rest.hiddenPeople : (mutedPeople ?? []),
      });
   }
}

/** Plain getter for non-React readers. */
export function getSettings(): Settings {
   return store.get();
}

export function setSettings(patch: Partial<Settings>) {
   store.set({ ...store.get(), ...patch });
}

/** Set or clear one repo's visibility override. null follows the org default. */
export function setRepoPref(repo: string, pref: 'hide' | 'show' | null) {
   const next = { ...store.get().repoPrefs };
   if (pref == null) delete next[repo];
   else next[repo] = pref;
   setSettings({ repoPrefs: next });
}

/** Set or clear one lens's lane-length override. null follows the global laneCap. */
export function setLaneCapForLens(lens: string, cap: number | null) {
   const next = { ...store.get().laneCapByLens };
   if (cap == null) delete next[lens];
   else next[lens] = cap;
   setSettings({ laneCapByLens: next });
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

/** Hide or unhide a person's pulls. Deduped and sorted for a stable render order. */
export function toggleHiddenPerson(login: string, on: boolean) {
   const cur = store.get().hiddenPeople;
   const next = on ? [...new Set([...cur, login])].sort() : cur.filter(l => l !== login);
   setSettings({ hiddenPeople: next });
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

/** Switch one cheer/nudge kind on or off. `on` adds it back (drops it from the
 * mute-list); off mutes it. */
export function toggleCheerKind(kind: string, on: boolean) {
   const cur = store.get().mutedCheers;
   const next = on ? cur.filter(k => k !== kind) : [...new Set([...cur, kind])];
   setSettings({ mutedCheers: next });
}

export function useSettings(): Settings {
   return store.useValue();
}

/** Non-React subscription, for the store to re-derive when a setting that
 * feeds the model (the aging threshold) changes. Returns an unsubscribe. */
export const subscribeSettings = store.subscribe;
