import type { PullData } from '../../../shared/types';

/**
 * Claims. A reviewer who picks up a review says "I'll review" on the board,
 * which adds them as a GitHub reviewer on the PR, so a claim IS a review
 * request the reviewer made on themselves (review_requests marks it
 * self === true). Who the author's side asked is derive()'s askedOf
 * (shared/model/status.ts), which leaves claims out.
 *
 * Kept viewer-agnostic and side-effect-free like the rest of model/.
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
   const entry = (pull.review_requests ?? []).find(
      r => r.self && !r.answered && r.login !== pull.user.login
   );
   return entry ? { login: entry.login, at: entry.at } : null;
}
