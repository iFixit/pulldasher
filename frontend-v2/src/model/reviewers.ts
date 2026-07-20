import type { DerivedPull } from './status';

/**
 * GitHub review requests. A `requested_reviewers` entry is GitHub's explicit,
 * authoritative "please review this" — a stronger signal than our own turn
 * rotation (model/rotation.ts), which is only a deterministic guess for
 * starved pulls with nobody assigned. So an explicit request supersedes the
 * rotation: turnFor stays silent whenever a pull carries one, and the note /
 * row highlight speak for the request instead.
 *
 * Kept viewer-agnostic and side-effect-free like the rest of model/. The
 * "is it mine to review" question is answered at call sites that know `me`.
 */

/** logins GitHub has an open review request from, minus the author (GitHub
 * never requests a review from the PR's own author, but guard anyway). */
export function requestedReviewers(p: DerivedPull): string[] {
   return (p.data.requested_reviewers ?? []).filter(login => login !== p.data.user.login);
}

/** GitHub has explicitly asked `me` to review this pull. */
export function reviewRequestedFrom(p: DerivedPull, me: string): boolean {
   return requestedReviewers(p).includes(me);
}

/** The pull carries any open GitHub review request at all — the signal
 * turnFor checks to know it should defer to GitHub rather than rotate. */
export function hasReviewRequest(p: DerivedPull): boolean {
   return requestedReviewers(p).length > 0;
}
