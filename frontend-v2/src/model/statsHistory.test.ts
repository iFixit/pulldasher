import { describe, expect, it } from 'vitest';
import { fillDayGaps, fillMonthGaps, fillWeekGaps } from './statsHistory';

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
