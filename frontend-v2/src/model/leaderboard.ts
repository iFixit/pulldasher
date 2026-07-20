import { pullKey } from '../format';
import type { PullData } from '../types';
import type { DerivedPull } from './status';

/**
 * "On the board": a dense-ranked leaderboard of who's carried the most review
 * weight, counted over whatever the client has loaded (open + a closed
 * window) — not an org-wide historical ranking. That's a real limitation, not
 * a bug: the copy that reads this ("nobody's ahead of you on the board") says
 * so rather than claiming an authority the data doesn't have.
 */

export interface ReviewerRank {
   count: number;
   rank: number;
}

/**
 * Per login, the number of DISTINCT pulls they hold a CR or QA stamp on
 * across the open pulls (active stamps only — `crBy`/`qaBy` are already
 * filtered that way) plus the closed window (active-or-stale, since a closed
 * pull has no more chances to re-stamp; a stale sig there still means the
 * reviewer did the work). Dense-ranked by count descending: ties share a
 * rank, and the next distinct count is only one rank lower, not skipped.
 */
export function reviewerRanks(open: DerivedPull[], closed: PullData[]): Map<string, ReviewerRank> {
   const stampedKeysByLogin = new Map<string, Set<string>>();
   const credit = (login: string, key: string) => {
      if (!login) return;
      const keys = stampedKeysByLogin.get(login) ?? new Set<string>();
      keys.add(key);
      stampedKeysByLogin.set(login, keys);
   };

   for (const p of open) {
      const key = pullKey(p.data);
      for (const login of p.crBy) credit(login, key);
      for (const login of p.qaBy) credit(login, key);
   }
   for (const p of closed) {
      const key = pullKey(p);
      for (const s of [...p.status.allCR, ...p.status.allQA]) credit(s.data.user.login, key);
   }

   const counts = [...stampedKeysByLogin.entries()]
      .map(([login, keys]) => [login, keys.size] as const)
      .sort((a, b) => b[1] - a[1]);

   const ranks = new Map<string, ReviewerRank>();
   let rank = 0;
   let prevCount: number | null = null;
   for (const [login, count] of counts) {
      if (count !== prevCount) {
         rank++;
         prevCount = count;
      }
      ranks.set(login, { count, rank });
   }
   return ranks;
}
