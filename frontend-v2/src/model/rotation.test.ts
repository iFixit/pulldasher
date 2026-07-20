import { describe, expect, it } from 'vitest';
import type { DerivedPull, Status } from './status';
import { buildReviewerPools, turnFor } from './rotation';

/** A DerivedPull with only the fields buildReviewerPools/turnFor read. */
function dp(o: {
   repo?: string;
   number?: number;
   author?: string;
   status?: Status;
   starved?: boolean;
   crBy?: string[];
   crLogins?: string[];
}): DerivedPull {
   return {
      data: {
         repo: o.repo ?? 'org/repo',
         number: o.number ?? 1,
         user: { login: o.author ?? 'author' },
         status: {
            allCR: (o.crLogins ?? []).map(login => ({ data: { user: { login } } })),
         },
      },
      status: o.status ?? 'needs_cr',
      starved: o.starved ?? true,
      crBy: o.crBy ?? [],
   } as unknown as DerivedPull;
}

describe('buildReviewerPools', () => {
   it('unions active and stale CR signers per repo', () => {
      const pulls = [
         dp({ repo: 'org/a', crLogins: ['alice', 'bob'] }),
         dp({ repo: 'org/a', number: 2, crLogins: ['bob', 'carol'] }),
         dp({ repo: 'org/b', crLogins: ['dave'] }),
      ];
      const pools = buildReviewerPools(pulls);
      expect(pools.get('org/a')).toEqual(['alice', 'bob', 'carol']);
      expect(pools.get('org/b')).toEqual(['dave']);
   });

   it('excludes bot logins', () => {
      const pulls = [dp({ crLogins: ['alice', 'dependabot[bot]'] })];
      expect(buildReviewerPools(pulls).get('org/repo')).toEqual(['alice']);
   });

   it('returns an empty map for no pulls', () => {
      expect(buildReviewerPools([]).size).toBe(0);
   });
});

describe('turnFor', () => {
   const pools = buildReviewerPools([
      dp({ repo: 'org/repo', crLogins: ['alice', 'bob', 'carol'] }),
   ]);

   it('is null when the pull is not starved', () => {
      expect(turnFor(dp({ starved: false }), pools)).toBeNull();
   });

   it('is null outside needs_cr/needs_recr', () => {
      expect(turnFor(dp({ status: 'ready' }), pools)).toBeNull();
      expect(turnFor(dp({ status: 'dev_block' }), pools)).toBeNull();
   });

   it('is null when the repo has no pool', () => {
      expect(turnFor(dp({ repo: 'org/unknown' }), pools)).toBeNull();
   });

   it('is null when every pool member is the author or already stamped', () => {
      const p = dp({ author: 'alice', crBy: ['bob', 'carol'] });
      expect(turnFor(p, pools)).toBeNull();
   });

   it('picks the same name on every call — deterministic', () => {
      const p = dp({ number: 42 });
      const first = turnFor(p, pools);
      expect(first).not.toBeNull();
      for (let i = 0; i < 5; i++) expect(turnFor(p, pools)).toBe(first);
   });

   it('picks a candidate from the eligible pool, excluding the author and existing CR', () => {
      const p = dp({ author: 'bob', crBy: ['carol'] });
      expect(turnFor(p, pools)).toBe('alice');
   });

   it('different pull numbers can land on different names', () => {
      const picks = new Set<string | null>();
      for (let n = 0; n < 30; n++) picks.add(turnFor(dp({ number: n }), pools));
      // over 30 distinct keys hashed into a 3-person pool, expect more than
      // one name to come up — a constant pick would mean the hash isn't
      // actually varying with the pull identity
      expect(picks.size).toBeGreaterThan(1);
   });
});
