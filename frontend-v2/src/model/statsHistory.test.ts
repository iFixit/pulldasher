import { describe, expect, it } from 'vitest';
import {
   explodeMonthToWeeklySamples,
   fillDayGaps,
   fillMonthGaps,
   fillWeekGaps,
   resampleWeekly,
   weeklyTimeInReview,
} from './statsHistory';

// Fixed anchor so "trailing N periods up to now" is deterministic: 2026-07-18
// (a Saturday, ISO week 29).
const NOW = new Date(2026, 6, 18).getTime();

describe('fillMonthGaps', () => {
   it('returns 12 trailing months, oldest first, ending at the anchor month', () => {
      const filled = fillMonthGaps([], 12, NOW);
      expect(filled).toHaveLength(12);
      expect(filled[0].month).toBe('2025-08');
      expect(filled.at(-1)!.month).toBe('2026-07');
   });

   it('keeps real rows and zero-fills the months missing from them', () => {
      const rows = [{ month: '2026-06', opened: 5, merged: 3 }];
      const filled = fillMonthGaps(rows, 3, NOW);
      expect(filled).toEqual([
         { month: '2026-05', opened: 0, merged: 0 },
         { month: '2026-06', opened: 5, merged: 3 },
         { month: '2026-07', opened: 0, merged: 0 },
      ]);
   });

   it('carries a December → January rollover without breaking the year', () => {
      const filled = fillMonthGaps([], 3, new Date(2026, 0, 15).getTime());
      expect(filled.map(m => m.month)).toEqual(['2025-11', '2025-12', '2026-01']);
   });
});

describe('fillDayGaps', () => {
   it('returns the trailing N local days, zero-filling missing ones', () => {
      const rows = [{ day: '2026-07-18', avgHours: 12, maxHours: 40, merged: 2 }];
      const filled = fillDayGaps(rows, 3, NOW);
      expect(filled).toEqual([
         { day: '2026-07-16', avgHours: 0, maxHours: 0, merged: 0 },
         { day: '2026-07-17', avgHours: 0, maxHours: 0, merged: 0 },
         { day: '2026-07-18', avgHours: 12, maxHours: 40, merged: 2 },
      ]);
   });
});

describe('fillWeekGaps', () => {
   it('labels the anchor week as the correct ISO week', () => {
      const filled = fillWeekGaps([], 1, NOW);
      expect(filled).toEqual([{ isoWeek: '2026-W29', avgHours: 0, merged: 0 }]);
   });

   it('zero-fills weeks missing from the real rows', () => {
      const rows = [{ isoWeek: '2026-W29', avgHours: 30, merged: 4 }];
      const filled = fillWeekGaps(rows, 2, NOW);
      expect(filled).toEqual([
         { isoWeek: '2026-W28', avgHours: 0, merged: 0 },
         { isoWeek: '2026-W29', avgHours: 30, merged: 4 },
      ]);
   });
});

describe('resampleWeekly', () => {
   it('weight-averages samples landing in the same ISO week', () => {
      const samples = [
         { at: new Date(2026, 6, 17).getTime(), value: 10, weight: 2 },
         { at: new Date(2026, 6, 18).getTime(), value: 20, weight: 1 },
      ];
      const [week] = resampleWeekly(samples, ['2026-W29']);
      expect(week.isoWeek).toBe('2026-W29');
      expect(week.value).toBeCloseTo((10 * 2 + 20 * 1) / 3, 6);
      expect(week.sampled).toBe(3);
   });

   it('zero-fills weeks with no samples, distinct from a real zero', () => {
      const [week] = resampleWeekly([], ['2026-W29']);
      expect(week).toEqual({ isoWeek: '2026-W29', value: 0, sampled: 0 });
   });
});

describe('explodeMonthToWeeklySamples', () => {
   it('spreads a month evenly across its days, splitting the weight', () => {
      const samples = explodeMonthToWeeklySamples('2026-07', 4, 31);
      expect(samples).toHaveLength(31);
      expect(samples.every(s => s.value === 4)).toBe(true);
      expect(samples.every(s => s.weight === 1)).toBe(true);
      expect(samples[0].at).toBe(new Date(2026, 6, 1).getTime());
      expect(samples.at(-1)!.at).toBe(new Date(2026, 6, 31).getTime());
   });
});

describe('weeklyTimeInReview', () => {
   it('resamples month-, week-, and day-native rows onto one weekly grain', () => {
      const [week] = weeklyTimeInReview(
         [{ month: '2026-07', avgHours: 5, medianHours: 4, sampled: 31 }],
         [{ isoWeek: '2026-W29', avgHours: 12, merged: 4 }],
         [{ day: '2026-07-18', avgHours: 8, maxHours: 20, merged: 2 }],
         1,
         NOW
      );
      expect(week.isoWeek).toBe('2026-W29');
      // every July day carries the same monthly value, so the weekly blend
      // reproduces it regardless of exactly which July days fall in W29
      expect(week.firstCrMedianHours).toBeCloseTo(4, 6);
      expect(week.firstCrAvgHours).toBeCloseTo(5, 6);
      // the week- and day-grain merge-time rows both land in W29 and blend
      // weighted by their merge counts: (12*4 + 8*2) / (4 + 2)
      expect(week.mergeAvgHours).toBeCloseTo((12 * 4 + 8 * 2) / 6, 6);
   });

   it('zero-fills a week with no underlying history', () => {
      const [week] = weeklyTimeInReview([], [], [], 1, NOW);
      expect(week).toEqual({
         isoWeek: '2026-W29',
         firstCrMedianHours: 0,
         firstCrAvgHours: 0,
         mergeAvgHours: 0,
      });
   });
});
