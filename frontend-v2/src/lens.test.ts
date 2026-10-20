import { describe, expect, it } from 'vitest';
import {
   DEFAULT_GROUP,
   GROUP_KEYS,
   groupParam,
   viewChanged,
   weekParam,
   windowParam,
   ZOOM_KEY,
} from './lens';
import { GROUPINGS } from './model/portfolio';

describe('viewChanged', () => {
   const none = null as string | null;
   const view = { lens: 'projects', project: none, initiative: none, within: none, week: none };

   it('counts opening an initiative’s page, or Decide narrowed to one, as a new view', () => {
      expect(viewChanged(view, { ...view, initiative: 'release-safety' })).toBe(true);
      expect(viewChanged(view, { ...view, within: 'release-safety' })).toBe(true);
   });

   it('counts nothing changed as the same view', () => {
      expect(viewChanged(view, { ...view })).toBe(false);
   });
});

describe('the URL’s keys', () => {
   it('take a grouping the switch offers, else the default', () => {
      expect(groupParam('team')).toBe('team');
      expect(groupParam('parent')).toBe(DEFAULT_GROUP);
      expect(groupParam(null)).toBe(DEFAULT_GROUP);
      expect(GROUPINGS.map(([k]) => k)).toEqual(GROUP_KEYS);
   });

   it('take a week only on a real Monday', () => {
      expect(weekParam('2026-10-12')).toBe('2026-10-12');
      expect(weekParam('2026-10-14')).toBeNull(); // a Wednesday
      expect(weekParam('2026-02-30')).toBeNull();
      expect(weekParam('2026-13-45')).toBeNull();
   });

   it('take years 1970 to 2999 in a window and a zoom', () => {
      expect(windowParam('0050-01..0050-06')).toBeNull();
      expect(windowParam('9999-07..9999-12')).toBeNull();
      expect(windowParam('2026-01..2026-06')).toBe('2026-01..2026-06');
      expect(windowParam('2026-Q1..2026-Q2')).toBe('2026-Q1..2026-Q2');
      expect(ZOOM_KEY.test('0050-Q1')).toBe(false);
      expect(ZOOM_KEY.test('2026-Q1')).toBe(true);
   });
});
