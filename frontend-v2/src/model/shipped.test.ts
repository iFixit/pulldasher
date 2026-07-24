import { describe, expect, it } from 'vitest';
import type { PullData } from '../../../shared/types';
import { rankShipped, shipRelevance, shippedToast } from './shipped';

/** A closed PullData carrying only the fields shipped ranking reads. */
function dp(o: {
   number?: number;
   author?: string;
   cr?: string[];
   qa?: string[];
   closedAt?: string;
   /** false = closed without merging; defaults to merged, since these tests
    * are about shipped (i.e. merged) pulls */
   merged?: boolean;
}): PullData {
   const sig = (login: string) => ({ data: { user: { login } } });
   const closedAt = o.closedAt ?? '2026-01-01T00:00:00Z';
   return {
      repo: 'org/repo',
      number: o.number ?? 1,
      title: `pull ${o.number ?? 1}`,
      user: { login: o.author ?? 'author' },
      closed_at: closedAt,
      updated_at: closedAt,
      merged_at: o.merged === false ? null : closedAt,
      status: { allCR: (o.cr ?? []).map(sig), allQA: (o.qa ?? []).map(sig) },
   } as unknown as PullData;
}

describe('shipRelevance', () => {
   it('is yours when you authored it', () => {
      expect(shipRelevance(dp({ author: 'me' }), 'me')).toBe('yours');
   });
   it('is reviewed when you left a CR or QA stamp', () => {
      expect(shipRelevance(dp({ author: 'alice', cr: ['me'] }), 'me')).toBe('reviewed');
      expect(shipRelevance(dp({ author: 'alice', qa: ['me'] }), 'me')).toBe('reviewed');
   });
   it('is null when you neither authored nor reviewed it', () => {
      expect(shipRelevance(dp({ author: 'alice', cr: ['bob'] }), 'me')).toBeNull();
   });
   it('is null for a PR closed without merging, even one you authored', () => {
      // the reported bug: closing your own PR fired "shipped — your PR landed"
      expect(shipRelevance(dp({ author: 'me', merged: false }), 'me')).toBeNull();
      // and one you reviewed but that was closed unmerged never landed either
      expect(shipRelevance(dp({ author: 'alice', qa: ['me'], merged: false }), 'me')).toBeNull();
   });
   it('prefers yours over reviewed (you can not review your own PR, but be safe)', () => {
      expect(shipRelevance(dp({ author: 'me', cr: ['me'] }), 'me')).toBe('yours');
   });
});

describe('rankShipped', () => {
   it('orders yours, then reviewed, then the rest', () => {
      const other = dp({ number: 1, author: 'alice' });
      const mine = dp({ number: 2, author: 'me' });
      const reviewed = dp({ number: 3, author: 'bob', qa: ['me'] });
      expect(rankShipped([other, mine, reviewed], 'me').map(p => p.number)).toEqual([2, 3, 1]);
   });

   it('sorts newest-closed first within a tier', () => {
      const older = dp({ number: 1, author: 'a', closedAt: '2026-01-01T00:00:00Z' });
      const newer = dp({ number: 2, author: 'b', closedAt: '2026-02-01T00:00:00Z' });
      expect(rankShipped([older, newer], 'me').map(p => p.number)).toEqual([2, 1]);
   });

   it('does not mutate the input array', () => {
      const list = [dp({ number: 1, author: 'me' }), dp({ number: 2, author: 'a' })];
      const before = list.map(p => p.number);
      rankShipped(list, 'me');
      expect(list.map(p => p.number)).toEqual(before);
   });
});

describe('shippedToast', () => {
   it('returns null when nothing shipped is relevant', () => {
      const other = dp({ number: 1, author: 'alice', cr: ['bob'] });
      expect(shippedToast([other], 'me')).toBeNull();
   });

   it('ignores your own unmerged close and counts only merged pulls', () => {
      const closedUnmerged = dp({ number: 1, author: 'me', merged: false });
      expect(shippedToast([closedUnmerged], 'me')).toBeNull();
      // a mixed batch counts only the merged one
      const merged = dp({ number: 2, author: 'me' });
      const toast = shippedToast([closedUnmerged, merged], 'me');
      expect(toast?.title).toBe('Shipped while you were away');
      expect(toast?.pull?.number).toBe(2);
   });

   it('tags the toast with its kind so Settings can mute it', () => {
      const toast = shippedToast([dp({ number: 1, author: 'me' })], 'me');
      expect(toast?.kind).toBe('shipped');
   });

   it('names the pull and yours/reviewed for a single relevant pull', () => {
      const mine = dp({ number: 42, author: 'me' });
      const toast = shippedToast([mine], 'me');
      expect(toast?.tone).toBe('info');
      expect(toast?.title.toLowerCase()).toContain('shipped');
      expect(toast?.pull?.number).toBe(42);
      expect(toast?.body).toContain('Your PR landed');

      const reviewed = dp({ number: 7, author: 'alice', qa: ['me'] });
      const reviewedToast = shippedToast([reviewed], 'me');
      expect(reviewedToast?.body).toMatch(/reviewed/i);
   });

   it('summarizes counts for multiple relevant pulls', () => {
      const mine = dp({ number: 1, author: 'me' });
      const reviewedA = dp({ number: 2, author: 'alice', cr: ['me'] });
      const reviewedB = dp({ number: 3, author: 'bob', qa: ['me'] });
      const irrelevant = dp({ number: 4, author: 'carol', cr: ['dave'] });
      const toast = shippedToast([mine, reviewedA, reviewedB, irrelevant], 'me');
      expect(toast?.title).toBe('3 shipped while you were away');
      expect(toast?.body).toContain('1 yours');
      expect(toast?.body).toContain('2 you reviewed');
   });

   it('re-fires on a newer merge but is stable for the same backlog', () => {
      const a = dp({ number: 1, author: 'me', closedAt: '2026-01-01T00:00:00Z' });
      const b = dp({ number: 2, author: 'me', closedAt: '2026-01-02T00:00:00Z' });

      const key1 = shippedToast([a], 'me')?.dedupeKey;
      const key1Again = shippedToast([a], 'me')?.dedupeKey;
      expect(key1).toBe(key1Again);

      const key2 = shippedToast([a, b], 'me')?.dedupeKey;
      expect(key2).not.toBe(key1);
   });
});
