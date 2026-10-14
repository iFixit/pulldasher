import { describe, expect, it } from 'vitest';
import { WINDOW_KEY } from '../lens';
import {
   columnsFor,
   commitEnds,
   defaultWindow,
   doneBefore,
   drawnWindow,
   parseZoom,
   resolveWindow,
   shiftWindow,
   windowHolding,
   windowKey,
   windowOfDays,
   windowUnit,
   windowWords,
   WINDOW_PRESETS,
   type Months,
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
      expect(quarters).toHaveLength(4);
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
      expect(commitEnds('2026-11-10')[1].through).toBe('the end of Q4');
   });

   it('puts a target still ahead first, however near, and never one already passed', () => {
      expect(commitEnds('2026-10-01', '2026-10-21').map(c => [c.label, c.through])).toEqual([
         ['Its target date, Oct 21', 'its target date, Oct 21'],
         ['End of Oct', 'the end of Oct'],
         ['End of Nov', 'the end of Nov'],
         ['End of Q4', 'the end of Q4'],
         ['End of Q1 2027', 'the end of Q1 2027'],
      ]);
      // due today still counts; a month ending the same day gives way to it
      expect(commitEnds('2026-10-31', '2026-10-31')[0]).toMatchObject({ target: true });
      expect(commitEnds('2026-10-01', '2026-10-31').map(c => c.end)).toEqual([
         '2026-10-31',
         '2026-11-30',
         '2026-12-31',
         '2027-03-31',
      ]);
      expect(commitEnds('2026-10-01', '2026-09-26').some(c => c.target)).toBe(false);
      // a target next year says its year, as the ends do
      expect(commitEnds('2026-12-01', '2027-01-15')[0].label).toBe('Its target date, Jan 15 2027');
   });
});

describe('the roadmap window', () => {
   // Oct 13, 2026
   const now = new Date(2026, 9, 13);
   const key = (k: string) => windowKey(resolveWindow(k, now) as Months);

   it('resolves every preset as of today, year to date through this month', () => {
      expect(WINDOW_PRESETS.map(([k]) => [k, key(k)])).toEqual([
         ['quarter', '2026-10..2026-12'],
         ['2q', '2026-10..2027-03'],
         ['6m', '2026-10..2027-03'],
         ['ytd', '2026-01..2026-10'],
         ['12m', '2025-11..2026-10'],
         ['year', '2026-01..2026-12'],
      ]);
      // in February, year to date is two months
      expect(windowKey(resolveWindow('ytd', new Date(2027, 1, 3)) as Months)).toBe(
         '2027-01..2027-02'
      );
   });

   it('reads its own keys back, future ones too, and refuses anything else', () => {
      for (const k of ['2025-10..2026-09', '2027-01..2027-01', '2026-11..2028-04']) {
         expect(key(k)).toBe(k);
      }
      // what the URL accepts (lens.ts) is what the picker writes
      for (const [k] of WINDOW_PRESETS) expect(WINDOW_KEY.test(k)).toBe(true);
      expect(WINDOW_KEY.test(key('ytd'))).toBe(true);
      for (const bad of ['2026-10..2026-09', '2026-13..2027-01', '2026-10', 'all', '', null]) {
         expect(resolveWindow(bad, now)).toBeNull();
      }
   });

   it('leaves the default exactly as it was with no window picked', () => {
      for (const scale of ['quarter', 'month'] as const) {
         expect(columnsFor(scale, null, now, null)).toEqual(columnsFor(scale, null, now));
         expect(drawnWindow(scale, null, now)).toEqual({
            months: defaultWindow(scale, now),
            unit: scale,
         });
      }
      expect(windowKey(defaultWindow('quarter', now))).toBe('2026-07..2027-06');
      expect(windowKey(defaultWindow('month', now))).toBe('2026-09..2027-03');
   });

   it('draws months up to four, or a year not on quarters; quarters past that', () => {
      const unit = (k: string) => windowUnit(resolveWindow(k, now) as Months);
      expect(unit('quarter')).toBe('month');
      expect(unit('ytd')).toBe('month');
      expect(unit('12m')).toBe('month');
      expect(unit('2q')).toBe('quarter');
      expect(unit('year')).toBe('quarter');
      expect(unit('2025-11..2026-02')).toBe('month');
      // longer than a year, off the quarters: out to whole quarters
      const long = drawnWindow('quarter', resolveWindow('2025-11..2027-01', now), now);
      expect([windowKey(long.months), long.unit]).toEqual(['2025-10..2027-03', 'quarter']);
   });

   it('draws a picked window as its columns', () => {
      const ytd = columnsFor('quarter', null, now, resolveWindow('ytd', now));
      expect(ytd.map(c => c.zoom)).toEqual([
         '2026-01',
         '2026-02',
         '2026-03',
         '2026-04',
         '2026-05',
         '2026-06',
         '2026-07',
         '2026-08',
         '2026-09',
         '2026-10',
      ]);
      expect(ytd.at(-1)?.end).toBe('2026-11-01');
      const back = columnsFor('quarter', null, now, resolveWindow('2025-10..2026-09', now));
      expect(back.map(c => c.label)).toEqual(['Q4 2025', 'Q1 2026', 'Q2 2026', 'Q3 2026']);
      // a picked window still yields to a zoom
      expect(columnsFor('quarter', parseZoom('2026-Q4'), now, resolveWindow('ytd', now))).toEqual(
         columnsFor('quarter', parseZoom('2026-Q4'), now)
      );
   });

   it('steps by its own length', () => {
      const ytd = resolveWindow('ytd', now) as Months;
      expect(windowKey(shiftWindow(ytd, -1))).toBe('2025-03..2025-12');
      expect(windowKey(shiftWindow(defaultWindow('quarter', now), -1))).toBe('2025-07..2026-06');
      expect(windowKey(shiftWindow(defaultWindow('month', now), 1))).toBe('2027-04..2027-10');
   });

   it('moves to hold a day: the edge chip and zooming out', () => {
      const w = defaultWindow('quarter', now);
      expect(windowHolding(w, '2026-08-03', 'quarter')).toBe(w);
      expect(windowKey(windowHolding(w, '2025-11-17', 'quarter'))).toBe('2025-10..2026-09');
      expect(windowKey(windowHolding(w, '2027-09-06', 'month'))).toBe('2027-09..2028-08');
   });

   it('takes the months of the days picked on a calendar', () => {
      expect(windowKey(windowOfDays('2027-02-14', '2027-05-02'))).toBe('2027-02..2027-05');
   });

   it('says what it covers in its columns’ unit', () => {
      const words = (k: string) => {
         const d = drawnWindow('quarter', resolveWindow(k, now), now);
         return windowWords(d.months, d.unit);
      };
      expect(words('ytd')).toBe('Jan to Oct 2026');
      expect(words('2025-10..2026-09')).toBe('Q4 2025 to Q3 2026');
      expect(words('2026-12..2027-01')).toBe('Dec 2026 to Jan 2027');
      expect(words('2027-03..2027-03')).toBe('Mar 2027');
      expect(windowWords(defaultWindow('quarter', now), 'quarter')).toBe('Q3 2026 to Q2 2027');
   });
});

describe('doneBefore', () => {
   const plan = (status: 'done' | 'active', start: string, weeks: number, ongoing = false) => ({
      status,
      start,
      weeks,
      end_kind: ongoing ? ('ongoing' as const) : ('soft' as const),
   });

   it('folds only done plans whose last day is before the window', () => {
      const old = plan('done', '2025-10-06', 4);
      const into = plan('done', '2026-06-01', 6);
      expect(
         doneBefore(
            [old, into, plan('active', '2025-10-06', 4), plan('done', '2025-10-06', 4, true)],
            '2026-07-01'
         )
      ).toEqual([old]);
   });
});
