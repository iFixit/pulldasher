import { describe, expect, it } from 'vitest';
import type { PullData } from '../../../shared/types';
import { reviewerRanks } from './leaderboard';
import type { DerivedPull } from '../../../shared/model/status';

/** An open DerivedPull carrying only the fields reviewerRanks reads. author
 * defaults to a sentinel that never appears in crBy/qaBy, so existing cases are
 * unaffected by the self-stamp exclusion. */
function open(
   repo: string,
   number: number,
   o: { crBy?: string[]; qaBy?: string[]; author?: string } = {}
) {
   return {
      data: { repo, number, user: { login: o.author ?? '__author__' } },
      crBy: o.crBy ?? [],
      qaBy: o.qaBy ?? [],
   } as unknown as DerivedPull;
}

/** A closed PullData carrying only the fields reviewerRanks reads — allCR/
 * allQA logins count whether active or stale. */
function closed(
   repo: string,
   number: number,
   o: { cr?: string[]; qa?: string[]; author?: string } = {}
): PullData {
   const sig = (login: string) => ({ data: { user: { login } } });
   return {
      repo,
      number,
      user: { login: o.author ?? '__author__' },
      status: { allCR: (o.cr ?? []).map(sig), allQA: (o.qa ?? []).map(sig) },
   } as unknown as PullData;
}

describe('reviewerRanks', () => {
   it('returns an empty map for an empty board', () => {
      expect(reviewerRanks([], [])).toEqual(new Map());
   });

   it('dedupes multiple stamps on the same pull to one count', () => {
      const p = open('org/a', 1, { crBy: ['alice'], qaBy: ['alice'] });
      const ranks = reviewerRanks([p], []);
      expect(ranks.get('alice')).toEqual({ count: 1, rank: 1 });
   });

   it('counts distinct pulls across open and closed', () => {
      const openPull = open('org/a', 1, { crBy: ['alice'] });
      const closedPull = closed('org/a', 2, { qa: ['alice'] });
      const ranks = reviewerRanks([openPull], [closedPull]);
      expect(ranks.get('alice')).toEqual({ count: 2, rank: 1 });
   });

   it('counts a closed pull stamp whether active or stale', () => {
      // the dp-style fixture has no `active` flag at all — reviewerRanks
      // doesn't filter closed sigs by it, unlike the open crBy/qaBy lists.
      const closedPull = closed('org/a', 1, { cr: ['alice'] });
      expect(reviewerRanks([], [closedPull]).get('alice')?.count).toBe(1);
   });

   it('dense-ranks ties: equal counts share a rank, the next rank is +1 not skipped', () => {
      const pulls = [
         open('org/a', 1, { crBy: ['alice'] }),
         open('org/a', 2, { crBy: ['bob'] }),
         open('org/a', 3, { crBy: ['carol', 'carol'] }), // still just 1 distinct pull
         open('org/a', 4, { crBy: ['carol'] }),
      ];
      const ranks = reviewerRanks(pulls, []);
      expect(ranks.get('carol')).toEqual({ count: 2, rank: 1 });
      expect(ranks.get('alice')).toEqual({ count: 1, rank: 2 });
      expect(ranks.get('bob')).toEqual({ count: 1, rank: 2 });
   });

   it('excludes empty logins', () => {
      const p = open('org/a', 1, { crBy: [''] });
      expect(reviewerRanks([p], []).size).toBe(0);
   });

   it('never credits a pull author for stamping their own PR', () => {
      // a self-tagged CR/QA is not review work — open and closed alike
      const openSelf = open('org/a', 1, { author: 'alice', crBy: ['alice', 'bob'] });
      const closedSelf = closed('org/a', 2, { author: 'alice', qa: ['alice'] });
      const ranks = reviewerRanks([openSelf], [closedSelf]);
      // alice authored both and only self-stamped → no credit at all
      expect(ranks.get('alice')).toBeUndefined();
      // bob's real review of alice's PR still counts
      expect(ranks.get('bob')).toEqual({ count: 1, rank: 1 });
   });
});
