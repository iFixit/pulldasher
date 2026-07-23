import type { PullData } from '../types';
import type { DerivedPull } from './status';

/**
 * GitHub review requests. A `requested_reviewers` entry is GitHub's explicit,
 * authoritative "please review this" — a stronger signal than our own turn
 * rotation (model/rotation.ts), which is only a deterministic guess for
 * starved pulls with nobody assigned. So an explicit request supersedes the
 * rotation: turnFor stays silent whenever a pull carries one, and the note /
 * row highlight speak for the request instead.
 *
 * A claim (claimFor below) is ALSO a requested_reviewers entry now — the
 * server adds the claimant as a GitHub reviewer — so requestedReviewers/
 * reviewRequestedFrom read the `review_requests` metadata to tell the two
 * apart: an entry with self === true is you (or whoever) asking to review it
 * yourself, not GitHub asking on the author's behalf, so it's excluded from
 * "review this" here. hasReviewRequest stays broader on purpose (see below).
 *
 * Kept viewer-agnostic and side-effect-free like the rest of model/. The
 * "is it mine to review" question is answered at call sites that know `me`.
 */

/** Whoever's claimed to review this pull right now, or null. GitHub is the
 * source of truth: a claim IS a review request the reviewer made on
 * themselves, so this reads straight off the wire (pull.review_requests) —
 * no map, no server round trip to reconcile. `at` is epoch seconds, null
 * when the server can't say (e.g. it restarted before the webhook backfilled
 * it) — callers that show "X ago" must handle that case rather than assume a
 * number. The one claim predicate: rows, the deal, cheers, and desktop
 * notifications all read this, not private copies. */
export function claimFor(pull: PullData): { login: string; at: number | null } | null {
   const entry = (pull.review_requests ?? []).find(r => r.self && r.login !== pull.user.login);
   return entry ? { login: entry.login, at: entry.at } : null;
}

/** logins GitHub has an open review request from, minus the author (GitHub
 * never requests a review from the PR's own author, but guard anyway). Counts
 * self-requested (claimed) logins too — this is the raw wire list. */
function allRequestedReviewers(p: DerivedPull): string[] {
   return (p.data.requested_reviewers ?? []).filter(login => login !== p.data.user.login);
}

/** logins GitHub has an open review request from on the AUTHOR's behalf — a
 * real "please review this", excluding anyone whose request is a claim
 * (review_requests metadata marks it self === true). Metadata is best-effort:
 * absent (older server) or no matching entry means "can't prove it was a
 * claim", so the login still counts here. */
export function requestedReviewers(p: DerivedPull): string[] {
   const selfLogins = new Set((p.data.review_requests ?? []).filter(r => r.self).map(r => r.login));
   return allRequestedReviewers(p).filter(login => !selfLogins.has(login));
}

/** GitHub (the author's side) has explicitly asked `me` to review this pull —
 * false when the only request for `me` is their own claim. */
export function reviewRequestedFrom(p: DerivedPull, me: string): boolean {
   return requestedReviewers(p).includes(me);
}

/** The pull carries any open GitHub review request at all, claims included —
 * the signal turnFor checks to know it should defer rather than rotate. A
 * claimed pull already has someone on it, same as an author-requested one, so
 * this deliberately does NOT exclude self-requests the way requestedReviewers
 * does. */
export function hasReviewRequest(p: DerivedPull): boolean {
   return allRequestedReviewers(p).length > 0;
}
