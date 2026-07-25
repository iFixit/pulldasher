import { describe, expect, it } from 'vitest';
import { pullKey } from '../../shared/format';
import type { PullData } from '../../shared/types';
import { isSnoozed, type SnoozeRecord } from './store';

// isSnoozed reads only repo/number/updated_at and a few status counts, so a
// minimal pull is enough; the outer cast keeps the fixture to what it touches.
// cr/qa/unstamped take either a plain count (all "human" logins) or an
// explicit login list, so a test can mark specific entries as bots.
function pull(o: {
   updatedAtEpoch: number;
   comments?: number;
   humanComments?: number;
   cr?: number | string[];
   qa?: number | string[];
   unstamped?: number | string[];
}): PullData {
   const logins = (n: number | string[] | undefined, fallback: string) =>
      Array.isArray(n) ? n : Array.from({ length: n ?? 0 }, () => fallback);
   return {
      repo: 'org/repo',
      number: 7,
      updated_at: new Date(o.updatedAtEpoch * 1000).toISOString(),
      status: {
         cr_req: 2,
         qa_req: 1,
         allCR: logins(o.cr, 'human').map(login => ({ data: { user: { login } } })),
         allQA: logins(o.qa, 'human').map(login => ({ data: { user: { login } } })),
         dev_block: [],
         deploy_block: [],
         commit_statuses: [],
         comment_count: o.comments ?? 0,
         human_comment_count: o.humanComments,
         unstamped_reviewers: logins(o.unstamped, 'human').map(login => ({
            login,
            state: 'COMMENTED',
            date: 0,
         })),
      },
   } as unknown as PullData;
}

const AT = 1_000_000; // epoch secs the pull was snoozed
const WITHIN = AT + 60; // "now", inside the 24h window
const KEY = pullKey({ repo: 'org/repo', number: 7 });
const rec = (o: Partial<SnoozeRecord> = {}): Record<string, SnoozeRecord> => ({
   [KEY]: { at: AT, comments: 0, reviews: 0, ...o },
});

describe('isSnoozed', () => {
   it('stays snoozed when nothing changed since the snooze', () => {
      expect(isSnoozed(pull({ updatedAtEpoch: AT - 100 }), rec(), WITHIN)).toBe(true);
   });

   it('is not snoozed without a record for the pull', () => {
      expect(isSnoozed(pull({ updatedAtEpoch: AT - 100 }), {}, WITHIN)).toBe(false);
   });

   it('wakes when the comment count climbs above the baseline', () => {
      expect(
         isSnoozed(pull({ updatedAtEpoch: AT - 100, comments: 3 }), rec({ comments: 2 }), WITHIN)
      ).toBe(false);
   });

   it('wakes on a new review: a CR stamp or an unstamped verdict', () => {
      expect(
         isSnoozed(pull({ updatedAtEpoch: AT - 100, cr: 1 }), rec({ reviews: 0 }), WITHIN)
      ).toBe(false);
      expect(
         isSnoozed(pull({ updatedAtEpoch: AT - 100, unstamped: 1 }), rec({ reviews: 0 }), WITHIN)
      ).toBe(false);
   });

   it('does not wake when a count merely drops (a deleted comment fails safe)', () => {
      expect(
         isSnoozed(pull({ updatedAtEpoch: AT - 100, comments: 1 }), rec({ comments: 3 }), WITHIN)
      ).toBe(true);
   });

   it('wakes on a push that moved updated_at past the snooze', () => {
      expect(isSnoozed(pull({ updatedAtEpoch: AT + 100 }), rec(), WITHIN)).toBe(false);
   });

   it('expires after the 24h window', () => {
      expect(isSnoozed(pull({ updatedAtEpoch: AT - 100 }), rec(), AT + 24 * 3600 + 1)).toBe(false);
   });

   it('a bot review or comment-only verdict does not wake a snooze', () => {
      // claude[bot] posts a CR stamp and a COMMENTED verdict on the same
      // pull; bot activity must never drive the human-review nudge, so
      // neither should wake a snoozed row.
      expect(
         isSnoozed(
            pull({ updatedAtEpoch: AT - 100, cr: ['claude[bot]'] }),
            rec({ reviews: 0 }),
            WITHIN
         )
      ).toBe(true);
      expect(
         isSnoozed(
            pull({ updatedAtEpoch: AT - 100, unstamped: ['claude[bot]'] }),
            rec({ reviews: 0 }),
            WITHIN
         )
      ).toBe(true);
   });

   it('still wakes on a human review alongside a bot one', () => {
      expect(
         isSnoozed(
            pull({ updatedAtEpoch: AT - 100, cr: ['claude[bot]', 'human'] }),
            rec({ reviews: 0 }),
            WITHIN
         )
      ).toBe(false);
   });

   it('prefers human_comment_count over comment_count for the wake signal', () => {
      // The server counts a bot comment in comment_count but not in
      // human_comment_count; only the human-only count should matter.
      expect(
         isSnoozed(
            pull({ updatedAtEpoch: AT - 100, comments: 3, humanComments: 2 }),
            rec({ comments: 2 }),
            WITHIN
         )
      ).toBe(true);
   });

   it('falls back to comment_count when an older server omits human_comment_count', () => {
      expect(
         isSnoozed(pull({ updatedAtEpoch: AT - 100, comments: 3 }), rec({ comments: 2 }), WITHIN)
      ).toBe(false);
   });
});
