import { describe, expect, it } from 'vitest';
import {
   addSavedFilter,
   describeHash,
   removeSavedFilter,
   SAVED_FILTERS_CAP,
   SUGGESTED_FILTERS,
   type SavedFilter,
} from './savedFilters';

// The stateful store (saveFilter/deleteFilter/useSavedFilters) wraps
// createPersistentStore, which touches localStorage. This project's vitest
// runs in the default 'node' environment (no jsdom/happy-dom dependency is
// installed), so localStorage is undefined here — confirmed by a throwaway
// test before writing this file. These tests exercise the pure pieces only:
// the add/remove reducers and describeHash.

describe('describeHash', () => {
   it('describes an empty hash as "everything"', () => {
      expect(describeHash('')).toBe('everything');
   });

   it('ignores unknown params and falls back to "everything"', () => {
      expect(describeHash('foo=bar&utm_source=slack')).toBe('everything');
   });

   it('formats state and weight lists, comma-joined with a space', () => {
      expect(describeHash('weight=xs,s&state=qa')).toBe('state: qa · weight: xs, s');
   });

   it('matches the "Waiting on you" suggested filter', () => {
      expect(describeHash(SUGGESTED_FILTERS[0].hash)).toBe('state: review, qa, restamp, mine');
   });

   it('matches the "Quick wins" suggested filter', () => {
      expect(describeHash(SUGGESTED_FILTERS[1].hash)).toBe('state: review, qa · weight: xs, s');
   });

   it('quotes a search query', () => {
      expect(describeHash('q=flaky+test')).toBe('"flaky test"');
   });

   it('shows repo/author counts and drafts/hidden flags', () => {
      expect(describeHash('repos=ifixit,valkyrie&authors=al&drafts=all&hidden=1')).toBe(
         'repo: ifixit, valkyrie · author: al · drafts: all · showing hidden'
      );
   });

   it("names the lens, using the same labels app.tsx's tabs show", () => {
      expect(describeHash('lens=team')).toBe('Team lens');
      expect(describeHash('lens=mine')).toBe('My work lens');
   });

   it('falls back to the raw value for an unrecognized lens', () => {
      expect(describeHash('lens=board')).toBe('board lens');
   });

   it('combines params in a stable state → weight → query → lens order', () => {
      expect(describeHash('lens=review&state=qa&weight=xs')).toBe(
         'state: qa · weight: xs · Review lens'
      );
   });
});

describe('addSavedFilter', () => {
   it('appends a new named filter', () => {
      const next = addSavedFilter([], 'My saved view', 'state=qa');
      expect(next).toEqual([{ name: 'My saved view', hash: 'state=qa' }]);
   });

   it('trims the name', () => {
      const next = addSavedFilter([], '  spaced  ', 'state=qa');
      expect(next).toEqual([{ name: 'spaced', hash: 'state=qa' }]);
   });

   it('is a no-op for a blank (post-trim) name', () => {
      const items: SavedFilter[] = [{ name: 'a', hash: 'x' }];
      expect(addSavedFilter(items, '   ', 'state=qa')).toBe(items);
   });

   it('replaces an existing entry with the same name instead of duplicating it', () => {
      const items: SavedFilter[] = [
         { name: 'Quick wins', hash: 'weight=xs' },
         { name: 'Other', hash: 'state=qa' },
      ];
      const next = addSavedFilter(items, 'Quick wins', 'weight=xs,s');
      expect(next).toEqual([
         { name: 'Other', hash: 'state=qa' },
         { name: 'Quick wins', hash: 'weight=xs,s' },
      ]);
   });

   it('evicts the oldest entry once a save would exceed the cap', () => {
      const items: SavedFilter[] = Array.from({ length: SAVED_FILTERS_CAP }, (_, i) => ({
         name: `f${i}`,
         hash: `state=${i}`,
      }));
      const next = addSavedFilter(items, 'newest', 'state=new');
      expect(next).toHaveLength(SAVED_FILTERS_CAP);
      // f0 (the oldest) aged out; f1..f7 plus the new one remain, in order
      expect(next.map(f => f.name)).toEqual([...items.slice(1).map(f => f.name), 'newest']);
   });

   it('replacing an existing name never triggers eviction (list size unchanged)', () => {
      const items: SavedFilter[] = Array.from({ length: SAVED_FILTERS_CAP }, (_, i) => ({
         name: `f${i}`,
         hash: `state=${i}`,
      }));
      const next = addSavedFilter(items, 'f3', 'state=updated');
      expect(next).toHaveLength(SAVED_FILTERS_CAP);
      expect(next.find(f => f.name === 'f3')?.hash).toBe('state=updated');
   });
});

describe('removeSavedFilter', () => {
   it('removes a filter by name', () => {
      const items: SavedFilter[] = [
         { name: 'a', hash: 'x' },
         { name: 'b', hash: 'y' },
      ];
      expect(removeSavedFilter(items, 'a')).toEqual([{ name: 'b', hash: 'y' }]);
   });

   it('is a no-op when the name is not present', () => {
      const items: SavedFilter[] = [{ name: 'a', hash: 'x' }];
      expect(removeSavedFilter(items, 'missing')).toEqual(items);
   });
});
