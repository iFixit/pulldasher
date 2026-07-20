/**
 * The one place "is this repo (or person) on my board by default" is
 * decided, shared by the filter pipeline and the filter controls so they can
 * never disagree. For repos, three parties vote in a fixed order of
 * authority — a per-user override beats the org baseline — and a session
 * reveal (scope, query, the show= set) can still override the result for
 * right now (that lives in app.tsx, not here). People have no org baseline:
 * muting is a plain two-state toggle.
 */

/** the reveal-set sentinel for Cryogenic-Storage PRs (repo names fill the rest) */
export const CRYO_KEY = 'cryo';

export type RepoState = 'shown' | 'muted' | 'org-hidden';

type RepoPrefs = Record<string, 'mute' | 'show'>;

/**
 * The durable state of a repo: your override wins, else the org baseline.
 * 'muted' = you hid it; 'org-hidden' = off by default for everyone and you
 * haven't unhidden it; 'shown' = on your board.
 */
export function repoState(
   repo: string,
   orgHidden: ReadonlySet<string>,
   prefs: RepoPrefs
): RepoState {
   const pref = prefs[repo];
   if (pref === 'mute') return 'muted';
   if (pref === 'show') return 'shown';
   return orgHidden.has(repo) ? 'org-hidden' : 'shown';
}

/** Hidden by default (muted or org-hidden) — before any session reveal. */
export function repoHidden(
   repo: string,
   orgHidden: ReadonlySet<string>,
   prefs: RepoPrefs
): boolean {
   return repoState(repo, orgHidden, prefs) !== 'shown';
}

/** GitHub Apps carry a [bot] suffix; other machine accounts are named in
 * config.json's `bots` list. Shared by the board's bot fold and anywhere
 * else a login list must leave bots out (e.g. the team picker). */
export function isBotLogin(login: string, extra: ReadonlySet<string>): boolean {
   return login.endsWith('[bot]') || extra.has(login);
}

/** A person has no org baseline the way a repo does — muting is a plain
 * two-state toggle, not a three-way state like repoState. */
export function personHidden(login: string, muted: string[]): boolean {
   return muted.includes(login);
}
