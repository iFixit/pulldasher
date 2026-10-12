import { CR_INCOMPLETE, STATUS_ORDER, type DerivedPull } from '../../../shared/model/status';
import { reviewIsMine } from './actions';
import { crSort } from './sort';

export interface TeamBuckets {
   reviewable: DerivedPull[];
   stamped: DerivedPull[];
   rest: DerivedPull[];
}

/**
 * The Team view's three buckets, pulled out of the view so the rules are
 * unit-testable without mounting React. Mirrors People.tsx's per-person split
 * (reviewable / mine / rest) generalized to a set of members.
 *
 * `reviewable` is only review that's yours under self-review (actions.ts
 * reviewIsMine: asked of you, one you said you'd do, or from outside the dev
 * team with nobody on it); a teammate's own unrequested PR is theirs to
 * review, so it sits in `rest` with the rest of what they're working on.
 *
 * The stamp split is by *live* vs *stale*: only a currently-active CR stamp of
 * yours (`crBy`) is genuinely "stamped, in flight, waiting on another
 * reviewer." A needs_recr pull naming you in `recrBy` means your earlier stamp
 * went stale, so it belongs in `reviewable`, not `stamped`. Your own pulls
 * stay out of `reviewable`/`stamped` — but they still land in `rest`, so
 * adding yourself to your team surfaces your work instead of dropping it.
 */
export function teamBuckets(
   pulls: DerivedPull[],
   members: string[],
   me: string | null
): TeamBuckets {
   const memberSet = new Set(members);
   // include your own pulls in the pool; you just can't *review* them, so they
   // fall through to `rest` below instead of vanishing when you add yourself
   const theirs = pulls.filter(p => memberSet.has(p.data.user.login));
   const reviewableByMe = (p: DerivedPull) => me != null && reviewIsMine(p, me);

   const reviewable = crSort(
      theirs.filter(
         p => reviewableByMe(p) && CR_INCOMPLETE.includes(p.status) && !p.crBy.includes(me ?? '')
      )
   );
   const stamped = theirs.filter(
      p => reviewableByMe(p) && CR_INCOMPLETE.includes(p.status) && p.crBy.includes(me ?? '')
   );
   const inLane = new Set([...reviewable, ...stamped]);
   const rest = theirs
      .filter(p => !inLane.has(p))
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

   return { reviewable, stamped, rest };
}
