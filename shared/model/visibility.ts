/**
 * The one place "is this repo (or person) on my board by default" is
 * decided, shared by the filter pipeline and the filter controls so they can
 * never disagree. Hiding is per-user and two-state for repos and people
 * alike: the server config's v1-era `hideByDefault` flag is deliberately
 * ignored (org-level muting was retired — each user hides a repo once,
 * their call). A session reveal (scope, query, the show= set) can still
 * override the result for right now; that lives in app.tsx, not here.
 */

/** the reveal-set sentinel for Cryogenic-Storage PRs (repo names fill the rest) */
export const CRYO_KEY = 'cryo';

type RepoPrefs = Record<string, 'hide' | 'show'>;

/** You hid it — before any session reveal. Values other than 'hide'
 * (including the org-era 'show' still parked in old stored prefs) mean
 * shown. */
export function repoHidden(repo: string, prefs: RepoPrefs): boolean {
   return prefs[repo] === 'hide';
}

/** GitHub Apps carry a [bot] suffix; other machine accounts are named in
 * config.json's `bots` list. Shared by the board's bot fold and anywhere
 * else a login list must leave bots out (e.g. the team picker). */
export function isBotLogin(login: string, extra: ReadonlySet<string>): boolean {
   return login.endsWith('[bot]') || extra.has(login);
}

/** The suffix-only half of isBotLogin, for the model-layer call sites that
 * have no reason to depend on config.json's `bots` list (they'd otherwise
 * call isBotLogin with an empty extra set every time). Equivalent to
 * `isBotLogin(login, new Set())`. */
export function isSuffixBot(login: string): boolean {
   return login.endsWith('[bot]');
}

/** A person has no org baseline the way a repo does — hiding is a plain
 * two-state toggle. */
export function personHidden(login: string, hidden: string[]): boolean {
   return hidden.includes(login);
}
