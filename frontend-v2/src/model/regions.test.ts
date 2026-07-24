import { describe, expect, it } from 'vitest';
import { matchedRegions, matchesRegion, regionFirst } from './regions';
import type { DerivedPull } from '../../../shared/model/status';

/** A pull carrying only the text surfaces regions match against. */
function dp(o: {
   title?: string;
   body?: string;
   repo?: string;
   branch?: string;
   labels?: string[];
   number?: number;
}): DerivedPull {
   return {
      data: {
         repo: o.repo ?? 'org/repo',
         number: o.number ?? 1,
         title: o.title ?? '',
         body: o.body ?? '',
         head: { ref: o.branch ?? 'main' },
         labels: (o.labels ?? []).map(t => ({ title: t })),
      },
   } as unknown as DerivedPull;
}

describe('matchedRegions / matchesRegion', () => {
   it('matches the title, case-insensitively', () => {
      const p = dp({ title: 'Add Growthbook experiment gate' });
      expect(matchedRegions(p, ['growthbook'])).toEqual(['growthbook']);
      expect(matchesRegion(p, ['growthbook'])).toBe(true);
   });

   it('matches the body, branch, repo, and labels', () => {
      expect(matchesRegion(dp({ body: 'touches the Shopify webhook' }), ['Shopify'])).toBe(true);
      expect(matchesRegion(dp({ branch: 'feature/shopify-orders' }), ['shopify'])).toBe(true);
      expect(matchesRegion(dp({ repo: 'iFixit/shopify-app' }), ['shopify'])).toBe(true);
      expect(matchesRegion(dp({ labels: ['area: Diagrams'] }), ['diagrams'])).toBe(true);
   });

   it('returns every matching region, preserving configured order', () => {
      const p = dp({ title: 'Shopify + Growthbook wiring', labels: ['diagrams'] });
      expect(matchedRegions(p, ['Growthbook', 'Diagrams', 'Shopify'])).toEqual([
         'Growthbook',
         'Diagrams',
         'Shopify',
      ]);
   });

   it('does not match when nothing contains the region', () => {
      expect(matchesRegion(dp({ title: 'Unrelated change' }), ['Shopify'])).toBe(false);
      expect(matchedRegions(dp({ title: 'Unrelated' }), ['Shopify'])).toEqual([]);
   });

   it('ignores blank/whitespace regions and an empty config', () => {
      expect(matchesRegion(dp({ title: 'anything' }), [])).toBe(false);
      expect(matchesRegion(dp({ title: 'anything' }), ['   '])).toBe(false);
   });
});

describe('regionFirst', () => {
   it('floats matches to the front, preserving each group order', () => {
      const a = dp({ number: 1, title: 'plain' });
      const b = dp({ number: 2, title: 'Shopify sync' });
      const c = dp({ number: 3, title: 'also plain' });
      const d = dp({ number: 4, labels: ['shopify'] });
      expect(regionFirst([a, b, c, d], ['shopify'])).toEqual([b, d, a, c]);
   });

   it('is a no-op with no regions configured (returns the same array)', () => {
      const list = [dp({ number: 1 }), dp({ number: 2 })];
      expect(regionFirst(list, [])).toBe(list);
   });
});
