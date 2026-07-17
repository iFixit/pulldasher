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

/** "3h" / "1.4d" / "12d" — durations for the merge-time bars. */
export function humanHours(h: number): string {
   if (h < 1) return `${Math.round(h * 60)}m`;
   if (h < 24) return `${h < 10 ? h.toFixed(1) : Math.round(h)}h`;
   const d = h / 24;
   return `${d < 10 ? d.toFixed(1) : Math.round(d)}d`;
}
