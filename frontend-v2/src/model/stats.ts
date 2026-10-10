import { DAY_MS, startOfDay } from '../../../shared/format';
import type { PullData } from '../../../shared/types';
import {
   CR_INCOMPLETE,
   type DerivedPull,
   type Status,
   type Weight,
   STATUS_ORDER,
   WEIGHT_ORDER,
   reviewWeight,
} from '../../../shared/model/status';
import { isBotLogin } from '../../../shared/model/visibility';

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
         if (login === d.user.login) continue; // self-stamps aren't review economy
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

/**
 * How long a merge takes by diff size, over the closed window. Merge time is
 * merged_at − created_at; a pull only counts if it merged, carries a size
 * (additions/deletions on the wire), and has a sane positive duration. Both
 * mean and median, because a couple of week-old outliers skew the mean and
 * the median is the honest "typical".
 */
export function mergeTimeBySize(closed: PullData[]): MergeBySize {
   const hours = new Map<Weight, number[]>(WEIGHT_ORDER.map(w => [w, []]));
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
   const buckets = WEIGHT_ORDER.map(weight => {
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
 * signature (a re-stamp is new review work) on someone else's pull, across open
 * pulls and the closed window; an author's own stamp is normal under
 * self-review and says nothing about reviewing.
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
         if (s.data.user.login === d.user.login) continue;
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
   const by = new Map<Weight, number>(WEIGHT_ORDER.map(w => [w, 0]));
   let estimated = 0;
   for (const p of pulls) {
      by.set(p.weight, by.get(p.weight)! + 1);
      if (p.data.additions == null && p.data.deletions == null) estimated += 1;
   }
   return { buckets: WEIGHT_ORDER.map(weight => ({ weight, count: by.get(weight)! })), estimated };
}

const sec = (iso: unknown) => Date.parse(String(iso)) / 1000;

/** epoch secs of every stamp or GitHub review by `login` on this pull */
function answersBy(d: PullData, login: string): number[] {
   const stamps = [...d.status.allCR, ...d.status.allQA]
      .filter(s => s.data.user.login === login)
      .map(s => sec(s.data.created_at));
   const reviews = (d.status.unstamped_reviewers ?? [])
      .filter(r => r.login === login)
      .map(r => r.date);
   return [...stamps, ...reviews].filter(Number.isFinite);
}

/** requests someone else made of a person, with a known time */
function openedRequests(d: PullData) {
   return (d.review_requests ?? []).filter(
      r => !r.self && r.at != null && r.login !== d.user.login
   ) as { login: string; at: number }[];
}

export interface AnswerTime {
   medianHours: number;
   p90Hours: number;
   /** requests with a known time that the asked person answered */
   sampled: number;
}

/**
 * How long a review request takes to get answered: from the request to that
 * person's first stamp or GitHub review after it. The policy says hours.
 * GitHub drops a request once the person reviews, so closed pulls rarely keep
 * their requests; what's measured is every request still on the wire, open
 * pulls and the closed window alike. A person's comment that isn't a stamp
 * or a review isn't on the board, so it doesn't count as an answer.
 */
export function requestAnswerTimes(pulls: DerivedPull[], closed: PullData[]): AnswerTime {
   const hours: number[] = [];
   for (const d of [...pulls.map(p => p.data), ...closed]) {
      for (const r of openedRequests(d)) {
         const first = Math.min(...answersBy(d, r.login).filter(t => t >= r.at));
         if (Number.isFinite(first)) hours.push((first - r.at) / 3600);
      }
   }
   return { medianHours: median(hours), p90Hours: percentile(hours, 0.9), sampled: hours.length };
}

function percentile(xs: number[], q: number): number {
   if (!xs.length) return 0;
   const s = [...xs].sort((a, b) => a - b);
   return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
}

export interface PullRef {
   repo: string;
   number: number;
   title: string;
}

export interface OpenRequest extends PullRef {
   /** who was asked */
   login: string;
   hours: number;
}

export interface OutsideWait extends PullRef {
   author: string;
   days: number;
}

export interface WaitingOnSomeone {
   /** open requests nobody has answered yet, longest first */
   requests: OpenRequest[];
   /** pulls from outside the dev team waiting on a first review, oldest first */
   outside: OutsideWait[];
}

/**
 * What's waiting on a person who isn't the author: review requests with no
 * answer yet (hours since the request) and pulls from outside the dev team
 * that nobody was asked to review (days open). An author's own review of their
 * own pull is not waiting on anyone, so it never shows here.
 */
export function waitingOnSomeone(pulls: DerivedPull[], now: number): WaitingOnSomeone {
   const requests: OpenRequest[] = [];
   const outside: OutsideWait[] = [];
   for (const p of pulls) {
      const d = p.data;
      const ref = { repo: d.repo, number: d.number, title: d.title };
      // askedOf is who is still being waited on (claims, the author and people
      // who already stamped left out); a draft or a pull whose CR is met has
      // nobody left to wait for
      const open = !d.draft && CR_INCOMPLETE.includes(p.status);
      for (const login of open ? p.askedOf ?? [] : []) {
         const at =
            (d.review_requests ?? []).find(r => !r.self && r.login === login)?.at ?? p.askedAt;
         if (at == null || answersBy(d, login).some(t => t >= at)) continue;
         requests.push({ ...ref, login, hours: Math.max(0, (now - at) / 3600) });
      }
      const asked = (d.requested_reviewers ?? []).length || (d.requested_teams ?? []).length;
      if (!p.ownReview && !asked && CR_INCOMPLETE.includes(p.status))
         outside.push({ ...ref, author: d.user.login, days: p.ageDays });
   }
   return {
      requests: requests.sort((a, b) => b.hours - a.hours),
      outside: outside.sort((a, b) => b.days - a.days),
   };
}

export interface SelfReviewMix {
   /** merged in the window */
   merged: number;
   /** a request was on record (person or team) */
   asked: number;
   /** no request on record, but someone other than the author stamped or reviewed */
   byOthers: number;
   /** only the author's own stamp */
   self: number;
   /** merged with no stamp or review at all */
   unstamped: number;
   /** rough risk signal over the self-reviewed merges */
   risk: { reverts: number; afterSelfReview: number };
}

const REF = /\b(?:fix(?:e[sd])?|revert(?:s|ed)?)\s+(?:[\w.-]+\/[\w.-]+)?#(\d+)/gi;
const WEEK_SECS = 7 * 86400;

/**
 * Of the pulls merged in the window, who reviewed them: asked for a review,
 * someone else stamped it unasked, or the author alone. GitHub clears a
 * request once it's answered, so "asked" undercounts: an answered request
 * lands in "reviewed by someone else". The risk signal is rough on purpose:
 * titles that start with "Revert", and any merge that says "Fixes #n" or
 * "Reverts #n" of a self-reviewed pull in the same repo merged up to a week
 * before it. It sees only what the title and description say.
 */
export function selfReviewMix(
   closed: PullData[],
   bots: ReadonlySet<string> = new Set()
): SelfReviewMix {
   const mergedAt = (d: PullData) => sec(d.merged_at);
   const mix = { merged: 0, asked: 0, byOthers: 0, self: 0, unstamped: 0 };
   const selfMerged = new Map<string, number>();
   const mergedPulls = closed.filter(d => d.merged_at);
   for (const d of mergedPulls) {
      mix.merged += 1;
      const author = d.user.login;
      // a claim is a reviewer volunteering, not the author asking
      const claims = new Set((d.review_requests ?? []).filter(r => r.self).map(r => r.login));
      const asked =
         (d.requested_teams ?? []).length ||
         (d.requested_reviewers ?? []).some(l => !claims.has(l)) ||
         (d.review_requests ?? []).some(r => !r.self);
      // a bot's comment (the CI review bot is on most pulls) isn't a person's review
      const human = (l: string) => !isBotLogin(l, bots);
      const stampers = [...d.status.allCR, ...d.status.allQA]
         .map(s => s.data.user.login)
         .filter(human);
      const reviewers = (d.status.unstamped_reviewers ?? []).map(r => r.login).filter(human);
      const others = [...stampers, ...reviewers].some(l => l !== author);
      if (asked) mix.asked += 1;
      else if (others) mix.byOthers += 1;
      else if (stampers.includes(author)) {
         mix.self += 1;
         selfMerged.set(`${d.repo}#${d.number}`, mergedAt(d));
      } else mix.unstamped += 1;
   }
   let reverts = 0;
   let afterSelfReview = 0;
   for (const d of mergedPulls) {
      const isRevert = /^revert\b/i.test(d.title);
      if (isRevert) reverts += 1;
      const text = `${d.title}\n${d.body ?? ''}`;
      const hitsSelf = [...text.matchAll(REF)].some(m => {
         const at = selfMerged.get(`${d.repo}#${m[1]}`);
         return at != null && mergedAt(d) >= at && mergedAt(d) - at <= WEEK_SECS;
      });
      if (hitsSelf) afterSelfReview += 1;
   }
   return { ...mix, risk: { reverts, afterSelfReview } };
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

interface Load {
   count: number;
   inSelfReview: number;
   waitingOnOthers: number;
   oldestDays: number;
}
const emptyLoad = (): Load => ({ count: 0, inSelfReview: 0, waitingOnOthers: 0, oldestDays: 0 });
/** a pull short of CR is the author's own to review, or waits on someone else */
function countReview(load: Load, p: DerivedPull) {
   if (!CR_INCOMPLETE.includes(p.status)) return;
   if (p.ownReview) load.inSelfReview += 1;
   else load.waitingOnOthers += 1;
}

export interface AuthorLoad {
   login: string;
   count: number;
   /** needing review, and the author's own to do under self-review */
   inSelfReview: number;
   /** needing review from someone who was asked, or from outside the dev team */
   waitingOnOthers: number;
   oldestDays: number;
}

/** who has the most open PRs on the board (work-in-progress load). */
export function authorLoad(pulls: DerivedPull[]): AuthorLoad[] {
   const by = new Map<string, Load>();
   for (const p of pulls) {
      const cur = by.get(p.data.user.login) ?? emptyLoad();
      cur.count += 1;
      countReview(cur, p);
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
   inSelfReview: number;
   waitingOnOthers: number;
   oldestDays: number;
}

/** where the open PRs live, and how much of each repo's pile is review work. */
export function repoBreakdown(pulls: DerivedPull[]): RepoLoad[] {
   const by = new Map<string, Load>();
   for (const p of pulls) {
      const cur = by.get(p.data.repo) ?? emptyLoad();
      cur.count += 1;
      countReview(cur, p);
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
