import { STARVE_DAYS, isIterating, weightRank, type DerivedPull } from './status';

/**
 * The review-queue score, lower first. Weight is the base (lightest first —
 * a 10-minute reviewer takes what fits), then two corrections the old sort
 * lacked:
 *
 * - leverage: a pull one stamp from done jumps ~1.5 weight classes. Your
 *   stamp there finishes CR instead of starting it.
 * - age: up to two weight classes of credit as a pull approaches two weeks,
 *   so an old M outranks a fresh S instead of waiting for the starvation
 *   cliff.
 *
 * Unknown size ranks as M-ish, not XS: missing data must not promote a pull
 * to the top of everyone's queue.
 */
export function crScore(p: DerivedPull): number {
   const weight = weightRank(p.weight);
   const req = p.data.status.cr_req;
   const oneFromDone = p.crHave > 0 && req - p.crHave === 1;
   const ageCredit = Math.min(p.ageDays / STARVE_DAYS, 2);
   return weight - (oneFromDone ? 1.5 : 0) - ageCredit;
}

/** best next review first; actively-iterating pulls sink (demoted, never hidden) */
export function crSort(pulls: DerivedPull[]): DerivedPull[] {
   return [...pulls].sort(
      (a, b) =>
         Number(isIterating(a)) - Number(isIterating(b)) ||
         crScore(a) - crScore(b) ||
         b.ageDays - a.ageDays ||
         (a.data.additions ?? 0) +
            (a.data.deletions ?? 0) -
            ((b.data.additions ?? 0) + (b.data.deletions ?? 0))
   );
}

/**
 * Stable-partition a sorted list so starred authors' pulls float to the
 * front, preserving each group's existing relative order — a starred
 * teammate's pull outranks everyone else's regardless of weight or age, but
 * the queue's own sort still decides order within "starred" and within
 * "everyone else."
 */
export function starFirst(pulls: DerivedPull[], starred: ReadonlySet<string>): DerivedPull[] {
   return [
      ...pulls.filter(p => starred.has(p.data.user.login)),
      ...pulls.filter(p => !starred.has(p.data.user.login)),
   ];
}
