import type { DerivedPull } from '../../../shared/model/status';
import { isBotLogin } from '../../../shared/model/visibility';
import type { PullData } from '../../../shared/types';
import { rowWord } from './actions';

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
   status: DerivedPull['status'];
   /** parked (Cryogenic Storage): kept open on purpose, never "ready" */
   cryo: boolean;
}

/** Can merge now, the quickest way out. A parked PR can be signed off and
 * green, but My work files it under waiting, so jail does too. */
export const isJailReady = (p: JailPull) => p.status === 'ready' && !p.cryo;

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
      const why = countWhy(
         mine.length,
         limits.maxOpen,
         mine.filter(isJailReady).length,
         old.filter(p => !isJailReady(p)),
         limits.maxDays
      );
      return { pulls: mine, why, ...counts };
   }
   if (old.length) {
      return { pulls: old, why: ageWhy(old, limits.maxDays), ...counts };
   }
   return null;
}

/** The count line, pointing at the ready PRs first since merging one is
 * the quickest way to lower the count. `stillOld` are the PRs past the age
 * limit that merging the ready ones won't clear, so it never promises
 * "you're out" while one is left. */
// ponytail: when more are ready than needed, an old ready PR left unmerged
// still holds you; the line doesn't say which ready ones to pick
function countWhy(
   n: number,
   max: number,
   ready: number,
   stillOld: JailPull[],
   maxDays: number
): string {
   const need = n - max;
   const head = `${n} open PRs. Parole at ${max}.`;
   const yours = ready === 1 ? 'your ready one' : `your ${ready} ready ones`;
   const out = stillOld.length ? `to get under ${max}` : 'and you’re out';
   const tail = !stillOld.length
      ? ''
      : stillOld.length === 1
      ? ` #${stillOld[0].data.number} is still past ${maxDays} days.`
      : ` ${stillOld.length} PRs are still past ${maxDays} days.`;
   if (!ready)
      return `${head} Close ${need} to get ${stillOld.length ? `under ${max}` : 'out'}.${tail}`;
   if (ready < need) return `${head} Merge ${yours} and close ${need - ready} more.${tail}`;
   if (ready === need) return `${head} Merge ${yours} ${out}.${tail}`;
   return `${head} Merge ${need} of ${yours} ${out}.${tail}`;
}

function ageWhy(old: JailPull[], maxDays: number): string {
   if (old.length > 1) {
      return `${old.length} PRs open past ${maxDays} days. Merge or close them to get out.`;
   }
   const [p] = old;
   const head = `#${p.data.number} has been open ${p.ageDays} days`;
   return isJailReady(p)
      ? `${head} and it’s ready. Merge it to get out.`
      : `${head}. Parole at ${maxDays} days. Merge or close it to get out.`;
}

/**
 * A jail's PRs split the way My work splits them, by the same rowWord, with
 * the ready ones lifted out on top: ready to merge, your move, then waiting
 * on others. Each group runs oldest first; the row's word says the rest.
 */
export function jailGroups(pulls: DerivedPull[], me: string) {
   const worded = pulls
      .map(pull => ({ pull, word: rowWord(pull, me) }))
      .sort((a, b) => b.pull.ageDays - a.pull.ageDays);
   const rest = worded.filter(w => !isJailReady(w.pull));
   return {
      ready: worded.filter(w => isJailReady(w.pull)),
      move: rest.filter(w => w.word.kind === 'do'),
      waiting: rest.filter(w => w.word.kind === 'wait'),
   };
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
