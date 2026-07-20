import { useEffect, useState } from 'react';
import { isDummy } from '../backend/dummy';

/**
 * The Stats lens's history layer: months/weeks of PR history the live socket
 * payload doesn't carry (it only ships open pulls + 14 days of closed ones).
 * Backed by GET /v2/stats-history, a read-only DB aggregate the server
 * memoizes for 10 minutes since this data moves slowly. Fetched once per
 * session (module-level cache) and hidden entirely — never a loading spinner
 * or error banner — on any failure, so a stale or unreachable endpoint just
 * means the Trends band doesn't render.
 */

export interface MonthlyRow {
   month: string; // "2026-01"
   opened: number;
   merged: number;
}

export interface MergeAgeDayRow {
   day: string; // "2026-07-15"
   avgHours: number;
   maxHours: number;
   merged: number;
}

export interface FirstCrMonthRow {
   month: string;
   avgHours: number;
   medianHours: number;
   sampled: number;
}

export interface DurationWeekRow {
   isoWeek: string; // "2026-W29"
   avgHours: number;
   merged: number;
}

export interface StatsHistory {
   monthly: MonthlyRow[];
   mergeAgeByDay: MergeAgeDayRow[];
   firstCrByMonth: FirstCrMonthRow[];
   durationByWeek: DurationWeekRow[];
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

function startOfDay(t: number): number {
   return new Date(t).setHours(0, 0, 0, 0);
}

function isoDate(t: number): string {
   const d = new Date(t);
   const y = d.getFullYear();
   const m = String(d.getMonth() + 1).padStart(2, '0');
   const day = String(d.getDate()).padStart(2, '0');
   return `${y}-${m}-${day}`;
}

/**
 * ISO-8601 week label ("2026-W29") for a timestamp — the Thursday-of-the-week
 * rule, matching the server's `YEARWEEK(..., 3)` (ISO mode). Both sides
 * implement the same standard independently; they agree because ISO 8601
 * week numbering is unambiguous.
 */
function isoWeekLabel(t: number): string {
   const d = new Date(t);
   d.setHours(0, 0, 0, 0);
   // Shift to the Thursday of this week (ISO weeks belong to the year that
   // owns their Thursday).
   d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
   const jan4 = new Date(d.getFullYear(), 0, 4);
   const week =
      1 + Math.round(((d.getTime() - jan4.getTime()) / DAY_MS - 3 + ((jan4.getDay() + 6) % 7)) / 7);
   return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Fills in any months missing from `rows` with a zero row, spanning the
 * trailing `months` calendar months up to `now` — so a quiet month reads as a
 * visible zero bar instead of silently vanishing from the x-axis.
 */
export function fillMonthGaps(rows: MonthlyRow[], months = 12, now = Date.now()): MonthlyRow[] {
   const by = new Map(rows.map(r => [r.month, r]));
   const anchor = new Date(now);
   const anchorIndex = anchor.getFullYear() * 12 + anchor.getMonth();
   return Array.from({ length: months }, (_, i) => {
      const idx = anchorIndex - (months - 1) + i;
      const year = Math.floor(idx / 12);
      const key = `${year}-${String((idx % 12) + 1).padStart(2, '0')}`;
      return by.get(key) ?? { month: key, opened: 0, merged: 0 };
   });
}

/**
 * Same gap-fill as {@link fillMonthGaps}, for the first-CR-latency monthly
 * series — a distinct row shape (avg/median/sampled, not opened/merged).
 */
export function fillFirstCrMonthGaps(
   rows: FirstCrMonthRow[],
   months = 12,
   now = Date.now()
): FirstCrMonthRow[] {
   const by = new Map(rows.map(r => [r.month, r]));
   const anchor = new Date(now);
   const anchorIndex = anchor.getFullYear() * 12 + anchor.getMonth();
   return Array.from({ length: months }, (_, i) => {
      const idx = anchorIndex - (months - 1) + i;
      const year = Math.floor(idx / 12);
      const key = `${year}-${String((idx % 12) + 1).padStart(2, '0')}`;
      return by.get(key) ?? { month: key, avgHours: 0, medianHours: 0, sampled: 0 };
   });
}

/** Same gap-fill as {@link fillMonthGaps}, for the trailing `days` local days. */
export function fillDayGaps(rows: MergeAgeDayRow[], days = 60, now = Date.now()): MergeAgeDayRow[] {
   const by = new Map(rows.map(r => [r.day, r]));
   const end = startOfDay(now);
   return Array.from({ length: days }, (_, i) => {
      const key = isoDate(end - (days - 1 - i) * DAY_MS);
      return by.get(key) ?? { day: key, avgHours: 0, maxHours: 0, merged: 0 };
   });
}

/** Same gap-fill as {@link fillMonthGaps}, for the trailing `weeks` ISO weeks. */
export function fillWeekGaps(
   rows: DurationWeekRow[],
   weeks = 26,
   now = Date.now()
): DurationWeekRow[] {
   const by = new Map(rows.map(r => [r.isoWeek, r]));
   const end = startOfDay(now);
   return Array.from({ length: weeks }, (_, i) => {
      const key = isoWeekLabel(end - (weeks - 1 - i) * WEEK_MS);
      return by.get(key) ?? { isoWeek: key, avgHours: 0, merged: 0 };
   });
}

function round1(n: number): number {
   return Math.round(n * 10) / 10;
}

// Dummy mode has no backend to hit: synthesize a plausible year of history so
// the Trends cards have something to render in `npm run dev:dummy`. Seeded
// with simple modular formulas (no Math.random) so a run is reproducible.
function dummyHistory(): StatsHistory {
   const now = Date.now();
   const monthly = fillMonthGaps([], 12, now).map((m, i) => ({
      month: m.month,
      opened: 8 + ((i * 53) % 14),
      merged: 6 + ((i * 47) % 12),
   }));
   const mergeAgeByDay = fillDayGaps([], 60, now).map((d, i) => ({
      day: d.day,
      avgHours: round1(10 + ((i * 29) % 40)),
      maxHours: round1(30 + ((i * 71) % 90)),
      merged: 1 + (i % 6),
   }));
   const firstCrByMonth = fillFirstCrMonthGaps([], 12, now).map((m, i) => ({
      month: m.month,
      avgHours: round1(3 + ((i * 17) % 10)),
      medianHours: round1(2 + ((i * 13) % 8)),
      sampled: 10 + (i % 20),
   }));
   const durationByWeek = fillWeekGaps([], 26, now).map((w, i) => ({
      isoWeek: w.isoWeek,
      avgHours: round1(20 + ((i * 37) % 30)),
      merged: 2 + (i % 8),
   }));
   return { monthly, mergeAgeByDay, firstCrByMonth, durationByWeek };
}

let cache: Promise<StatsHistory | null> | null = null;

function load(): Promise<StatsHistory | null> {
   if (isDummy()) return Promise.resolve(dummyHistory());
   return fetch('/v2/stats-history')
      .then(r => (r.ok ? (r.json() as Promise<StatsHistory>) : null))
      .catch(() => null);
}

/**
 * Fetches PR history once per session (a module-level cache shared across
 * every caller, so mounting multiple trend cards doesn't refetch) and returns
 * null until it resolves — permanently null on any failure, which is the
 * caller's cue to hide the Trends band rather than show an empty state.
 */
export function useStatsHistory(): StatsHistory | null {
   const [data, setData] = useState<StatsHistory | null>(null);
   useEffect(() => {
      cache = cache ?? load();
      let live = true;
      cache.then(result => {
         if (live) setData(result);
      });
      return () => {
         live = false;
      };
   }, []);
   return data;
}
