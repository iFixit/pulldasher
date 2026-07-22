import { describe, expect, it } from 'vitest';
import type { DerivedPull, Status, Weight } from './status';
import { teamBuckets } from './team';

/** A DerivedPull with only the fields teamBuckets and crSort read. */
function dp(o: {
   author?: string;
   status: Status;
   crBy?: string[];
   recrBy?: string[];
   ageDays?: number;
   weight?: Weight;
   sizeKnown?: boolean;
   crHave?: number;
}): DerivedPull {
   return {
      data: {
         user: { login: o.author ?? 'author' },
         status: { cr_req: 1, qa_req: 1 },
         additions: 10,
         deletions: 0,
         updated_at: '2024-01-01T00:00:00Z',
      },
      status: o.status,
      crBy: o.crBy ?? [],
      recrBy: o.recrBy ?? [],
      ageDays: o.ageDays ?? 0,
      weight: o.weight ?? 'M',
      sizeKnown: o.sizeKnown ?? true,
      crHave: o.crHave ?? 0,
   } as unknown as DerivedPull;
}

describe('teamBuckets — what a team-authored pull sorts into', () => {
   it('includes a pull whose author is on the team', () => {
      const p = dp({ author: 'alice', status: 'needs_cr' });
      const { reviewable } = teamBuckets([p], ['alice'], 'me');
      expect(reviewable).toEqual([p]);
   });

   it('keeps my own pull out of reviewable/stamped but lands it in rest (self on team)', () => {
      // you can't review your own PR, so it never enters reviewable/stamped —
      // but adding yourself should still surface your work, in rest, not drop it
      const p = dp({ author: 'me', status: 'needs_cr' });
      const buckets = teamBuckets([p], ['me'], 'me');
      expect(buckets).toEqual({ reviewable: [], stamped: [], rest: [p] });
   });

   it('moves a pull to stamped once I hold a CR stamp on it', () => {
      const p = dp({ author: 'alice', status: 'needs_cr', crBy: ['me'] });
      const { reviewable, stamped } = teamBuckets([p], ['alice'], 'me');
      expect(reviewable).toEqual([]);
      expect(stamped).toEqual([p]);
   });

   it('keeps a needs_recr pull reviewable when the stale stamp owed is mine', () => {
      // recrBy naming you means YOUR earlier stamp went stale: the PR is back
      // to 0-of-1 and still needs a CR — reviewable by you (a re-stamp) or by
      // anyone else, NOT "stamped, waiting on another reviewer".
      const p = dp({ author: 'alice', status: 'needs_recr', recrBy: ['me'] });
      const { reviewable, stamped } = teamBuckets([p], ['alice'], 'me');
      expect(reviewable).toEqual([p]);
      expect(stamped).toEqual([]);
   });

   it('keeps a needs_recr pull stamped when my CR is still live (someone else went stale)', () => {
      // my stamp is active (crBy), another reviewer's went stale — genuinely
      // in flight, waiting on that other reviewer to re-stamp
      const p = dp({ author: 'alice', status: 'needs_recr', crBy: ['me'], recrBy: ['bob'] });
      const { reviewable, stamped } = teamBuckets([p], ['alice'], 'me');
      expect(reviewable).toEqual([]);
      expect(stamped).toEqual([p]);
   });

   it('lands non-CR statuses in rest', () => {
      const p = dp({ author: 'alice', status: 'ready' });
      const { reviewable, stamped, rest } = teamBuckets([p], ['alice'], 'me');
      expect(reviewable).toEqual([]);
      expect(stamped).toEqual([]);
      expect(rest).toEqual([p]);
   });

   it('sorts reviewable with crSort, not input order', () => {
      const heavy = dp({ author: 'alice', status: 'needs_cr', weight: 'XL' });
      const light = dp({ author: 'alice', status: 'needs_cr', weight: 'XS' });
      // heavy passed first — crSort should still put the lighter pull first
      const { reviewable } = teamBuckets([heavy, light], ['alice'], 'me');
      expect(reviewable).toEqual([light, heavy]);
   });

   it('returns everything empty when the team has no members', () => {
      const p = dp({ author: 'alice', status: 'needs_cr' });
      const buckets = teamBuckets([p], [], 'me');
      expect(buckets).toEqual({ reviewable: [], stamped: [], rest: [] });
   });
});
