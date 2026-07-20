import { describe, expect, it } from 'vitest';
import { bumpStreak, NO_STREAK, type StreakState } from './streak';

describe('bumpStreak', () => {
   it('is a no-op for a same-day repeat', () => {
      const prev: StreakState = { lastDay: '2026-07-18', count: 2 };
      const { state, toasted, milestone } = bumpStreak(prev, '2026-07-18');
      expect(state).toBe(prev);
      expect(toasted).toBe(false);
      expect(milestone).toBe(false);
   });

   it('starts a streak of 1 on the very first review', () => {
      const { state, toasted } = bumpStreak(NO_STREAK, '2026-07-18');
      expect(state).toEqual({ lastDay: '2026-07-18', count: 1 });
      expect(toasted).toBe(true);
   });

   it('extends the streak on a consecutive day', () => {
      const prev: StreakState = { lastDay: '2026-07-18', count: 1 };
      const { state, toasted } = bumpStreak(prev, '2026-07-19');
      expect(state).toEqual({ lastDay: '2026-07-19', count: 2 });
      expect(toasted).toBe(true);
   });

   it('chains several consecutive days', () => {
      let state: StreakState = NO_STREAK;
      const days = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04'];
      for (const day of days) {
         state = bumpStreak(state, day).state;
      }
      expect(state.count).toBe(4);
   });

   it('resets to 1 after a gap', () => {
      const prev: StreakState = { lastDay: '2026-07-10', count: 5 };
      const { state, toasted } = bumpStreak(prev, '2026-07-18');
      expect(state).toEqual({ lastDay: '2026-07-18', count: 1 });
      expect(toasted).toBe(true);
   });

   it('flags a milestone at 3 and 7 but not in between', () => {
      let state: StreakState = NO_STREAK;
      const results: boolean[] = [];
      const days = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'];
      for (const day of days) {
         const r = bumpStreak(state, day);
         state = r.state;
         results.push(r.milestone);
      }
      // days: count 1, 2, 3(milestone), 4, 5
      expect(results).toEqual([false, false, true, false, false]);
   });

   it('flags the 7-day milestone', () => {
      let state: StreakState = { lastDay: '2026-07-11', count: 6 };
      const r = bumpStreak(state, '2026-07-12');
      expect(r.state.count).toBe(7);
      expect(r.milestone).toBe(true);
   });
});
