import { describe, expect, it } from 'vitest';
import type { PullData } from '../types';
import { rankShipped, shipRelevance } from './shipped';

/** A closed PullData carrying only the fields shipped ranking reads. */
function dp(o: {
   number?: number;
   author?: string;
   cr?: string[];
   qa?: string[];
   closedAt?: string;
}): PullData {
   const sig = (login: string) => ({ data: { user: { login } } });
   return {
      repo: 'org/repo',
      number: o.number ?? 1,
      title: `pull ${o.number ?? 1}`,
      user: { login: o.author ?? 'author' },
      closed_at: o.closedAt ?? '2026-01-01T00:00:00Z',
      updated_at: o.closedAt ?? '2026-01-01T00:00:00Z',
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
