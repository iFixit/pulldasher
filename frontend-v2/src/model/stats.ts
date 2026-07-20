import type { PullData } from '../types';
import { type DerivedPull, type Status, type Weight, STATUS_ORDER, reviewWeight } from './status';

/**
 * The Stats lens's aggregation layer: pure reductions over the same open pool
 * and 14-day closed window the board already has. Everything here is a
 * snapshot of what's on the board now, not an all-time record — the server
 * only ships open pulls plus a fortnight of closed ones, so the leaderboards
 * read "who's carrying review load right now", not "career totals".
 */

export interface StatusCount {
   status: Status;
   count: number;
}

/** open pulls per status, in board order, nonzero only. */
export function statusBreakdown(pulls: DerivedPull[]): StatusCount[] {
   const by = new Map<Status, number>();
   for (const p of pulls) by.set(p.status, (by.get(p.status) ?? 0) + 1);
   return STATUS_ORDER.filter(s => by.get(s)).map(s => ({ status: s, count: by.get(s)! }));
}

export interface Leader {
   login: string;
   /** distinct PRs this person has a sign-off of this type on */
   count: number;
}

/**
 * Who has signed off the most PRs, CR or QA. Counts distinct PRs (a re-stamp
 * on the same pull is still one PR reviewed), across both active and
 * push-invalidated stamps — an invalidated CR was still a review done.
 */
export function signoffLeaders(
   pulls: DerivedPull[],
   closed: PullData[],
   type: 'CR' | 'QA'
): Leader[] {
   // login -> set of repo#number they signed
   const prs = new Map<string, Set<string>>();
   const add = (d: PullData) => {
      const sigs = type === 'CR' ? d.status.allCR : d.status.allQA;
      for (const s of sigs) {
         const login = s.data.user.login;
         const key = `${d.repo}#${d.number}`;
         if (!prs.has(login)) prs.set(login, new Set());
         prs.get(login)!.add(key);
      }
   };
   for (const p of pulls) add(p.data);
   for (const d of closed) add(d);
   return [...prs.entries()]
      .map(([login, set]) => ({ login, count: set.size }))
      .sort((a, b) => b.count - a.count || a.login.localeCompare(b.login));
}

export interface Starved {
   login: string;
   /** their open PRs still short of full CR */
   count: number;
   /** summed open-days across those PRs (the waiting they're carrying) */
   totalDays: number;
   /** the single longest-waiting one */
   worstDays: number;
}

/**
 * Whose authored PRs are waiting longest for CR. A pull counts while it's
 * CR-incomplete (needs_cr or needs_recr); the author is ranked by the total
 * open-days their unreviewed PRs have piled up, with the worst single wait
 * alongside so one ancient PR and ten fresh ones read differently.
 */
export function crStarvation(pulls: DerivedPull[]): Starved[] {
   const by = new Map<string, { count: number; totalDays: number; worstDays: number }>();
   for (const p of pulls) {
      if (!['needs_cr', 'needs_recr'].includes(p.status)) continue;
      const login = p.data.user.login;
      const cur = by.get(login) ?? { count: 0, totalDays: 0, worstDays: 0 };
      cur.count += 1;
      cur.totalDays += p.ageDays;
      cur.worstDays = Math.max(cur.worstDays, p.ageDays);
      by.set(login, cur);
   }
   return [...by.entries()]
      .map(([login, v]) => ({ login, ...v }))
      .sort((a, b) => b.totalDays - a.totalDays || b.worstDays - a.worstDays);
}

export interface MergeBucket {
   weight: Weight;
   count: number;
   avgHours: number;
   medianHours: number;
}

export interface MergeBySize {
   /** one entry per weight class, in XS→XL order (count 0 kept, for scale) */
   buckets: MergeBucket[];
   /** merged pulls that had usable size + time data (what fed the buckets) */
   sampled: number;
   /** merged pulls seen in the window (some may lack size, hence be dropped) */
   merged: number;
}

const WEIGHTS: Weight[] = ['XS', 'S', 'M', 'L', 'XL'];

/**
 * How long a merge takes by diff size, over the closed window. Merge time is
 * merged_at − created_at; a pull only counts if it merged, carries a size
 * (additions/deletions on the wire), and has a sane positive duration. Both
 * mean and median, because a couple of week-old outliers skew the mean and
 * the median is the honest "typical".
 */
export function mergeTimeBySize(closed: PullData[]): MergeBySize {
   const hours = new Map<Weight, number[]>(WEIGHTS.map(w => [w, []]));
   let sampled = 0;
   let merged = 0;
   for (const d of closed) {
      if (!d.merged_at) continue;
      merged += 1;
      const sizeKnown = d.additions != null || d.deletions != null;
      if (!sizeKnown) continue;
      const h = (Date.parse(d.merged_at) - Date.parse(d.created_at)) / 3_600_000;
      if (!(h > 0)) continue;
      hours.get(reviewWeight(d))!.push(h);
      sampled += 1;
   }
   const buckets = WEIGHTS.map(weight => {
      const xs = hours.get(weight)!;
      return {
         weight,
         count: xs.length,
         avgHours: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0,
         medianHours: median(xs),
      };
   });
   return { buckets, sampled, merged };
}

function median(xs: number[]): number {
   if (!xs.length) return 0;
   const s = [...xs].sort((a, b) => a - b);
   const mid = Math.floor(s.length / 2);
   return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const DAY_MS = 86_400_000;
function startOfDay(t: number): number {
   return new Date(t).setHours(0, 0, 0, 0);
}

export interface DayCount {
   /** local-midnight epoch ms identifying the day */
   day: number;
   count: number;
}

function dayBuckets(days: number, now: number): DayCount[] {
   const start = startOfDay(now) - (days - 1) * DAY_MS;
   return Array.from({ length: days }, (_, i) => ({ day: start + i * DAY_MS, count: 0 }));
}
function bump(buckets: DayCount[], t: number) {
   // round, not floor: a DST shift makes a local day 23 or 25 hours long
   const i = Math.round((startOfDay(t) - buckets[0].day) / DAY_MS);
   if (i >= 0 && i < buckets.length) buckets[i].count += 1;
}

/** merges per local day over the trailing window, oldest first, empty days kept. */
export function mergedPerDay(closed: PullData[], days: number, now: number): DayCount[] {
   const buckets = dayBuckets(days, now);
   for (const d of closed) {
      if (!d.merged_at) continue;
      bump(buckets, Date.parse(d.merged_at));
   }
   return buckets;
}

/**
 * CR+QA stamps landed per local day — the board's review pulse. Counts every
 * signature (a re-stamp is new review work), across open pulls and the closed
 * window, so a day reads "how much reviewing happened", not "how much survived".
 */
export function stampsPerDay(
   pulls: DerivedPull[],
   closed: PullData[],
   days: number,
   now: number
): DayCount[] {
   const buckets = dayBuckets(days, now);
   const add = (d: PullData) => {
      for (const s of [...d.status.allCR, ...d.status.allQA]) {
         const t = Date.parse(String(s.data.created_at));
         if (Number.isFinite(t)) bump(buckets, t);
      }
   };
   for (const p of pulls) add(p.data);
   for (const d of closed) add(d);
   return buckets;
}

export interface LabeledCount {
   label: string;
   count: number;
}

/** open pulls by how long they've been open, youngest bucket first. */
export function ageMix(pulls: DerivedPull[]): LabeledCount[] {
   const buckets = [
      { label: 'today', count: 0, max: 0 },
      { label: '1–2d', count: 0, max: 2 },
      { label: '3–6d', count: 0, max: 6 },
      { label: '7–13d', count: 0, max: 13 },
      { label: '14d+', count: 0, max: Infinity },
   ];
   for (const p of pulls) buckets.find(b => p.ageDays <= b.max)!.count += 1;
   return buckets.map(({ label, count }) => ({ label, count }));
}

export interface EffortMix {
   /** exactly 5 entries, XS→XL order, zero counts kept for scale */
   buckets: { weight: Weight; count: number }[];
   /** how many open pulls carry no wire size (their weight is a guess) */
   estimated: number;
}

/** the open board's review effort, by weight class. */
export function effortMix(pulls: DerivedPull[]): EffortMix {
   const by = new Map<Weight, number>(WEIGHTS.map(w => [w, 0]));
   let estimated = 0;
   for (const p of pulls) {
      by.set(p.weight, by.get(p.weight)! + 1);
      if (!p.sizeKnown) estimated += 1;
   }
   return { buckets: WEIGHTS.map(weight => ({ weight, count: by.get(weight)! })), estimated };
}

export interface ReviewDebt {
   /** CR stamps still needed across CR-incomplete pulls */
   crSlots: number;
   /** QA stamps still needed across pulls at the QA gate */
   qaSlots: number;
   /** stamps a push invalidated that haven't been refreshed (re-CR + re-QA) */
   restamps: number;
   /** needs-QA pulls nobody has claimed or owes a re-QA on */
   unclaimedQa: number;
}

/**
 * What the board is owed, in stamps: the reviewer-hours of standing debt. The
 * restamp count is the cheapest debt to clear — the reviewer already knows
 * the code.
 */
export function reviewDebt(pulls: DerivedPull[]): ReviewDebt {
   const debt = { crSlots: 0, qaSlots: 0, restamps: 0, unclaimedQa: 0 };
   for (const p of pulls) {
      if (['needs_cr', 'needs_recr'].includes(p.status))
         debt.crSlots += Math.max(p.data.status.cr_req - p.crHave, 0);
      if (p.status === 'needs_qa') {
         debt.qaSlots += Math.max(p.data.status.qa_req - p.qaHave, 0);
         if (!p.qaingLogin && !p.reqaBy.length) debt.unclaimedQa += 1;
      }
      debt.restamps += p.recrBy.length + p.reqaBy.length;
   }
   return debt;
}

export interface Latency {
   medianHours: number;
   avgHours: number;
   /** merged pulls that had a first CR stamp with a usable timestamp */
   sampled: number;
}

/**
 * How long a merged PR waited for its FIRST CR — the responsiveness number,
 * distinct from time-to-merge (which includes the author's own iteration).
 */
export function firstCrLatency(closed: PullData[]): Latency {
   const hours: number[] = [];
   for (const d of closed) {
      if (!d.merged_at || !d.status.allCR.length) continue;
      const first = Math.min(
         ...d.status.allCR.map(s => Date.parse(String(s.data.created_at)) || Infinity)
      );
      const h = (first - Date.parse(d.created_at)) / 3_600_000;
      if (Number.isFinite(h) && h > 0) hours.push(h);
   }
   return {
      medianHours: median(hours),
      avgHours: hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : 0,
      sampled: hours.length,
   };
}

export interface Reciprocity {
   login: string;
   /** distinct PRs this person stamped (CR or QA) for someone else */
   given: number;
   /** stamps others put on this person's authored PRs */
   received: number;
}

/**
 * Review give-and-take per person: what you stamped for others against what
 * others stamped for you. A board where the same few people are all "given"
 * and everyone else is all "received" has a review economy problem.
 */
export function reciprocity(pulls: DerivedPull[], closed: PullData[]): Reciprocity[] {
   const given = new Map<string, Set<string>>();
   const received = new Map<string, number>();
   const add = (d: PullData) => {
      const key = `${d.repo}#${d.number}`;
      for (const s of [...d.status.allCR, ...d.status.allQA]) {
         const login = s.data.user.login;
         if (login === d.user.login) continue; // self-stamps aren't review economy
         if (!given.has(login)) given.set(login, new Set());
         given.get(login)!.add(key);
         received.set(d.user.login, (received.get(d.user.login) ?? 0) + 1);
      }
   };
   for (const p of pulls) add(p.data);
   for (const d of closed) add(d);
   const logins = new Set([...given.keys(), ...received.keys()]);
   return [...logins]
      .map(login => ({
         login,
         given: given.get(login)?.size ?? 0,
         received: received.get(login) ?? 0,
      }))
      .sort(
         (a, b) => b.given - a.given || b.received - a.received || a.login.localeCompare(b.login)
      );
}

export interface AuthorLoad {
   login: string;
   count: number;
   /** how many of those still need CR (the reviewer-facing share) */
   awaitingCr: number;
   oldestDays: number;
}

/** who has the most open PRs on the board (work-in-progress load). */
export function authorLoad(pulls: DerivedPull[]): AuthorLoad[] {
   const by = new Map<string, { count: number; awaitingCr: number; oldestDays: number }>();
   for (const p of pulls) {
      const cur = by.get(p.data.user.login) ?? { count: 0, awaitingCr: 0, oldestDays: 0 };
      cur.count += 1;
      if (['needs_cr', 'needs_recr'].includes(p.status)) cur.awaitingCr += 1;
      cur.oldestDays = Math.max(cur.oldestDays, p.ageDays);
      by.set(p.data.user.login, cur);
   }
   return [...by.entries()]
      .map(([login, v]) => ({ login, ...v }))
      .sort(
         (a, b) =>
            b.count - a.count || b.oldestDays - a.oldestDays || a.login.localeCompare(b.login)
      );
}

export interface RepoLoad {
   repo: string;
   count: number;
   /** how many of those still need CR (the reviewer-facing share) */
   awaitingCr: number;
   oldestDays: number;
}

/** where the open PRs live, and how much of each repo's pile is review work. */
export function repoBreakdown(pulls: DerivedPull[]): RepoLoad[] {
   const by = new Map<string, { count: number; awaitingCr: number; oldestDays: number }>();
   for (const p of pulls) {
      const cur = by.get(p.data.repo) ?? { count: 0, awaitingCr: 0, oldestDays: 0 };
      cur.count += 1;
      if (['needs_cr', 'needs_recr'].includes(p.status)) cur.awaitingCr += 1;
      cur.oldestDays = Math.max(cur.oldestDays, p.ageDays);
      by.set(p.data.repo, cur);
   }
   return [...by.entries()]
      .map(([repo, v]) => ({ repo, ...v }))
      .sort((a, b) => b.count - a.count || a.repo.localeCompare(b.repo));
}

export interface Friction {
   conflicts: number;
   deployBlocked: number;
   devBlocked: number;
   ciRed: number;
   drafts: number;
   stacked: number;
   external: number;
}

/** everything currently stuck on something other than review attention. */
export function friction(pulls: DerivedPull[]): Friction {
   const f = {
      conflicts: 0,
      deployBlocked: 0,
      devBlocked: 0,
      ciRed: 0,
      drafts: 0,
      stacked: 0,
      external: 0,
   };
   for (const p of pulls) {
      if (p.conflict) f.conflicts += 1;
      if (p.deployBlockedBy.length) f.deployBlocked += 1;
      if (p.devBlockedBy.length || p.status === 'dev_block') f.devBlocked += 1;
      if (p.status === 'ci_red') f.ciRed += 1;
      if (p.status === 'draft') f.drafts += 1;
      if (p.dependent) f.stacked += 1;
      if (p.externalBlock) f.external += 1;
   }
   return f;
}

/** "3h" / "1.4d" / "12d" — durations for the merge-time bars. */
export function humanHours(h: number): string {
   if (h < 1) return `${Math.round(h * 60)}m`;
   if (h < 24) return `${h < 10 ? h.toFixed(1) : Math.round(h)}h`;
   const d = h / 24;
   return `${d < 10 ? d.toFixed(1) : Math.round(d)}d`;
}
