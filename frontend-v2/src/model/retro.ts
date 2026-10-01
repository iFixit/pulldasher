import {
   dayStart,
   MISC_SLUG,
   utcDay,
   type Project,
   type ProjectWindow,
} from '../../../shared/model/projects';
import { planEnd, planFor, type RoadmapItem } from '../../../shared/model/roadmap';
import { dayWords } from './projectData';
import type { RetroData, RetroPr } from './retroData';

const DAY = 86400;

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

/** One person's days on one project: all of them, and how many were
 * writing (the rest were reviewing). */
export interface ProjectWorker {
   login: string;
   days: number;
   writing: number;
}

/** A filed project: a real one, not one-offs (misc) and not unlabeled. */
const filedProject = (row: RetroRow) =>
   row.pr.project != null && row.pr.project !== MISC_SLUG ? row.pr.project : null;

/** Days per person per filed project. */
function byPersonProject(rows: readonly RetroRow[]): Map<string, Map<string, ProjectWorker>> {
   const out = new Map<string, Map<string, ProjectWorker>>();
   for (const row of rows) {
      const slug = filedProject(row);
      if (!slug) continue;
      const mine = out.get(row.login) ?? new Map<string, ProjectWorker>();
      out.set(row.login, mine);
      const w = mine.get(slug) ?? { login: row.login, days: 0, writing: 0 };
      mine.set(slug, w);
      w.days += row.days;
      if (row.own) w.writing += row.days;
   }
   return out;
}

/** Who worked on each filed project, most days first. */
export function peopleByProject(rows: readonly RetroRow[]): Map<string, ProjectWorker[]> {
   const out = new Map<string, ProjectWorker[]>();
   for (const projects of byPersonProject(rows).values()) {
      for (const [slug, w] of projects) out.set(slug, [...(out.get(slug) ?? []), w]);
   }
   for (const list of out.values()) {
      list.sort((a, b) => b.days - a.days || a.login.localeCompare(b.login));
   }
   return out;
}

/** One person's spread over a window: their days, how many went to
 * reviewing and to PRs with no project, and every filed project they
 * worked on, most days first. */
export interface PersonLoad {
   login: string;
   days: number;
   reviewing: number;
   unfiled: number;
   /** filed projects, with the person's days and writing days on each */
   projects: (ProjectWorker & { slug: string })[];
   /** filed projects they wrote on, and ones they only reviewed on */
   wrote: number;
   reviewedOnly: number;
   /** filed projects they reviewed on at all, writing or not */
   reviewed: number;
}

/** Every login's load, in the order given, zeros included for anyone with no days. */
export function loadByPerson(rows: readonly RetroRow[], logins: readonly string[]): PersonLoad[] {
   const projects = byPersonProject(rows);
   const totals = new Map<string, { days: number; reviewing: number; unfiled: number }>();
   for (const row of rows) {
      const t = totals.get(row.login) ?? { days: 0, reviewing: 0, unfiled: 0 };
      totals.set(row.login, t);
      t.days += row.days;
      if (!row.own) t.reviewing += row.days;
      if (row.pr.project == null) t.unfiled += row.days;
   }
   return logins.map(login => {
      const list = [...(projects.get(login) ?? new Map<string, ProjectWorker>())]
         .map(([slug, w]) => ({ ...w, slug }))
         .sort((a, b) => b.days - a.days || a.slug.localeCompare(b.slug));
      const wrote = list.filter(p => p.writing > 0).length;
      return {
         login,
         ...(totals.get(login) ?? { days: 0, reviewing: 0, unfiled: 0 }),
         projects: list,
         wrote,
         reviewedOnly: list.length - wrote,
         reviewed: list.filter(p => p.days - p.writing > 0).length,
      };
   });
}

/** fewest filed projects in a window that ever reads as overloaded */
export const OVERLOAD_MIN = 4;

/**
 * How many filed projects in a window make someone overloaded: at least
 * OVERLOAD_MIN, and at least twice the median across developers (zeros
 * included). Relative on purpose: while most PRs aren't filed yet, a fixed
 * number would flag more people each week as filing catches up.
 */
export function overloadLine(counts: readonly number[]): number {
   return Math.max(OVERLOAD_MIN, Math.ceil(2 * median(counts)));
}

export function median(values: readonly number[]): number {
   if (!values.length) return 0;
   const sorted = [...values].sort((a, b) => a - b);
   const mid = Math.floor(sorted.length / 2);
   return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The most weeks in a row with no days, between a row's first and last
 * week with any: how long the work sat. 0 when it never paused. */
export function quietWeeks(weekly: readonly number[]): number {
   const first = weekly.findIndex(d => d > 0);
   if (first < 0) return 0;
   const last = lastWeek(weekly);
   let best = 0;
   let run = 0;
   for (let i = first; i <= last; i++) {
      run = weekly[i] > 0 ? 0 : run + 1;
      best = Math.max(best, run);
   }
   return best;
}

/** The index of a row's last week with any days; -1 with none. */
export function lastWeek(weekly: readonly number[]): number {
   for (let i = weekly.length - 1; i >= 0; i--) if (weekly[i] > 0) return i;
   return -1;
}

/**
 * How long a project's PRs ran, as of the range's end: still open then,
 * and for how many days since its first PR in the range opened; or done,
 * and how many days from that first PR to its last merge or close. Null
 * with no numbers for the range.
 */
export function projectLength(
   w: Pick<ProjectWindow, 'first_opened' | 'last_closed' | 'backlog_end'> | null | undefined,
   rangeEnd: string
): { open: boolean; days: number } | null {
   if (!w?.first_opened) return null;
   const from = dayStart(w.first_opened) as number;
   if (w.backlog_end > 0) {
      return { open: true, days: Math.round(((dayStart(rangeEnd) as number) + DAY - from) / DAY) };
   }
   if (!w.last_closed) return null;
   return { open: false, days: Math.round(((dayStart(w.last_closed) as number) - from) / DAY) };
}

/** How a project's plan turned out, judged today, for Look back: worst
 * last, since a retro reads what finished first. */
export type RetroPlanKind =
   | 'on_time'
   | 'late'
   | 'past_end'
   | 'open'
   | 'parked'
   | 'dropped'
   | 'none';
export const RETRO_PLAN_RANK: Record<RetroPlanKind, number> = {
   on_time: 0,
   late: 1,
   past_end: 2,
   open: 3,
   parked: 4,
   dropped: 5,
   none: 6,
};

/**
 * A plan's outcome in a few words: "done on time", "done 2 wk late",
 * "open, 3 wk past its end", "ends Oct 11", parked, dropped, or "no plan".
 * A plan's finish day is the day it was last changed, which is when it was
 * marked done unless someone edited it after.
 */
export function retroPlan(
   plan: Pick<RoadmapItem, 'status' | 'start' | 'weeks' | 'updated_at'> | null,
   today: string
): { kind: RetroPlanKind; text: string } {
   if (!plan) return { kind: 'none', text: 'no plan' };
   const end = planEnd(plan);
   const weeksAfter = (day: string) =>
      Math.ceil(((dayStart(day) as number) - (dayStart(end) as number)) / (7 * DAY));
   if (plan.status === 'done') {
      const late = plan.updated_at == null ? 0 : weeksAfter(utcDay(plan.updated_at));
      return late > 0
         ? { kind: 'late', text: `done ${late} wk late` }
         : { kind: 'on_time', text: 'done on time' };
   }
   if (plan.status === 'dropped') return { kind: 'dropped', text: 'dropped' };
   if (plan.status === 'parked') return { kind: 'parked', text: 'parked' };
   if (end < today) return { kind: 'past_end', text: `open, ${weeksAfter(today)} wk past its end` };
   return {
      kind: 'open',
      text: plan.start > today ? `starts ${dayWords(plan.start)}` : `ends ${dayWords(end)}`,
   };
}

/** A plan or project that finished in a range: on time by its plan's end,
 * late, or null with no plan to judge it by. */
export interface Finished {
   key: string;
   name: string;
   onTime: boolean | null;
}

/**
 * What finished in a range: plans marked done in it (by the day they were
 * last changed), and project issues closed as completed in it that no
 * finished plan already counts.
 */
export function finishedIn(
   plans: readonly RoadmapItem[],
   projects: readonly Project[],
   range: { start: string; end: string }
): Finished[] {
   const inRange = (day: string) => day >= range.start && day <= range.end;
   const out = new Map<string, Finished>();
   for (const plan of plans) {
      if (plan.status !== 'done' || plan.updated_at == null) continue;
      const day = utcDay(plan.updated_at);
      if (!inRange(day)) continue;
      const key = plan.project ?? `plan:${plan.id}`;
      out.set(key, { key, name: plan.name, onTime: day <= planEnd(plan) });
   }
   for (const p of projects) {
      if (p.state !== 'closed' || p.state_reason === 'not_planned' || !p.closed_at) continue;
      const day = p.closed_at.slice(0, 10);
      if (!inRange(day) || out.has(p.slug)) continue;
      const plan = planFor(p.slug, plans);
      out.set(p.slug, { key: p.slug, name: p.name, onTime: plan ? day <= planEnd(plan) : null });
   }
   return [...out.values()];
}
