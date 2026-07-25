import { describe, expect, it } from 'vitest';
import { pullKey } from '../../shared/format';
import type { PullData } from '../../shared/types';
import { isSnoozed, type SnoozeRecord } from './store';

// isSnoozed reads only repo/number/updated_at and a few status counts, so a
// minimal pull is enough; the outer cast keeps the fixture to what it touches.
function pull(o: {
   updatedAtEpoch: number;
   comments?: number;
   cr?: number;
   qa?: number;
   unstamped?: number;
}): PullData {
   return {
      repo: 'org/repo',
      number: 7,
      updated_at: new Date(o.updatedAtEpoch * 1000).toISOString(),
      status: {
         cr_req: 2,
         qa_req: 1,
         allCR: Array.from({ length: o.cr ?? 0 }, () => ({})),
         allQA: Array.from({ length: o.qa ?? 0 }, () => ({})),
         dev_block: [],
         deploy_block: [],
         commit_statuses: [],
         comment_count: o.comments ?? 0,
         unstamped_reviewers: Array.from({ length: o.unstamped ?? 0 }, () => ({
            login: 'x',
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
});
