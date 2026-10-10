import { describe, expect, it } from 'vitest';
import type { DerivedPull } from '../../../shared/model/status';
import { crScore, crSort, finishersFirst, sinkBy, teamFirst } from './sort';

function fake(over: {
   ageDays?: number;
   /** active CR stamps, by reviewers other than the author unless crBy says */
   crHave?: number;
   crBy?: string[];
   ownReview?: boolean;
   crReq?: number;
   additions?: number | null;
   weight?: DerivedPull['weight'];
   sizeKnown?: boolean;
}): DerivedPull {
   const additions = over.additions === undefined ? 100 : over.additions;
   return {
      ageDays: over.ageDays ?? 0,
      crHave: over.crHave ?? 0,
      crBy: over.crBy ?? Array.from({ length: over.crHave ?? 0 }, (_, i) => `reviewer${i}`),
      ownReview: over.ownReview ?? false,
      authorIsDeveloper: over.ownReview ?? false,
      weight: over.weight ?? 'S',
      sizeKnown: over.sizeKnown ?? true,
      data: {
         additions,
         deletions: 0,
         // ancient updated_at so nothing counts as iterating
         updated_at: new Date(0).toISOString(),
         status: { cr_req: over.crReq ?? 1, commit_statuses: [] },
         user: { login: 'author' },
      },
   } as unknown as DerivedPull;
}

describe('crScore / crSort', () => {
   it('a pull one stamp from done outranks an equal-weight untouched one', () => {
      const oneFromDone = fake({ crHave: 1, crReq: 2 });
      const untouched = fake({ crHave: 0, crReq: 2 });
      expect(crScore(oneFromDone)).toBeLessThan(crScore(untouched));
   });

   it('the author’s own stamp is not a review in: no one-from-done jump', () => {
      const selfStamped = fake({ crHave: 1, crBy: ['author'], crReq: 2 });
      const untouched = fake({ crHave: 0, crReq: 2 });
      expect(crScore(selfStamped)).toBe(crScore(untouched));
   });

   it('a self-reviewed pull earns no age credit: nobody else keeps it waiting', () => {
      const oldOwn = fake({ weight: 'M', ageDays: 10, ownReview: true });
      const freshM = fake({ weight: 'M', ageDays: 0 });
      expect(crScore(oldOwn)).toBe(crScore(freshM));
   });

   it('age earns rank: an old M beats a fresh M and can beat a fresh S', () => {
      const oldM = fake({ weight: 'M', ageDays: 10 });
      const freshM = fake({ weight: 'M', ageDays: 0 });
      const freshS = fake({ weight: 'S', ageDays: 0 });
      expect(crScore(oldM)).toBeLessThan(crScore(freshM));
      expect(crScore(oldM)).toBeLessThan(crScore(freshS));
   });

   it('sorts by score, then oldest first', () => {
      const a = fake({ weight: 'S', ageDays: 10 });
      const b = fake({ weight: 'S', ageDays: 2 });
      const c = fake({ weight: 'XS', ageDays: 10 });
      const sorted = crSort([b, a, c]);
      expect(sorted[0]).toBe(c);
      expect(sorted[1]).toBe(a);
      expect(sorted[2]).toBe(b);
   });

   it("sinks a parked project's pull below a heavier one, never out of the list", () => {
      const parkedXs = fake({ weight: 'XS', ageDays: 10 });
      const freshL = fake({ weight: 'L', ageDays: 0 });
      expect(crSort([parkedXs, freshL], p => p === parkedXs)).toEqual([freshL, parkedXs]);
   });
});

describe('sinkBy', () => {
   it('moves the higher ranks down and keeps each rank in its order', () => {
      const [a, b, c, d] = [1, 2, 3, 4].map(n => fake({ ageDays: n }));
      expect(sinkBy([a, b, c, d], p => Number(p === a || p === c))).toEqual([b, d, a, c]);
   });
});

describe('finishersFirst', () => {
   it('lifts a pull that finishes a plan to the front of its tie, no further', () => {
      const [a, b, c, d] = [1, 2, 3, 4].map(n => fake({ ageDays: n }));
      // a ranks above its own tie; b and c tie, and c would finish a plan
      const tie = (p: DerivedPull) => (p === b || p === c ? 'tie' : String(p.ageDays));
      expect(finishersFirst([a, b, c, d], tie, p => p === c)).toEqual([a, c, b, d]);
      // a finisher alone in its run stays where the ranking put it
      expect(finishersFirst([a, b, c, d], tie, p => p === d)).toEqual([a, b, c, d]);
   });
});

function withAuthor(login: string): DerivedPull {
   return { data: { user: { login } } } as unknown as DerivedPull;
}

describe('teamFirst', () => {
   it('moves team authors to the front', () => {
      const a = withAuthor('alice');
      const b = withAuthor('bob');
      const c = withAuthor('carol');
      const sorted = teamFirst([a, b, c], new Set(['carol']));
      expect(sorted[0]).toBe(c);
      expect(sorted.slice(1)).toEqual([a, b]);
   });

   it('is stable within the team group and within the rest', () => {
      const a1 = withAuthor('alice');
      const a2 = withAuthor('alice');
      const b1 = withAuthor('bob');
      const b2 = withAuthor('bob');
      const sorted = teamFirst([b1, a1, b2, a2], new Set(['alice']));
      // both alice pulls lead, in their original relative order; same for bob
      expect(sorted).toEqual([a1, a2, b1, b2]);
   });

   it('leaves the list untouched when nobody is on the team', () => {
      const a = withAuthor('alice');
      const b = withAuthor('bob');
      expect(teamFirst([a, b], new Set())).toEqual([a, b]);
   });
});
