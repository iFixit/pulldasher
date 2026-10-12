import {
   STARVE_DAYS,
   isIterating,
   weightRank,
   type DerivedPull,
} from '../../../shared/model/status';
import { selfReviewed } from './actions';

/**
 * The review-queue score, lower first. Weight is the base (lightest first —
 * a 10-minute reviewer takes what fits), then two corrections the old sort
 * lacked:
 *
 * - leverage: a pull one stamp from done jumps ~1.5 weight classes. Your
 *   stamp there finishes CR instead of starting it. The author's own stamp
 *   doesn't count toward it: it's not someone else's review in.
 * - age: up to two weight classes of credit as a pull approaches two weeks,
 *   so an old M outranks a fresh S instead of waiting for the starvation
 *   cliff. None for a self-reviewed pull: nobody else is keeping it waiting.
 *
 * Unknown size ranks as M-ish, not XS: missing data must not promote a pull
 * to the top of everyone's queue.
 */
export function crScore(p: DerivedPull): number {
   const weight = weightRank(p.weight);
   const req = p.data.status.cr_req;
   const have = p.crBy.filter(l => l !== p.data.user.login).length;
   const oneFromDone = have > 0 && req - have === 1;
   const ageCredit = selfReviewed(p) ? 0 : Math.min(p.ageDays / STARVE_DAYS, 2);
   return weight - (oneFromDone ? 1.5 : 0) - ageCredit;
}

/** best next review first; actively-iterating pulls sink (demoted, never
 * hidden), and a parked project's (`sinks`, model/standing.ts) below them */
export function crSort(pulls: DerivedPull[], sinks?: (p: DerivedPull) => boolean): DerivedPull[] {
   return [...pulls].sort(
      (a, b) =>
         Number(!!sinks?.(a)) - Number(!!sinks?.(b)) ||
         Number(isIterating(a)) - Number(isIterating(b)) ||
         crScore(a) - crScore(b) ||
         b.ageDays - a.ageDays ||
         (a.data.additions ?? 0) +
            (a.data.deletions ?? 0) -
            ((b.data.additions ?? 0) + (b.data.deletions ?? 0))
   );
}

/**
 * Stable-partition a sorted list so your team's pulls lead, preserving each
 * group's existing relative order — a teammate's pull outranks everyone
 * else's regardless of weight or age, but the queue's own sort still decides
 * order within "your team" and within "everyone else." (There is no extra
 * ranking BETWEEN teammates: membership is binary, the score does the rest.)
 */
export function teamFirst(pulls: DerivedPull[], team: ReadonlySet<string>): DerivedPull[] {
   return [
      ...pulls.filter(p => team.has(p.data.user.login)),
      ...pulls.filter(p => !team.has(p.data.user.login)),
   ];
}

/** Lowest `rank` first, each rank keeping the order it had (sort is
 * stable): how a lane sinks a parked project's pulls, or a bot's, to its
 * bottom without reordering anything else. */
export function sinkBy(pulls: DerivedPull[], rank: (p: DerivedPull) => number): DerivedPull[] {
   return [...pulls].sort((a, b) => rank(a) - rank(b));
}

/**
 * Within each run of neighbors that tie (the same `tie` key: the lane's
 * own ranking with age read in whole days), the pulls that would finish a
 * plan go first, every run otherwise in its order. A tie-break only: no
 * pull passes one that ranks above it for its own reasons, or leaves its
 * lane.
 */
export function finishersFirst(
   pulls: DerivedPull[],
   tie: (p: DerivedPull) => string,
   finishes: (p: DerivedPull) => boolean
): DerivedPull[] {
   // most lanes hold none, and a tie key can cost a score
   if (!pulls.some(finishes)) return pulls;
   const out: DerivedPull[] = [];
   let run: DerivedPull[] = [];
   let runKey = '';
   const flush = () => {
      out.push(...run.filter(finishes), ...run.filter(p => !finishes(p)));
      run = [];
   };
   for (const p of pulls) {
      const key = tie(p);
      if (run.length && key !== runKey) flush();
      runKey = key;
      run.push(p);
   }
   flush();
   return out;
}
