import { describe, expect, it } from 'vitest';
import {
   columnsFor,
   commitEnds,
   parseZoom,
   quarterOf,
   shiftZoom,
   zoomAround,
   zoomKey,
   type Zoom,
} from './roadmapTime';

const z = (key: string) => parseZoom(key) as Zoom;

describe('zoom keys', () => {
   it('read and write quarters and months, and refuse anything else', () => {
      expect(parseZoom('2026-Q4')).toEqual({ kind: 'quarter', year: 2026, index: 3 });
      expect(parseZoom('2026-10')).toEqual({ kind: 'month', year: 2026, index: 9 });
      expect(zoomKey(z('2026-10'))).toBe('2026-10');
      for (const bad of ['2026-Q5', '2026-13', '2026-1', 'Q4', '', null]) {
         expect(parseZoom(bad)).toBeNull();
      }
   });

   it('find the period a day falls in', () => {
      expect(zoomKey(zoomAround('quarter', new Date(2026, 8, 30)))).toBe('2026-Q3');
      expect(zoomKey(zoomAround('month', new Date(2026, 8, 30)))).toBe('2026-09');
   });

   it('step across year ends both ways, and find a month’s quarter', () => {
      expect(zoomKey(shiftZoom(z('2026-Q4'), 1))).toBe('2027-Q1');
      expect(zoomKey(shiftZoom(z('2026-01'), -1))).toBe('2025-12');
      expect(zoomKey(quarterOf(z('2026-11')))).toBe('2026-Q4');
   });
});

describe('columnsFor', () => {
   const now = new Date(2026, 8, 30);

   it('spreads a zoomed quarter over its three months, each one a zoom further in', () => {
      const cols = columnsFor('quarter', parseZoom('2026-Q4'), now);
      expect(cols.map(c => [c.start, c.end, c.zoom])).toEqual([
         ['2026-10-01', '2026-11-01', '2026-10'],
         ['2026-11-01', '2026-12-01', '2026-11'],
         ['2026-12-01', '2027-01-01', '2026-12'],
      ]);
   });

   it('cuts a zoomed month into its weeks at the month’s edges', () => {
      // October 2026 starts on a Thursday and ends on a Saturday
      const cols = columnsFor('quarter', parseZoom('2026-10'), now);
      expect(cols.map(c => [c.start, c.end])).toEqual([
         ['2026-10-01', '2026-10-05'],
         ['2026-10-05', '2026-10-12'],
         ['2026-10-12', '2026-10-19'],
         ['2026-10-19', '2026-10-26'],
         ['2026-10-26', '2026-11-01'],
      ]);
      expect(cols.every(c => c.zoom === null)).toBe(true);
   });

   it('starts the wide views a period back, each column a zoom in', () => {
      const quarters = columnsFor('quarter', null, now);
      expect(quarters[0]).toMatchObject({ start: '2026-04-01', zoom: '2026-Q2' });
      expect(quarters).toHaveLength(6);
      const months = columnsFor('month', null, now);
      expect(months[0]).toMatchObject({ start: '2026-08-01', zoom: '2026-08' });
      expect(months).toHaveLength(7);
   });
});

describe('commitEnds', () => {
   it('skips a period ending within a week, and crosses the year', () => {
      expect(commitEnds('2026-09-29').map(c => [c.label, c.end])).toEqual([
         ['End of Oct', '2026-10-31'],
         ['End of Nov', '2026-11-30'],
         ['End of Q4', '2026-12-31'],
         ['End of Q1 2027', '2027-03-31'],
      ]);
      // a month next year says its year too
      expect(commitEnds('2026-12-01').map(c => c.label)).toEqual([
         'End of Q4',
         'End of Jan 2027',
         'End of Q1 2027',
      ]);
      // mid-month, the month and quarter at hand still count, and December
      // goes by its quarter's name
      expect(commitEnds('2026-11-10').map(c => [c.label, c.end])).toEqual([
         ['End of Nov', '2026-11-30'],
         ['End of Q4', '2026-12-31'],
         ['End of Q1 2027', '2027-03-31'],
      ]);
   });
});
