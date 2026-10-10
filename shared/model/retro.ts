import { utcDay } from './projects';
import { mondayOf } from './roadmap';

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

/** A person's share of days on one PR in one week. */
export interface TimeRow {
   login: string;
   repo: string;
   number: number;
   /** the Monday of the week, YYYY-MM-DD */
   week: string;
   /** they wrote it: writing, not reviewing */
   own: boolean;
   days: number;
}

const keyOf = (t: Pick<Touch, 'repo' | 'number'>) => `${t.repo.toLowerCase()}#${t.number}`;

/**
 * Each person's active days split across the PRs they touched, as one row
 * per person, PR and week. `counts` picks whose time is counted (the caller
 * leaves out bots and, when there are developer teams, everyone off them).
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
      for (const [day, prs] of byDay) {
         const week = mondayOf(day);
         for (const [key, t] of prs) {
            const id = `${login}|${key}|${week}`;
            const row = rows.get(id) ?? {
               login,
               repo: t.repo,
               number: t.number,
               week,
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
