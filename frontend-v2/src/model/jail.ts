import { isBotLogin } from '../../../shared/model/visibility';
import type { PullData } from '../../../shared/types';

/** Jail when you have more than this many open PRs of your own. */
export const JAIL_MAX_OPEN = 7;
/** Jail when any of your open PRs is older than this many days. */
export const JAIL_MAX_DAYS = 14;

/** localStorage key holding the JailRecord of the last time jail showed. */
export const JAIL_KEY = 'pd2.jail';
/** After jail shows, it stays away at least this long. */
export const JAIL_COOLDOWN_MS = 4 * 60 * 60 * 1000;

/** What jail showed you last time, so it only comes back when that got worse. */
export interface JailRecord {
   /** ms when it showed */
   at: number;
   /** how many counted open PRs you had then */
   count: number;
   /** repo#number of each PR past the age limit then */
   over: string[];
}

/** The fields the rule reads off a derived pull. */
export interface JailPull {
   data: Pick<PullData, 'repo' | 'number' | 'title' | 'draft' | 'state' | 'user'>;
   ageDays: number;
   /** who holds a deploy block on it; a held PR is done, so it doesn't count */
   deployBlockedBy: string[];
}

export interface JailCase<P extends JailPull> {
   /** the PRs that put you there, oldest first */
   pulls: P[];
   /** one line saying why, and how to get out */
   why: string;
   /** how many open PRs counted */
   count: number;
   /** repo#number of each counted PR past the age limit */
   over: string[];
}

const idOf = (p: JailPull) => `${p.data.repo}#${p.data.number}`;

const oldestFirst = <P extends JailPull>(a: P, b: P) => b.ageDays - a.ageDays;

/**
 * Your own open, human PRs that aren't held for a deploy, checked against the
 * two limits; drafts count only when `countDrafts` is on. Null when you're
 * under both.
 */
export function jailCase<P extends JailPull>(
   pulls: P[],
   me: string,
   extraBots: ReadonlySet<string>,
   limits: { maxOpen: number; maxDays: number; countDrafts?: boolean }
): JailCase<P> | null {
   const mine = pulls
      .filter(
         p =>
            p.data.user.login === me &&
            p.data.state === 'open' &&
            (limits.countDrafts || !p.data.draft) &&
            !p.deployBlockedBy.length &&
            !isBotLogin(p.data.user.login, extraBots)
      )
      .sort(oldestFirst);
   const old = mine.filter(p => p.ageDays > limits.maxDays);
   const counts = { count: mine.length, over: old.map(idOf) };
   if (mine.length > limits.maxOpen) {
      const n = mine.length;
      return {
         pulls: mine,
         why: `${n} open PRs. Parole at ${limits.maxOpen}. Close ${n - limits.maxOpen} to get out.`,
         ...counts,
      };
   }
   if (old.length) {
      return {
         pulls: old,
         why: `#${old[0].data.number} has been open ${old[0].ageDays} days. Parole at ${limits.maxDays} days.`,
         ...counts,
      };
   }
   return null;
}

/** The record to store when `jail` shows at `now`. */
export const jailRecord = (jail: JailCase<JailPull>, now: number): JailRecord => ({
   at: now,
   count: jail.count,
   over: jail.over,
});

/** A stored record, or null when it's missing or unreadable. */
export function parseJailRecord(raw: string | null): JailRecord | null {
   try {
      const r = JSON.parse(raw ?? 'null') as Partial<JailRecord> | null;
      if (typeof r?.at !== 'number' || typeof r.count !== 'number' || !Array.isArray(r.over)) {
         return null;
      }
      return { at: r.at, count: r.count, over: r.over };
   } catch {
      return null;
   }
}

/**
 * Whether jail should drop now: you're over a limit, and either it never
 * showed, or it's been at least JAIL_COOLDOWN_MS and things got worse since
 * (more open PRs, net, or a PR newly past the age limit).
 */
export function jailDue(
   jail: JailCase<JailPull> | null,
   last: JailRecord | null,
   now: number
): boolean {
   if (!jail) return false;
   if (!last) return true;
   if (now - last.at < JAIL_COOLDOWN_MS) return false;
   return jail.count > last.count || jail.over.some(id => !last.over.includes(id));
}
