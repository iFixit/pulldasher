import { describe, expect, it } from 'vitest';
import type { DerivedPull } from './status';
import { crScore, crSort, teamFirst } from './sort';

function fake(over: {
   ageDays?: number;
   crHave?: number;
   crReq?: number;
   additions?: number | null;
   weight?: DerivedPull['weight'];
   sizeKnown?: boolean;
}): DerivedPull {
   const additions = over.additions === undefined ? 100 : over.additions;
   return {
      ageDays: over.ageDays ?? 0,
      crHave: over.crHave ?? 0,
      weight: over.weight ?? 'S',
      sizeKnown: over.sizeKnown ?? true,
      data: {
         additions,
         deletions: 0,
         // ancient updated_at so nothing counts as iterating
         updated_at: new Date(0).toISOString(),
         status: { cr_req: over.crReq ?? 1, commit_statuses: [] },
      },
   } as unknown as DerivedPull;
}

describe('crScore / crSort', () => {
   it('a pull one stamp from done outranks an equal-weight untouched one', () => {
      const oneFromDone = fake({ crHave: 1, crReq: 2 });
      const untouched = fake({ crHave: 0, crReq: 2 });
      expect(crScore(oneFromDone)).toBeLessThan(crScore(untouched));
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
