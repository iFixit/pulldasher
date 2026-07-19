import { STATUS_ORDER, type DerivedPull } from './status';
import { crSort } from './sort';

export interface TeamBuckets {
   reviewable: DerivedPull[];
   stamped: DerivedPull[];
   rest: DerivedPull[];
}

/**
 * The Team view's three buckets, pulled out of the view so the rules are
 * unit-testable without mounting React. Mirrors People.tsx's per-person split
 * (reviewable / mine / rest) generalized to a set of members: a needs_recr
 * pull naming you in `recrBy` means YOUR stamp went stale, which is a
 * personal to-do surfaced elsewhere (Review's "Yours to do"), not an open
 * item for the review queue — so it lands in `stamped`, same as People.tsx.
 * The author being you is excluded everywhere, even if `me` ends up in
 * `members` by mistake — you can't review your own PR.
 */
export function teamBuckets(
   pulls: DerivedPull[],
   members: string[],
   me: string | null
): TeamBuckets {
   const memberSet = new Set(members);
   const theirs = pulls.filter(p => memberSet.has(p.data.user.login) && p.data.user.login !== me);

   const reviewable = crSort(
      theirs.filter(
         p =>
            ['needs_cr', 'needs_recr'].includes(p.status) &&
            !p.crBy.includes(me ?? '') &&
            !p.recrBy.includes(me ?? '')
      )
   );
   const stamped = theirs.filter(
      p =>
         ['needs_cr', 'needs_recr'].includes(p.status) &&
         (p.crBy.includes(me ?? '') || p.recrBy.includes(me ?? ''))
   );
   const inLane = new Set([...reviewable, ...stamped]);
   const rest = theirs
      .filter(p => !inLane.has(p))
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

   return { reviewable, stamped, rest };
}
