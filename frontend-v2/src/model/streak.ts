/**
 * A day-streak counter for the "you've reviewed N days running" reward.
 * Pure: the caller (the toasts hook) owns the clock and localStorage — this
 * module only knows how to fold today's date into yesterday's state, so the
 * transition logic is unit-testable without faking `Date` or a browser.
 */

export interface StreakState {
   /** the last day a review landed, "YYYY-MM-DD"; '' before the first ever */
   lastDay: string;
   count: number;
}

export const NO_STREAK: StreakState = { lastDay: '', count: 0 };

/** Streak lengths worth celebrating. */
export const STREAK_MILESTONES = [3, 7, 14, 30];

/** Whole days between two "YYYY-MM-DD" dates (both UTC midnight, so this is
 * always an exact integer — no DST/timezone rounding to worry about). */
function daysBetween(from: string, to: string): number {
   return (Date.parse(to) - Date.parse(from)) / 86_400_000;
}

/**
 * Fold today's first review into the streak. Same-day repeats are a no-op
 * (only the day's FIRST stamp advances the streak); a day exactly after the
 * last one extends it; anything else (a gap, or the very first review ever)
 * starts a fresh streak of 1. `toasted` tells the caller whether this call
 * changed the streak at all (worth a toast); `milestone` narrows that to a
 * round number worth a bigger toast.
 */
export function bumpStreak(
   prev: StreakState,
   todayISO: string
): { state: StreakState; toasted: boolean; milestone: boolean } {
   if (todayISO === prev.lastDay) {
      return { state: prev, toasted: false, milestone: false };
   }
   const consecutive = prev.lastDay !== '' && daysBetween(prev.lastDay, todayISO) === 1;
   const count = consecutive ? prev.count + 1 : 1;
   const state: StreakState = { lastDay: todayISO, count };
   return { state, toasted: true, milestone: STREAK_MILESTONES.includes(count) };
}
