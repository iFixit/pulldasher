import { describe, expect, it } from 'vitest';
import { MAX_WINDOW_MONTHS, windowParam } from '../lens';
import {
   columnNames,
   columnsFor,
   commitEnds,
   defaultWindow,
   doneBefore,
   drawnWindow,
   inUnit,
   isPreset,
   parseZoom,
   resolveWindow,
   shiftWindow,
   windowHolding,
   windowKey,
   windowOfDays,
   windowWords,
   WINDOW_PRESETS,
   type Picked,
   quarterOf,
   shiftZoom,
   zoomAround,
   zoomKey,
   type Zoom,
   dayAcross,
   historyRange,
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
   const picked = (k: string) => resolveWindow(k, now) as Picked;
   const key = (k: string) => windowKey(picked(k), picked(k).unit);

   it('resolves every preset as of today, each in its own unit', () => {
      expect(WINDOW_PRESETS.map(([k]) => [k, key(k)])).toEqual([
         ['quarter', '2026-10..2026-12'],
         ['2q', '2026-Q4..2027-Q1'],
         ['6m', '2026-10..2027-03'],
         ['ytd', '2026-01..2026-10'],
         ['12m', '2025-11..2026-10'],
         ['year', '2026-Q1..2026-Q4'],
      ]);
      // in February, year to date is two months
      expect(windowKey(resolveWindow('ytd', new Date(2027, 1, 3)) as Picked, 'month')).toBe(
         '2027-01..2027-02'
      );
   });

   it('keeps a preset’s unit whatever the month, so a bookmark keeps its layout', () => {
      for (const month of [0, 1, 2, 9, 11]) {
         const at = new Date(2026, month, 13);
         expect(resolveWindow('6m', at)?.unit).toBe('month');
         expect(resolveWindow('12m', at)?.unit).toBe('month');
         expect(resolveWindow('2q', at)?.unit).toBe('quarter');
         expect(resolveWindow('year', at)?.unit).toBe('quarter');
      }
      expect(isPreset('ytd')).toBe(true);
      expect(isPreset('2026-10..2026-12')).toBe(false);
      expect(isPreset('toString')).toBe(false);
   });

   it('reads its own keys back in either unit, future ones too, and refuses anything else', () => {
      for (const k of [
         '2025-10..2026-09',
         '2027-01..2027-01',
         '2025-Q4..2026-Q3',
         '2027-Q2..2027-Q2',
      ]) {
         expect(key(k)).toBe(k);
      }
      expect(picked('2025-Q4..2026-Q3')).toMatchObject({ unit: 'quarter' });
      expect(picked('2025-10..2026-09')).toMatchObject({ unit: 'month' });
      for (const bad of [
         '2026-10..2026-09',
         '2026-Q4..2026-Q1',
         '2026-13..2027-01',
         '2026-10',
         '',
      ]) {
         expect(resolveWindow(bad, now)).toBeNull();
      }
      expect(resolveWindow(null, now)).toBeNull();
      // what the URL takes (lens.ts) is what the picker writes
      for (const [k] of WINDOW_PRESETS) expect(windowParam(k)).toBe(k);
      expect(windowParam(key('ytd'))).toBe(key('ytd'));
   });

   it('cuts a span past five years to five, in its own unit', () => {
      expect(windowParam('1970-01..2170-12')).toBe('1970-01..1974-12');
      expect(windowParam('2024-Q2..2040-Q1')).toBe('2024-Q2..2029-Q1');
      expect(windowParam('2026-01..2030-12')).toBe('2026-01..2030-12');
      const long = picked('1970-01..2170-12');
      expect(long.to - long.from).toBe(MAX_WINDOW_MONTHS);
      expect(columnsFor('quarter', null, now, long)).toHaveLength(60);
   });

   it('leaves the default exactly as it was with no window picked', () => {
      for (const scale of ['quarter', 'month'] as const) {
         expect(columnsFor(scale, null, now, null)).toEqual(columnsFor(scale, null, now));
         expect(drawnWindow(scale, null, now)).toEqual({
            months: defaultWindow(scale, now),
            unit: scale,
         });
      }
      expect(windowKey(defaultWindow('quarter', now), 'quarter')).toBe('2026-Q3..2027-Q2');
      expect(windowKey(defaultWindow('month', now), 'month')).toBe('2026-09..2027-03');
   });

   it('draws a calendar pick in months up to four, or a year not on quarters; quarters past that', () => {
      const unit = (a: string, b: string) => windowOfDays(a, b).unit;
      expect(unit('2025-11-03', '2026-02-20')).toBe('month');
      expect(unit('2026-01-01', '2026-10-31')).toBe('month');
      expect(unit('2026-01-01', '2026-06-30')).toBe('quarter');
      // longer than a year, off the quarters: out to whole quarters
      const long = windowOfDays('2025-11-17', '2027-01-04');
      expect(windowKey(long, long.unit)).toBe('2025-Q4..2027-Q1');
      // days in the same month still make a whole month
      expect(windowKey(windowOfDays('2027-02-14', '2027-05-02'), 'month')).toBe('2027-02..2027-05');
      // and never more than five years
      const huge = windowOfDays('2020-01-01', '2035-12-31');
      expect(huge.to - huge.from).toBe(MAX_WINDOW_MONTHS);
   });

   it('converts a window between units for the Months and Quarters switch', () => {
      const six = picked('6m');
      expect(windowKey(inUnit(six, 'quarter'), 'quarter')).toBe('2026-Q4..2027-Q1');
      const twelve = picked('12m');
      expect(windowKey(inUnit(twelve, 'quarter'), 'quarter')).toBe('2025-Q4..2026-Q4');
      const year = picked('year');
      expect(windowKey(inUnit(year, 'month'), 'month')).toBe('2026-01..2026-12');
   });

   it('draws a picked window as its columns', () => {
      const ytd = columnsFor('quarter', null, now, picked('ytd'));
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
      const back = columnsFor('month', null, now, picked('2025-Q4..2026-Q3'));
      expect(back.map(c => c.label)).toEqual(['Q4 2025', 'Q1 2026', 'Q2 2026', 'Q3 2026']);
      // a picked window still yields to a zoom
      expect(columnsFor('quarter', parseZoom('2026-Q4'), now, picked('ytd'))).toEqual(
         columnsFor('quarter', parseZoom('2026-Q4'), now)
      );
   });

   it('steps by its own length', () => {
      expect(windowKey(shiftWindow(picked('ytd'), -1), 'month')).toBe('2025-03..2025-12');
      expect(windowKey(shiftWindow(defaultWindow('quarter', now), -1), 'quarter')).toBe(
         '2025-Q3..2026-Q2'
      );
      expect(windowKey(shiftWindow(defaultWindow('month', now), 1), 'month')).toBe(
         '2027-04..2027-10'
      );
   });

   it('moves to hold a day: the edge chip and zooming out', () => {
      const w = defaultWindow('quarter', now);
      expect(windowHolding(w, '2026-08-03', 'quarter')).toBe(w);
      expect(windowKey(windowHolding(w, '2025-11-17', 'quarter'), 'quarter')).toBe(
         '2025-Q4..2026-Q3'
      );
      expect(windowKey(windowHolding(w, '2027-09-06', 'month'), 'month')).toBe('2027-09..2028-08');
   });

   it('says what it covers in its columns’ unit', () => {
      const words = (k: string) => {
         const d = drawnWindow('quarter', picked(k), now);
         return windowWords(d.months, d.unit);
      };
      expect(words('ytd')).toBe('Jan to Oct 2026');
      expect(words('2025-Q4..2026-Q3')).toBe('Q4 2025 to Q3 2026');
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

describe('columnNames', () => {
   const now = new Date(2026, 9, 13);
   const twelve = columnsFor('quarter', null, now, resolveWindow('12m', now));
   const quarters = columnsFor('quarter', null, now);
   const each = (cols: unknown[], px: number) => cols.map(() => px);

   it('says every full name while they fit, and before the width is known', () => {
      expect(columnNames(twelve, each(twelve, 0))).toEqual(twelve.map(c => c.label));
      expect(columnNames(twelve, each(twelve, 80))).toEqual(twelve.map(c => c.label));
      expect(columnNames(quarters, each(quarters, 200))).toEqual([
         'Q3 2026',
         'Q4 2026',
         'Q1 2027',
         'Q2 2027',
      ]);
   });

   it('shortens on a phone, keeping a year where one starts, and never drops February', () => {
      const short = columnNames(twelve, each(twelve, 40));
      expect(short).toHaveLength(12);
      expect(short.every(t => t && t.length === 3)).toBe(true);
      expect(columnNames(twelve, each(twelve, 20))).toEqual([
         'N',
         'D',
         'J',
         'F',
         'M',
         'A',
         'M',
         'J',
         'J',
         'A',
         'S',
         'O',
      ]);
      // the year where it starts while those fit, else the quarters alone
      expect(columnNames(quarters, [70, 30, 70, 30])).toEqual(['Q3 2026', 'Q4', 'Q1 2027', 'Q2']);
      expect(columnNames(quarters, each(quarters, 45))).toEqual(['Q3', 'Q4', '2027', 'Q2']);
      expect(columnNames(quarters, each(quarters, 30))).toEqual(['Q3', null, '2027', null]);
   });

   it('thins five years of months to their years, every column still a column', () => {
      const long = columnsFor('quarter', null, now, resolveWindow('2026-01..2030-12', now));
      const names = columnNames(long, each(long, 5));
      expect(names).toHaveLength(60);
      expect(names.filter(Boolean)).toEqual(['2026', '2027', '2028', '2029', '2030']);
   });
});

describe('historyRange', () => {
   it('ends a past window’s history on its last day, not the day after', () => {
      expect(historyRange('2026-07-01', '2026-10-01', '2026-10-13', 400)).toEqual({
         start: '2026-07-01',
         end: '2026-09-30',
      });
   });

   it('ends at today in a window that holds it, and keeps the server’s last 400 days', () => {
      expect(historyRange('2022-01-01', '2027-01-01', '2026-10-13', 400)).toEqual({
         start: '2025-09-09',
         end: '2026-10-13',
      });
      expect(historyRange('2027-01-01', '2027-04-01', '2026-10-13', 400)).toBeNull();
   });
});

describe('dayAcross', () => {
   it('puts the window’s last day at the track’s right edge, never the day after', () => {
      const from = Date.UTC(2027, 0, 1) / 1000;
      const to = Date.UTC(2027, 2, 1) / 1000; // Mar 1, 2027, a Monday
      expect(dayAcross(from, to, 1)).toBe('2027-02-28');
      expect(dayAcross(from, to, 0)).toBe('2027-01-01');
   });
});
