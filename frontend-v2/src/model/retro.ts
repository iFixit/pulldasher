import { dayStart } from '../../../shared/model/projects';
import type { RetroData, RetroPr } from './retroData';

/**
 * Look back's numbers, from GET /retro-data's compact rows. Pure, so the
 * view, its copy-as-text and the tests read the same sums.
 */

/** One person's share of days on one PR in one week. */
export interface RetroRow {
   login: string;
   pr: RetroPr;
   /** index into RetroData.weeks */
   week: number;
   days: number;
   /** they wrote the PR: writing, not reviewing */
   own: boolean;
}

export function retroRows(data: RetroData): RetroRow[] {
   return data.rows.map(([person, pr, week, days]) => {
      const login = data.people[person];
      const p = data.prs[pr];
      return { login, pr: p, week, days, own: p.owner.toLowerCase() === login.toLowerCase() };
   });
}

/** Rows grouped one way: the days, how many were writing, each week's days,
 * who spent them and on which PRs (most first), and how many of its PRs
 * merged in the range. */
export interface RetroGroup {
   key: string;
   days: number;
   writing: number;
   /** days per week, one entry per RetroData.weeks */
   weekly: number[];
   people: [string, number][];
   prs: [RetroPr, number][];
   merged: number;
}

export function groupRows(
   rows: readonly RetroRow[],
   keyOf: (row: RetroRow) => string,
   data: Pick<RetroData, 'weeks' | 'start' | 'end'>
): RetroGroup[] {
   const from = dayStart(data.start) ?? 0;
   const to = (dayStart(data.end) ?? from) + 86400;
   const groups = new Map<
      string,
      {
         days: number;
         writing: number;
         weekly: number[];
         people: Map<string, number>;
         prs: Map<RetroPr, number>;
      }
   >();
   for (const row of rows) {
      const key = keyOf(row);
      let g = groups.get(key);
      if (!g) {
         g = {
            days: 0,
            writing: 0,
            weekly: data.weeks.map(() => 0),
            people: new Map(),
            prs: new Map(),
         };
         groups.set(key, g);
      }
      g.days += row.days;
      if (row.own) g.writing += row.days;
      g.weekly[row.week] += row.days;
      g.people.set(row.login, (g.people.get(row.login) ?? 0) + row.days);
      g.prs.set(row.pr, (g.prs.get(row.pr) ?? 0) + row.days);
   }
   const most = <T>(m: Map<T, number>) => [...m].sort((a, b) => b[1] - a[1]);
   return [...groups]
      .map(([key, g]) => ({
         key,
         days: g.days,
         writing: g.writing,
         weekly: g.weekly,
         people: most(g.people),
         prs: most(g.prs),
         merged: [...g.prs.keys()].filter(
            p => p.merged != null && p.merged >= from && p.merged < to
         ).length,
      }))
      .sort((a, b) => b.days - a.days || a.key.localeCompare(b.key));
}

/** How spread out each person was: the median, over the weeks they worked,
 * of how many different projects they touched that week. A PR with no
 * project counts on its own, since nothing says it's part of another. */
export function spreadByPerson(rows: readonly RetroRow[]): Map<string, number> {
   const seen = new Map<string, Map<number, Set<string>>>();
   for (const row of rows) {
      const weeks = seen.get(row.login) ?? new Map<number, Set<string>>();
      seen.set(row.login, weeks);
      const things = weeks.get(row.week) ?? new Set<string>();
      weeks.set(row.week, things);
      things.add(row.pr.project ?? `${row.pr.repo}#${row.pr.number}`);
   }
   return new Map(
      [...seen].map(([login, weeks]) => [login, median([...weeks.values()].map(s => s.size))])
   );
}

export function median(values: readonly number[]): number {
   if (!values.length) return 0;
   const sorted = [...values].sort((a, b) => a - b);
   const mid = Math.floor(sorted.length / 2);
   return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
