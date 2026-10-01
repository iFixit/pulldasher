import { CR_INCOMPLETE, type DerivedPull } from './status';
import { isSuffixBot } from './visibility';

/**
 * Where an open PR stands, in a product manager's words, and the board's
 * rules it's built on. Shared so the project flags (projects.ts, which the
 * server runs too) count the same way the project page does.
 */

/**
 * The three statuses that put the ball wholly with the author — while one
 * holds, the board asks reviewers for NOTHING, not even an owed re-stamp: a
 * draft isn't reviewable, a dev block means more pushes are coming, and
 * ci_red only exists once a pull is fully signed off (model/status moved CI
 * to the ready gate), so nothing is left to ask of reviewers but the build.
 * A red build on a pull still AWAITING review keeps its needs_cr/needs_recr
 * status and stays in the queues — whether to review a failing build is the
 * reviewer's call, not the board's. Gates the personal-obligation checks
 * (Re-stamp / Finish QA / Re-QA) in reviewerMove, reviewerNote, and the
 * `is:restamp` query token. (QA obligations stay un-gated across the OTHER
 * statuses on purpose — QA runs in parallel with CR on this board.)
 */
export const authorOwnsIt = (p: DerivedPull): boolean =>
   p.status === 'draft' || p.status === 'dev_block' || p.status === 'ci_red';

/**
 * A parked pull (the Cryogenic Storage label) asks nothing of ANYONE —
 * author included — until the label comes off. Stronger than authorOwnsIt
 * (where the author still has a move): parked means deliberately shelved,
 * so no do-word, no lane slot, no turn, no nudge, whether or not the pull
 * is visible on the board.
 */
export const parked = (p: DerivedPull): boolean => p.cryo;

/** Epoch secs of the newest still-standing changes-requested review, or null
 * when none of the unstamped reviews carries that verdict (or the wire didn't
 * send them). */
function lastChangesRequestedAt(p: DerivedPull): number | null {
   const dates = (p.data.status.unstamped_reviewers ?? [])
      .filter(r => r.state === 'CHANGES_REQUESTED' && !isSuffixBot(r.login))
      .map(r => r.date);
   return dates.length ? Math.max(...dates) : null;
}

/**
 * The author pushed AFTER the newest changes-requested review: the ball is
 * back with the reviewer, so "Address feedback" would nag the author about
 * work they already did — the truthful note is "waiting on X to re-review"
 * (and, for the reviewer who asked, an actionable "Re-review"). False when
 * the review can't be dated: nagging beats wrongly absolving.
 */
export function feedbackAnswered(p: DerivedPull): boolean {
   const at = lastChangesRequestedAt(p);
   return at != null && p.headPushedAt != null && p.headPushedAt > at;
}

export type PrStage = 'ready' | 'hold' | 'review' | 'work';

/** Where an open PR stands. */
export function prStage(p: DerivedPull): PrStage {
   if (parked(p) || p.externalBlock || p.status === 'deploy_block') return 'hold';
   if (
      authorOwnsIt(p) ||
      // changes asked for and not answered yet: the author's move, as the
      // board's note says ("Address feedback"), on a first review or a re-review
      (CR_INCOMPLETE.includes(p.status) && p.changesRequestedBy.length > 0 && !feedbackAnswered(p))
   ) {
      return 'work';
   }
   if (p.status === 'needs_cr' || p.status === 'needs_recr' || p.status === 'needs_qa') {
      return 'review';
   }
   // signed off but in conflict, whatever CI is doing: the author rebases
   if (p.conflict) return 'work';
   // ready, CI running on a signed-off PR, or a clean PR waiting on the one it's stacked on
   return 'ready';
}
