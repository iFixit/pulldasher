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

   it('excludes a pull authored by me, even if I ended up in the member list', () => {
      const p = dp({ author: 'me', status: 'needs_cr' });
      const buckets = teamBuckets([p], ['me'], 'me');
      expect(buckets).toEqual({ reviewable: [], stamped: [], rest: [] });
   });

   it('moves a pull to stamped once I hold a CR stamp on it', () => {
      const p = dp({ author: 'alice', status: 'needs_cr', crBy: ['me'] });
      const { reviewable, stamped } = teamBuckets([p], ['alice'], 'me');
      expect(reviewable).toEqual([]);
      expect(stamped).toEqual([p]);
   });

   it('moves a needs_recr pull to stamped when the stale stamp owed is mine', () => {
      // recrBy naming you means YOUR earlier stamp went stale — that's a
      // personal to-do (Review's "Yours to do"), not a fresh pick for the
      // review queue, so it lands in stamped, same as People.tsx's mine.
      const p = dp({ author: 'alice', status: 'needs_recr', recrBy: ['me'] });
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
