import { describe, expect, it } from 'vitest';
import type { PullData } from '../../../shared/types';
import type { DerivedPull, Status, Weight } from '../../../shared/model/status';
import {
   ageMix,
   authorLoad,
   effortMix,
   friction,
   humanHours,
   mergedPerDay,
   mergeTimeBySize,
   reciprocity,
   repoBreakdown,
   requestAnswerTimes,
   selfReviewMix,
   signoffLeaders,
   stampsPerDay,
   waitingOnSomeone,
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
   ownReview?: boolean;
   authorIsDeveloper?: boolean;
   title?: string;
   body?: string;
   requested?: string[];
   draft?: boolean;
   requests?: { login: string; at: number | null; self: boolean }[];
   reviews?: { login: string; date: number }[];
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
      ownReview: over.ownReview ?? true,
      authorIsDeveloper:
         over.authorIsDeveloper ?? ((over.ownReview ?? true) || !!over.requested?.length),
      askedOf: (over.requests ?? []).filter(r => !r.self).map(r => r.login),
      askedAt: null,
      conflict: over.conflict ?? false,
      deployBlockedBy: over.deployBlockedBy ?? [],
      devBlockedBy: over.devBlockedBy ?? [],
      dependent: over.dependent ?? false,
      externalBlock: over.externalBlock ?? false,
      data: {
         repo: over.repo ?? 'iFixit/ifixit',
         number: over.n ?? 1,
         title: over.title ?? 't',
         body: over.body ?? '',
         draft: over.draft ?? false,
         requested_reviewers: over.requested ?? [],
         review_requests: over.requests ?? [],
         additions: over.additions === undefined ? 100 : over.additions,
         deletions: over.deletions === undefined ? 20 : over.deletions,
         user: { login: over.author ?? 'alice' },
         status: {
            cr_req: over.crReq ?? 2,
            qa_req: over.qaReq ?? 1,
            allCR: over.allCR ?? [],
            allQA: over.allQA ?? [],
            unstamped_reviewers: over.reviews ?? [],
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
         {
            user: { login: 'zed' },
            status: { allCR: [sigAt('carol', NOON - 3 * HOUR)], allQA: [] },
         },
      ] as unknown as PullData[];
      const days = stampsPerDay(pulls, closed, 3, NOON);
      expect(days[2].count).toBe(3); // today: bob, dave, carol
      expect(days[1].count).toBe(1); // yesterday: bob's earlier stamp
   });

   it("skips the author's own stamps, which are normal under self-review", () => {
      const pulls = [full({ author: 'alice', allCR: [sigAt('alice', NOON), sigAt('bob', NOON)] })];
      expect(stampsPerDay(pulls, [], 1, NOON)[0].count).toBe(1);
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

const AT = NOON / 1000; // request time, epoch secs
const ask = (login: string, hoursAgo: number) => ({ login, at: AT - hoursAgo * 3600, self: false });

describe('requestAnswerTimes', () => {
   it('measures request to the asked person first stamp or review after it', () => {
      const pulls = [
         // bob answers with a stamp 2h after the request, carol with a review 6h after
         full({
            n: 1,
            requests: [ask('bob', 10), ask('carol', 10)],
            allCR: [sigAt('bob', NOON - 8 * HOUR)],
            reviews: [{ login: 'carol', date: AT - 4 * 3600 }],
         }),
         // dave's only stamp predates his request, erin never answered, a claim is no request
         full({
            n: 2,
            requests: [ask('dave', 5), ask('erin', 5), { ...ask('fay', 5), self: true }],
            allCR: [sigAt('dave', NOON - 9 * HOUR), sigAt('fay', NOON - HOUR)],
         }),
      ];
      const t = requestAnswerTimes(pulls, []);
      expect(t.sampled).toBe(2);
      expect(t.medianHours).toBe(4);
      expect(t.p90Hours).toBe(6);
   });

   it('is empty without requests', () => {
      expect(requestAnswerTimes([full({})], [])).toEqual({
         medianHours: 0,
         p90Hours: 0,
         sampled: 0,
      });
   });
});

describe('waitingOnSomeone', () => {
   it('lists unanswered requests by hours and outside pulls by days, never self-review', () => {
      const w = waitingOnSomeone(
         [
            full({ n: 1, requests: [ask('bob', 30), ask('carol', 2)], allCR: [] }),
            full({
               n: 2,
               requests: [ask('dave', 4)],
               allCR: [sigAt('dave', NOON - HOUR)], // answered
            }),
            full({ n: 3, ownReview: false, ageDays: 6, author: 'zed' }), // outside, unasked
            full({ n: 4, ownReview: false, ageDays: 9, requested: ['bob'] }), // asked: not outside
            full({ n: 5, ageDays: 20 }), // own review: nobody owes it
            full({ n: 6, ownReview: false, ageDays: 1, status: 'ready' }), // not short of CR
            full({ n: 7, requests: [ask('erin', 9)], draft: true }), // a draft isn't waiting
            full({ n: 8, requests: [ask('fay', 9)], status: 'needs_qa' }), // CR already met
            // a contractor whose asked reviewer already stamped (GitHub still lists them)
            full({
               n: 9,
               ownReview: false,
               authorIsDeveloper: false,
               requested: ['bob'],
               ageDays: 3,
               author: 'con',
            }),
         ],
         AT
      );
      expect(w.requests.map(r => [r.number, r.login, r.hours])).toEqual([
         [1, 'bob', 30],
         [1, 'carol', 2],
      ]);
      expect(w.outside).toEqual([
         { repo: 'iFixit/ifixit', number: 3, title: 't', author: 'zed', days: 6 },
         { repo: 'iFixit/ifixit', number: 9, title: 't', author: 'con', days: 3 },
      ]);
   });

   it("dates a team member's wait from their team's request, not the pull's oldest", () => {
      // bob was asked by name 72h ago; gil only through a team, 1h ago
      const pull = {
         ...full({ n: 1, requests: [ask('bob', 72)], allCR: [] }),
         askedOf: ['bob', 'gil'],
         askedAt: ask('bob', 72).at,
         askedAtBy: { bob: ask('bob', 72).at, gil: ask('gil', 1).at },
      };
      const w = waitingOnSomeone([pull], AT);
      expect(w.requests.map(r => [r.login, r.hours])).toEqual([
         ['bob', 72],
         ['gil', 1],
      ]);
   });
});

function mergedPull(over: {
   n: number;
   author?: string;
   title?: string;
   body?: string;
   at?: number;
   cr?: string[];
   reviewers?: string[];
   teams?: string[];
   claimedBy?: string;
}): PullData {
   return {
      repo: 'iFixit/ifixit',
      number: over.n,
      title: over.title ?? 'Add a thing',
      body: over.body ?? '',
      merged_at: new Date(over.at ?? NOON).toISOString(),
      user: { login: over.author ?? 'alice' },
      requested_teams: over.teams ?? [],
      requested_reviewers: [...(over.reviewers ?? []), ...(over.claimedBy ? [over.claimedBy] : [])],
      review_requests: over.claimedBy ? [{ login: over.claimedBy, at: 1, self: true }] : [],
      status: { allCR: (over.cr ?? []).map(l => sigAt(l, NOON)), allQA: [] },
   } as unknown as PullData;
}

describe('selfReviewMix', () => {
   it('sorts merged pulls into asked, reviewed by others, self-reviewed, and unstamped', () => {
      const mix = selfReviewMix([
         mergedPull({ n: 1, reviewers: ['bob'], cr: ['alice'] }), // asked wins
         mergedPull({ n: 2, teams: ['store'] }),
         mergedPull({ n: 3, cr: ['bob'] }),
         mergedPull({ n: 4, cr: ['alice'] }),
         mergedPull({ n: 5, cr: ['alice'] }),
         mergedPull({ n: 6 }),
         { ...mergedPull({ n: 7 }), merged_at: null } as unknown as PullData, // closed unmerged
      ]);
      expect(mix).toMatchObject({ merged: 6, asked: 2, byOthers: 1, self: 2, unstamped: 1 });
   });

   it('leaves bot reviews out of "reviewed by someone else"', () => {
      const bot = { ...mergedPull({ n: 1 }) } as PullData;
      bot.status = {
         allCR: [],
         allQA: [],
         unstamped_reviewers: [{ login: 'review-bot' }, { login: 'ci[bot]' }],
      } as unknown as PullData['status'];
      expect(selfReviewMix([bot], new Set(['review-bot']))).toMatchObject({
         byOthers: 0,
         unstamped: 1,
      });
      // with no bot list, only the [bot] suffix is known
      expect(selfReviewMix([bot])).toMatchObject({ byOthers: 1 });
   });

   it('a claim is someone volunteering, not the author asking', () => {
      const mix = selfReviewMix([
         mergedPull({ n: 1, claimedBy: 'bob', cr: ['bob'] }), // bob volunteered
         mergedPull({ n: 2, claimedBy: 'bob', reviewers: ['carol'] }), // carol was asked
      ]);
      expect(mix).toMatchObject({ asked: 1, byOthers: 1 });
   });

   it('flags reverts and fix-ups of a self-reviewed pull within a week', () => {
      const mix = selfReviewMix([
         mergedPull({ n: 10, cr: ['alice'], at: NOON - 2 * 86_400_000 }), // self-reviewed
         mergedPull({ n: 11, title: 'Revert "Add a thing"', body: 'Reverts #10', at: NOON }),
         mergedPull({ n: 12, body: 'Fixes #10', at: NOON }),
         mergedPull({ n: 13, body: 'Fixes #99', at: NOON }), // not on the board
         mergedPull({ n: 14, title: 'Revert the thing', at: NOON }), // revert, no known source
         mergedPull({ n: 15, cr: ['alice'], at: NOON - 20 * 86_400_000 }),
         mergedPull({ n: 16, body: 'Fixes #15', at: NOON }), // 20 days later: not close
      ]);
      expect(mix.risk).toEqual({ reverts: 2, afterSelfReview: 2 });
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
   it('splits pulls short of CR into self-review and waiting on others', () => {
      const rows = authorLoad([
         full({ author: 'alice', n: 1, ageDays: 3, status: 'needs_cr' }), // own review
         full({ author: 'alice', n: 2, ageDays: 9, status: 'ready' }),
         full({ author: 'bob', n: 3, ageDays: 1, status: 'needs_recr', ownReview: false }),
      ]);
      expect(rows[0]).toEqual({
         login: 'alice',
         count: 2,
         inSelfReview: 1,
         waitingOnOthers: 0,
         oldestDays: 9,
      });
      expect(rows[1]).toEqual({
         login: 'bob',
         count: 1,
         inSelfReview: 0,
         waitingOnOthers: 1,
         oldestDays: 1,
      });
   });
});

describe('repoBreakdown', () => {
   it('splits each repo pile into total, self-review, waiting on others, and oldest', () => {
      const rows = repoBreakdown([
         full({ repo: 'iFixit/a', status: 'needs_cr', ageDays: 5 }),
         full({ repo: 'iFixit/a', status: 'ready', ageDays: 2 }),
         full({ repo: 'iFixit/b', status: 'needs_recr', ageDays: 1, ownReview: false }),
      ]);
      expect(rows[0]).toEqual({
         repo: 'iFixit/a',
         count: 2,
         inSelfReview: 1,
         waitingOnOthers: 0,
         oldestDays: 5,
      });
      expect(rows[1]).toMatchObject({ repo: 'iFixit/b', inSelfReview: 0, waitingOnOthers: 1 });
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
