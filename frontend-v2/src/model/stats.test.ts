import { describe, expect, it } from 'vitest';
import type { PullData } from '../types';
import type { DerivedPull, Status, Weight } from './status';
import {
   ageMix,
   authorLoad,
   crStarvation,
   effortMix,
   firstCrLatency,
   friction,
   humanHours,
   mergedPerDay,
   mergeTimeBySize,
   reciprocity,
   repoBreakdown,
   reviewDebt,
   signoffLeaders,
   stampsPerDay,
} from './stats';

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

// a midday anchor so hour arithmetic never crosses a local midnight by accident
const NOON = new Date(2026, 6, 18, 12, 0, 0).getTime();
const HOUR = 3_600_000;

function sigAt(login: string, t: number) {
   return { data: { user: { login }, created_at: new Date(t).toISOString() } };
}

/** a DerivedPull with every field the newer reductions read. */
function full(over: {
   status?: Status;
   author?: string;
   repo?: string;
   n?: number;
   ageDays?: number;
   weight?: Weight;
   additions?: number | null;
   deletions?: number | null;
   crHave?: number;
   qaHave?: number;
   crReq?: number;
   qaReq?: number;
   recrBy?: string[];
   reqaBy?: string[];
   qaing?: string | null;
   conflict?: boolean;
   deployBlockedBy?: string[];
   devBlockedBy?: string[];
   dependent?: boolean;
   externalBlock?: boolean;
   allCR?: { data: { user: { login: string }; created_at?: string } }[];
   allQA?: { data: { user: { login: string }; created_at?: string } }[];
}): DerivedPull {
   return {
      status: over.status ?? 'needs_cr',
      ageDays: over.ageDays ?? 0,
      weight: over.weight ?? 'M',
      crHave: over.crHave ?? 0,
      qaHave: over.qaHave ?? 0,
      recrBy: over.recrBy ?? [],
      reqaBy: over.reqaBy ?? [],
      qaingLogin: over.qaing ?? null,
      conflict: over.conflict ?? false,
      deployBlockedBy: over.deployBlockedBy ?? [],
      devBlockedBy: over.devBlockedBy ?? [],
      dependent: over.dependent ?? false,
      externalBlock: over.externalBlock ?? false,
      data: {
         repo: over.repo ?? 'iFixit/ifixit',
         number: over.n ?? 1,
         additions: over.additions === undefined ? 100 : over.additions,
         deletions: over.deletions === undefined ? 20 : over.deletions,
         user: { login: over.author ?? 'alice' },
         status: {
            cr_req: over.crReq ?? 2,
            qa_req: over.qaReq ?? 1,
            allCR: over.allCR ?? [],
            allQA: over.allQA ?? [],
         },
      },
   } as unknown as DerivedPull;
}

describe('mergedPerDay', () => {
   it('buckets merges into local days, keeping empty days, oldest first', () => {
      const closed = [
         { merged_at: new Date(NOON - HOUR).toISOString() }, // today
         { merged_at: new Date(NOON - 25 * HOUR).toISOString() }, // yesterday
         { merged_at: new Date(NOON - 25 * HOUR).toISOString() }, // yesterday
         { merged_at: null }, // closed unmerged, ignored
         { merged_at: new Date(NOON - 40 * 24 * HOUR).toISOString() }, // out of window
      ] as unknown as PullData[];
      const days = mergedPerDay(closed, 7, NOON);
      expect(days).toHaveLength(7);
      expect(days[6].count).toBe(1); // today is last
      expect(days[5].count).toBe(2);
      expect(days.reduce((a, d) => a + d.count, 0)).toBe(3);
   });
});

describe('stampsPerDay', () => {
   it('counts every CR and QA stamp across open and closed, per day', () => {
      const pulls = [
         full({
            allCR: [sigAt('bob', NOON - HOUR), sigAt('bob', NOON - 26 * HOUR)],
            allQA: [sigAt('dave', NOON - 2 * HOUR)],
         }),
      ];
      const closed = [
         { status: { allCR: [sigAt('carol', NOON - 3 * HOUR)], allQA: [] } },
      ] as unknown as PullData[];
      const days = stampsPerDay(pulls, closed, 3, NOON);
      expect(days[2].count).toBe(3); // today: bob, dave, carol
      expect(days[1].count).toBe(1); // yesterday: bob's earlier stamp
   });
});

describe('ageMix', () => {
   it('buckets open pulls by age with inclusive upper edges', () => {
      const mix = ageMix([
         full({ ageDays: 0 }),
         full({ ageDays: 2 }),
         full({ ageDays: 3 }),
         full({ ageDays: 13 }),
         full({ ageDays: 30 }),
      ]);
      expect(mix.map(b => b.count)).toEqual([1, 1, 1, 1, 1]);
      expect(mix[0].label).toBe('today');
      expect(mix[4].label).toBe('14d+');
   });
});

describe('effortMix', () => {
   it('counts open pulls per weight, keeping zero classes, tracking estimates', () => {
      const mix = effortMix([
         full({ weight: 'XS' }),
         full({ weight: 'XS', additions: null, deletions: null }),
         full({ weight: 'XL' }),
      ]);
      expect(mix.buckets.map(b => b.count)).toEqual([2, 0, 0, 0, 1]);
      expect(mix.estimated).toBe(1);
   });
});

describe('reviewDebt', () => {
   it('sums missing stamps, restamps owed, and unclaimed QA', () => {
      const debt = reviewDebt([
         full({ status: 'needs_cr', crReq: 2, crHave: 0 }), // 2 CR slots
         full({ status: 'needs_recr', crReq: 2, crHave: 1, recrBy: ['bob'] }), // 1 slot + 1 restamp
         full({ status: 'needs_qa', qaReq: 1, qaHave: 0 }), // 1 QA slot, unclaimed
         full({ status: 'needs_qa', qaReq: 1, qaHave: 0, qaing: 'dave' }), // claimed
         full({ status: 'needs_qa', qaReq: 1, qaHave: 0, reqaBy: ['eve'] }), // re-QA owed
         full({ status: 'ready' }), // no debt
      ]);
      expect(debt).toEqual({ crSlots: 3, qaSlots: 3, restamps: 2, unclaimedQa: 1 });
   });
});

describe('firstCrLatency', () => {
   it('measures created→first CR on merged pulls only', () => {
      const closed = [
         {
            merged_at: new Date(NOON).toISOString(),
            created_at: new Date(NOON - 10 * HOUR).toISOString(),
            status: {
               allCR: [sigAt('bob', NOON - 6 * HOUR), sigAt('carol', NOON - 2 * HOUR)],
               allQA: [],
            },
         }, // first CR after 4h
         {
            merged_at: new Date(NOON).toISOString(),
            created_at: new Date(NOON - 10 * HOUR).toISOString(),
            status: { allCR: [sigAt('bob', NOON - 4 * HOUR)], allQA: [] },
         }, // 6h
         {
            merged_at: null,
            created_at: new Date(NOON - 10 * HOUR).toISOString(),
            status: { allCR: [sigAt('bob', NOON)], allQA: [] },
         }, // unmerged, ignored
      ] as unknown as PullData[];
      const lat = firstCrLatency(closed);
      expect(lat.sampled).toBe(2);
      expect(lat.medianHours).toBe(5);
      expect(lat.avgHours).toBe(5);
   });
});

describe('reciprocity', () => {
   it('pairs distinct PRs reviewed against stamps received, ignoring self-stamps', () => {
      const pulls = [
         full({ author: 'alice', n: 1, allCR: [sigAt('bob', NOON), sigAt('alice', NOON)] }),
         full({
            author: 'alice',
            n: 2,
            allCR: [sigAt('bob', NOON)],
            allQA: [sigAt('carol', NOON)],
         }),
      ];
      const rows = reciprocity(pulls, []);
      expect(rows.find(r => r.login === 'bob')).toMatchObject({ given: 2, received: 0 });
      expect(rows.find(r => r.login === 'carol')).toMatchObject({ given: 1, received: 0 });
      // alice's self-stamp doesn't count anywhere; she received bob×2 + carol×1
      expect(rows.find(r => r.login === 'alice')).toMatchObject({ given: 0, received: 3 });
   });
});

describe('authorLoad', () => {
   it('counts open PRs per author with their oldest and awaiting-CR share', () => {
      const rows = authorLoad([
         full({ author: 'alice', n: 1, ageDays: 3, status: 'needs_cr' }),
         full({ author: 'alice', n: 2, ageDays: 9, status: 'ready' }),
         full({ author: 'bob', n: 3, ageDays: 1, status: 'needs_recr' }),
      ]);
      expect(rows[0]).toEqual({ login: 'alice', count: 2, awaitingCr: 1, oldestDays: 9 });
      expect(rows[1]).toEqual({ login: 'bob', count: 1, awaitingCr: 1, oldestDays: 1 });
   });
});

describe('repoBreakdown', () => {
   it('splits each repo pile into total, awaiting-CR, and oldest', () => {
      const rows = repoBreakdown([
         full({ repo: 'iFixit/a', status: 'needs_cr', ageDays: 5 }),
         full({ repo: 'iFixit/a', status: 'ready', ageDays: 2 }),
         full({ repo: 'iFixit/b', status: 'needs_recr', ageDays: 1 }),
      ]);
      expect(rows[0]).toEqual({ repo: 'iFixit/a', count: 2, awaitingCr: 1, oldestDays: 5 });
      expect(rows[1]).toEqual({ repo: 'iFixit/b', count: 1, awaitingCr: 1, oldestDays: 1 });
   });
});

describe('friction', () => {
   it('counts each stuck condition independently', () => {
      const f = friction([
         full({ conflict: true, dependent: true }),
         full({ status: 'dev_block' }),
         full({ devBlockedBy: ['bob'] }),
         full({ status: 'ci_red' }),
         full({ status: 'draft' }),
         full({ deployBlockedBy: ['carol'], externalBlock: true }),
      ]);
      expect(f).toEqual({
         conflicts: 1,
         deployBlocked: 1,
         devBlocked: 2,
         ciRed: 1,
         drafts: 1,
         stacked: 1,
         external: 1,
      });
   });
});
