import { utcDay } from './projects';

/**
 * Where the time went, for the Projects tab's Look back view and GET
 * /api/v1/retro. PR counts can't answer it: a one-line fix and a month of
 * work each count once. So the unit is a person's active day: a day they
 * opened, merged, commented on, stamped or reviewed a PR. Each active day
 * counts as one, split evenly across the PRs they touched that day. A PR
 * they wrote counts as writing; anyone else's, as reviewing.
 *
 * Commits aren't counted, since Pulldasher doesn't keep them. In a sample of
 * 60 merged PRs, adding their commit days raised the authors' active days by
 * about 4%: PRs here open and merge within a day or two, so the coding days
 * are mostly days the PR was opened, commented on or merged anyway.
 */

/** One thing someone did on a PR, and when (epoch secs). */
export interface Touch {
   login: string;
   at: number;
   repo: string;
   number: number;
   /** who wrote the PR */
   owner: string;
}

/** A person's share of days on one PR over the range. */
export interface TimeRow {
   login: string;
   repo: string;
   number: number;
   /** they wrote it: writing, not reviewing */
   own: boolean;
   days: number;
}

const keyOf = (t: Pick<Touch, 'repo' | 'number'>) => `${t.repo.toLowerCase()}#${t.number}`;

/**
 * Each person's active days split across the PRs they touched, as one row
 * per person and PR. `counts` picks whose time is counted (the caller leaves
 * out bots and, when there are developer teams, everyone off them).
 */
export function timeSpent(
   touches: readonly Touch[],
   counts: (login: string) => boolean = () => true
): TimeRow[] {
   // person -> day -> the PRs touched that day
   const days = new Map<string, Map<string, Map<string, Touch>>>();
   for (const t of touches) {
      if (!counts(t.login)) continue;
      const byDay = days.get(t.login) ?? new Map<string, Map<string, Touch>>();
      days.set(t.login, byDay);
      const day = utcDay(t.at);
      const prs = byDay.get(day) ?? new Map<string, Touch>();
      byDay.set(day, prs);
      prs.set(keyOf(t), t);
   }
   const rows = new Map<string, TimeRow>();
   for (const [login, byDay] of days) {
      for (const prs of byDay.values()) {
         for (const [key, t] of prs) {
            const id = `${login}|${key}`;
            const row = rows.get(id) ?? {
               login,
               repo: t.repo,
               number: t.number,
               own: t.owner.toLowerCase() === login.toLowerCase(),
               days: 0,
            };
            row.days += 1 / prs.size;
            rows.set(id, row);
         }
      }
   }
   return [...rows.values()];
}

/** One group of rows, in the view's words: its days, how many of them went
 * to writing, and who spent them. */
export interface TimeGroup {
   key: string;
   days: number;
   writing: number;
   people: string[];
}

/** Rows grouped by `keyOf`, the most days first. */
export function groupTime<R extends TimeRow>(
   rows: readonly R[],
   groupOf: (row: R) => string
): TimeGroup[] {
   const groups = new Map<string, { days: number; writing: number; people: Map<string, number> }>();
   for (const row of rows) {
      const key = groupOf(row);
      const g = groups.get(key) ?? { days: 0, writing: 0, people: new Map<string, number>() };
      groups.set(key, g);
      g.days += row.days;
      if (row.own) g.writing += row.days;
      g.people.set(row.login, (g.people.get(row.login) ?? 0) + row.days);
   }
   return [...groups]
      .map(([key, g]) => ({
         key,
         days: g.days,
         writing: g.writing,
         // the most days first
         people: [...g.people].sort((a, b) => b[1] - a[1]).map(([login]) => login),
      }))
      .sort((a, b) => b.days - a.days || a.key.localeCompare(b.key));
}
