import { describe, expect, it } from 'vitest';
import type { PullData } from '../types';
import type { DerivedPull, Status } from './status';
import { crStarvation, humanHours, mergeTimeBySize, signoffLeaders } from './stats';

function sig(login: string) {
   return { data: { user: { login } } };
}

function open(over: {
   status?: Status;
   author?: string;
   ageDays?: number;
   cr?: string[];
   qa?: string[];
   n?: number;
}): DerivedPull {
   return {
      status: over.status ?? 'needs_cr',
      ageDays: over.ageDays ?? 0,
      data: {
         repo: 'iFixit/ifixit',
         number: over.n ?? 1,
         user: { login: over.author ?? 'alice' },
         status: {
            allCR: (over.cr ?? []).map(sig),
            allQA: (over.qa ?? []).map(sig),
         },
      },
   } as unknown as DerivedPull;
}

function merged(over: { n: number; add: number | null; hours: number }): PullData {
   const created = 1_700_000_000_000;
   return {
      repo: 'iFixit/ifixit',
      number: over.n,
      merged_at: new Date(created + over.hours * 3_600_000).toISOString(),
      created_at: new Date(created).toISOString(),
      additions: over.add,
      // unsized on the wire means both are absent, not zero
      deletions: over.add == null ? null : 0,
      changed_files: 1,
      status: { allCR: [], allQA: [] },
   } as unknown as PullData;
}

describe('signoffLeaders', () => {
   it('counts distinct PRs per reviewer across open and closed', () => {
      const pulls = [
         open({ n: 1, cr: ['bob', 'carol'] }),
         open({ n: 2, cr: ['bob', 'bob'] }), // a re-stamp is still one PR
      ];
      const closed = [{ ...pulls[0].data, number: 3, status: { allCR: [sig('bob')], allQA: [] } }];
      const leaders = signoffLeaders(pulls, closed as unknown as PullData[], 'CR');
      expect(leaders[0]).toEqual({ login: 'bob', count: 3 });
      expect(leaders.find(l => l.login === 'carol')?.count).toBe(1);
   });

   it('separates CR from QA', () => {
      const pulls = [open({ n: 1, cr: ['bob'], qa: ['dave'] })];
      expect(signoffLeaders(pulls, [], 'QA')).toEqual([{ login: 'dave', count: 1 }]);
   });
});

describe('crStarvation', () => {
   it('sums open-days by author over CR-incomplete PRs, tracking the worst', () => {
      const pulls = [
         open({ author: 'alice', status: 'needs_cr', ageDays: 10, n: 1 }),
         open({ author: 'alice', status: 'needs_recr', ageDays: 4, n: 2 }),
         open({ author: 'bob', status: 'needs_cr', ageDays: 20, n: 3 }),
         open({ author: 'carol', status: 'ready', ageDays: 99, n: 4 }), // not starving
      ];
      const s = crStarvation(pulls);
      expect(s.map(x => x.login)).toEqual(['bob', 'alice']); // bob 20 > alice 14
      const alice = s.find(x => x.login === 'alice')!;
      expect(alice).toMatchObject({ count: 2, totalDays: 14, worstDays: 10 });
      expect(s.find(x => x.login === 'carol')).toBeUndefined();
   });
});

describe('mergeTimeBySize', () => {
   it('buckets merged PRs by weight and reports count and medians, skipping unsized', () => {
      const closed = [
         merged({ n: 1, add: 10, hours: 2 }), // XS
         merged({ n: 2, add: 20, hours: 4 }), // XS
         merged({ n: 3, add: 800, hours: 50 }), // L
         merged({ n: 4, add: null, hours: 5 }), // no size, dropped
      ];
      const r = mergeTimeBySize(closed);
      expect(r.merged).toBe(4);
      expect(r.sampled).toBe(3);
      const xs = r.buckets.find(b => b.weight === 'XS')!;
      expect(xs.count).toBe(2);
      expect(xs.medianHours).toBe(3); // (2+4)/2
      expect(r.buckets.find(b => b.weight === 'L')!.count).toBe(1);
      expect(r.buckets.find(b => b.weight === 'M')!.count).toBe(0);
   });

   it('ignores non-merged and non-positive durations', () => {
      const closed = [
         merged({ n: 1, add: 10, hours: 0 }), // zero duration, dropped
         { ...merged({ n: 2, add: 10, hours: 5 }), merged_at: null }, // not merged
      ];
      expect(mergeTimeBySize(closed as unknown as PullData[]).sampled).toBe(0);
   });
});

describe('humanHours', () => {
   it('formats minutes, hours, and days', () => {
      expect(humanHours(0.5)).toBe('30m');
      expect(humanHours(3.2)).toBe('3.2h');
      expect(humanHours(50)).toBe('2.1d');
   });
});
