import type { DerivedPull } from '../../../shared/model/status';
import { isBotLogin } from '../../../shared/model/visibility';
import type { PullData } from '../../../shared/types';
import { rowWord } from './actions';

/** Over the finish line's limit with more than this many open PRs of your own. */
export const FINISH_MAX_OPEN = 7;
/** ...or when any of your open PRs is older than this many days. */
export const FINISH_MAX_DAYS = 14;

/** localStorage key holding the FinishRecord of the last time it popped up. */
export const FINISH_LINE_KEY = 'pd2.finishLine';
/** After it pops up, it stays away at least this long. */
export const FINISH_COOLDOWN_MS = 4 * 60 * 60 * 1000;

/** What it showed you last time, so it only comes back when that got worse. */
export interface FinishRecord {
   /** ms when it showed */
   at: number;
   /** how many counted open PRs you had then */
   count: number;
   /** repo#number of each PR past the age limit then */
   over: string[];
}

/** The fields the rule reads off a derived pull. */
export interface FinishPull {
   data: Pick<PullData, 'repo' | 'number' | 'title' | 'draft' | 'state' | 'user'>;
   ageDays: number;
   /** who holds a deploy block on it; a held PR is done, so it doesn't count */
   deployBlockedBy: string[];
   status: DerivedPull['status'];
   /** parked (Cryogenic Storage): kept open on purpose, never "ready" */
   cryo: boolean;
}

/** Can merge now, the quickest way to the finish line. A parked PR can be
 * signed off and green, but My work files it under waiting, so this does too. */
export const isFinishReady = (p: FinishPull) => p.status === 'ready' && !p.cryo;

export interface FinishLineCase<P extends FinishPull> {
   /** the PRs that put you there, oldest first */
   pulls: P[];
   /** how many of `pulls` can merge now */
   ready: number;
   /** how many open PRs counted */
   count: number;
   /** repo#number of each counted PR past the age limit */
   over: string[];
   /** how many PRs you still have to merge or close to finish: enough to
    * get under the count limit, and every one past the age limit (closing an
    * old one counts toward both) */
   toGo: number;
}

const idOf = (p: FinishPull) => `${p.data.repo}#${p.data.number}`;

const oldestFirst = <P extends FinishPull>(a: P, b: P) => b.ageDays - a.ageDays;

/**
 * Your own open, human PRs that aren't held for a deploy, checked against the
 * two limits; drafts count only when `countDrafts` is on. Null when you're
 * under both.
 */
export function finishLineCase<P extends FinishPull>(
   pulls: P[],
   me: string,
   extraBots: ReadonlySet<string>,
   limits: { maxOpen: number; maxDays: number; countDrafts?: boolean }
): FinishLineCase<P> | null {
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
   const counts = {
      count: mine.length,
      over: old.map(idOf),
      toGo: Math.max(mine.length - limits.maxOpen, old.length),
   };
   if (mine.length <= limits.maxOpen && !old.length) return null;
   const listed = mine.length > limits.maxOpen ? mine : old;
   const ready = listed.filter(isFinishReady).length;
   return {
      pulls: listed,
      ready,
      ...counts,
   };
}

/**
 * The listed PRs split the way My work splits them, by the same rowWord, with
 * the ready ones lifted out on top: ready to merge, your move, then waiting
 * on others. Each group runs oldest first; the row's word says the rest.
 */
export function finishGroups(pulls: DerivedPull[], me: string) {
   const worded = pulls
      .map(pull => ({ pull, word: rowWord(pull, me) }))
      .sort((a, b) => b.pull.ageDays - a.pull.ageDays);
   const rest = worded.filter(w => !isFinishReady(w.pull));
   return {
      ready: worded.filter(w => isFinishReady(w.pull)),
      move: rest.filter(w => w.word.kind === 'do'),
      waiting: rest.filter(w => w.word.kind === 'wait'),
   };
}

/** The record to store when `found` shows at `now`. */
export const finishRecord = (found: FinishLineCase<FinishPull>, now: number): FinishRecord => ({
   at: now,
   count: found.count,
   over: found.over,
});

/** A stored record, or null when it's missing or unreadable. */
export function parseFinishRecord(raw: string | null): FinishRecord | null {
   try {
      const r = JSON.parse(raw ?? 'null') as Partial<FinishRecord> | null;
      if (typeof r?.at !== 'number' || typeof r.count !== 'number' || !Array.isArray(r.over)) {
         return null;
      }
      return { at: r.at, count: r.count, over: r.over };
   } catch {
      return null;
   }
}

/**
 * Whether it should pop up now: you're over a limit, and either it never
 * showed, or it's been at least FINISH_COOLDOWN_MS and things got worse since
 * (more open PRs, net, or a PR newly past the age limit).
 */
export function finishDue(
   found: FinishLineCase<FinishPull> | null,
   last: FinishRecord | null,
   now: number
): boolean {
   if (!found) return false;
   if (!last) return true;
   if (now - last.at < FINISH_COOLDOWN_MS) return false;
   return found.count > last.count || found.over.some(id => !last.over.includes(id));
}

/** One number at the top of the list you can act on, and which PRs it
 * points at, so clicking it can open their group. */
export interface FinishStat {
   key: 'open' | 'old' | 'ready';
   text: string;
   /** the PRs this number counts */
   counts: (p: FinishPull) => boolean;
}

/** "1 PR", "2 PRs" */
export const prCount = (n: number) => (n === 1 ? '1 PR' : `${n} PRs`);

/**
 * The numbers you can act on, each only when above zero: how many open
 * against the aim, how many past the age limit, how many can merge now.
 * Waiting on others is left out: there's nothing to do about it here.
 */
export function finishStats(
   found: Pick<FinishLineCase<FinishPull>, 'count' | 'over' | 'ready'>,
   limits: { maxOpen: number; maxDays: number }
): FinishStat[] {
   const stats: FinishStat[] = [];
   if (found.count > limits.maxOpen)
      stats.push({
         key: 'open',
         text: `${found.count} open PRs · aim for ${limits.maxOpen}`,
         counts: () => true,
      });
   if (found.over.length)
      stats.push({
         key: 'old',
         text: `${prCount(found.over.length)} older than ${limits.maxDays} days`,
         counts: p => p.ageDays > limits.maxDays,
      });
   if (found.ready)
      stats.push({
         key: 'ready',
         text: `${prCount(found.ready)} ready to merge`,
         counts: isFinishReady,
      });
   return stats;
}
