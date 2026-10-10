import { n } from '../../../shared/format';
import {
   dayStart,
   MISC_SLUG,
   utcDay,
   type Project,
   type ProjectWindow,
} from '../../../shared/model/projects';
import {
   addWeeks,
   endOf,
   mondayOf,
   planEnd,
   planFor,
   type RoadmapItem,
} from '../../../shared/model/roadmap';
import { dayWords, type Range } from './projectData';
import type { RetroData, RetroPr } from './retroData';
import { durationWords } from './stage';
import { NO_PLAN, pastEnd } from './words';

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

/** Rows grouped one way: the days, and who spent them on which PRs, most
 * first. */
export interface RetroGroup {
   key: string;
   days: number;
   people: [string, number][];
   prs: [RetroPr, number][];
}

export function groupRows(
   rows: readonly RetroRow[],
   keyOf: (row: RetroRow) => string
): RetroGroup[] {
   const groups = new Map<
      string,
      { days: number; people: Map<string, number>; prs: Map<RetroPr, number> }
   >();
   for (const row of rows) {
      const key = keyOf(row);
      let g = groups.get(key);
      if (!g) {
         g = { days: 0, people: new Map(), prs: new Map() };
         groups.set(key, g);
      }
      g.days += row.days;
      g.people.set(row.login, (g.people.get(row.login) ?? 0) + row.days);
      g.prs.set(row.pr, (g.prs.get(row.pr) ?? 0) + row.days);
   }
   const most = <T>(m: Map<T, number>) => [...m].sort((a, b) => b[1] - a[1]);
   return [...groups]
      .map(([key, g]) => ({
         key,
         days: g.days,
         people: most(g.people),
         prs: most(g.prs),
      }))
      .sort((a, b) => b.days - a.days || a.key.localeCompare(b.key));
}

/**
 * A week as the charts draw it: its Monday, how many of its seven days the
 * chart's days hold (fewer only at either end, as for this week so far), how
 * many of those the picked range counts, and whether it ends before the
 * range, which the charts draw paler.
 */
export interface ChartWeek {
   week: string;
   days: number;
   /** all of `days` inside the range, none before it, and some for the
    * week the range starts in, whose earlier days the charts draw paler */
   counted: number;
   before: boolean;
}

/** Days from one day to another, both counted; 0 when `to` comes first. */
const daysFrom = (from: string, to: string) =>
   to < from ? 0 : Math.round(((dayStart(to) as number) - (dayStart(from) as number)) / DAY) + 1;

/** One Monday's week against the days a chart covers and the picked range.
 * With no days given, the week counts whole. */
export function chartWeek(week: string, shown?: Range, picked?: Range): ChartWeek {
   const sunday = utcDay((dayStart(week) as number) + 6 * DAY);
   const from = shown && shown.start > week ? shown.start : week;
   const to = shown && shown.end < sunday ? shown.end : sunday;
   const days = daysFrom(from, to);
   return {
      week,
      days,
      counted: picked
         ? daysFrom(picked.start > from ? picked.start : from, picked.end < to ? picked.end : to)
         : days,
      before: !!picked && sunday < picked.start,
   };
}

/**
 * "Week of Sep 28", and how much of it a bar counts: "4 of 7 days" where
 * the chart's days stop, "5 of 7 days in the range" for the week the range
 * starts in, and "before the range" for a paler week.
 */
export function weekTitle(w: ChartWeek): string {
   const head = `Week of ${dayWords(w.week)}`;
   if (w.before) return `${head}${w.days < 7 ? `, ${w.days} of 7 days` : ''}, before the range`;
   if (w.counted < w.days) return `${head}, ${w.counted} of 7 days in the range`;
   return w.days < 7 ? `${head}, ${w.days} of 7 days` : head;
}

/** A week's Monday in words; `dayWords` adds the year when that isn't this
 * one, so a year-long chart's first week can't read as this year's. */
export function weekWords(week: string, now: number = Date.now() / 1000): string {
   return dayWords(week, { now: now * 1000 });
}

/** A row's bars, week by week: what the picked range counts, drawn in full,
 * and the days before the range, drawn paler. */
export interface WeekBars {
   counted: number[];
   before: number[];
}

/**
 * Each week's number split at the picked range's start. `whole` counts every
 * day the chart holds; `inRange` only the range's days (the range's own
 * numbers), so the week the range starts in splits in two instead of
 * counting its days before the range as the range's. Without `inRange`, that
 * week counts whole.
 */
export function weekBars(
   whole: readonly number[] | undefined,
   inRange: readonly number[] | undefined,
   weeks: readonly ChartWeek[]
): WeekBars {
   const counted = weeks.map((w, i) => (w.before ? 0 : (inRange ?? whole)?.[i] ?? 0));
   const before = weeks.map((w, i) =>
      w.before
         ? whole?.[i] ?? 0
         : w.counted < w.days
         ? Math.max(0, (whole?.[i] ?? 0) - counted[i])
         : 0
   );
   return { counted, before };
}

/** Every week a chart draws for its days, the empty ones too, oldest first:
 * the bars keep their place in time however few weeks had any work. */
export function chartWeeks(shown: Range, picked: Range): ChartWeek[] {
   const weeks: ChartWeek[] = [];
   for (let w = mondayOf(shown.start); w <= shown.end; w = addWeeks(w, 1)) {
      weeks.push(chartWeek(w, shown, picked));
   }
   return weeks;
}

/** Each group's days in each of `weeks`, zeros included. The rows come from
 * `data` and land in the week their Monday names. */
export function weeklyBy(
   rows: readonly RetroRow[],
   keyOf: (row: RetroRow) => string,
   data: Pick<RetroData, 'weeks'>,
   weeks: readonly ChartWeek[]
): Map<string, number[]> {
   const at = new Map(weeks.map((w, i) => [w.week, i]));
   const out = new Map<string, number[]>();
   for (const row of rows) {
      const i = at.get(data.weeks[row.week]);
      if (i === undefined) continue;
      const key = keyOf(row);
      const list = out.get(key) ?? weeks.map(() => 0);
      out.set(key, list);
      list[i] += row.days;
   }
   return out;
}

/** A filed project: a real one, not one-offs (misc) and not unlabeled. */
const filedProject = (row: RetroRow) =>
   row.pr.project != null && row.pr.project !== MISC_SLUG ? row.pr.project : null;

/** How spread out each person was: the median, over the weeks they worked,
 * of how many different filed projects they touched that week. PRs with no
 * project (and one-offs) don't count here; Not in a project says how much
 * went to them. */
export function spreadByPerson(rows: readonly RetroRow[]): Map<string, number> {
   const seen = new Map<string, Map<number, Set<string>>>();
   for (const row of rows) {
      const weeks = seen.get(row.login) ?? new Map<number, Set<string>>();
      seen.set(row.login, weeks);
      const things = weeks.get(row.week) ?? new Set<string>();
      weeks.set(row.week, things);
      const slug = filedProject(row);
      if (slug) things.add(slug);
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

/** fewest filed projects they wrote for, in a window, that ever reads as
 * overloaded */
export const OVERLOAD_MIN = 4;

/**
 * How many filed projects someone wrote PRs for in a window make them
 * overloaded: at least OVERLOAD_MIN, and at least twice the median across
 * developers (zeros included). Reviewing doesn't count: a reviewer is spread
 * by the job. Relative on purpose: while most PRs aren't filed yet, a fixed
 * number would flag more people each week as filing catches up.
 */
export function overloadLine(counts: readonly number[]): number {
   return Math.max(OVERLOAD_MIN, Math.ceil(2 * median(counts)));
}

/** Who reads as overloaded: wrote for `line` or more filed projects, most
 * first. Nobody when more than a quarter would: then the flag picks out no
 * one, and the tile says how many cross (tooManyWords). */
export function overloaded<T extends Pick<PersonLoad, 'login' | 'wrote'>>(
   loads: readonly T[],
   line: number
): T[] {
   if (tooManyWords(loads, line)) return [];
   return loads
      .filter(l => l.wrote >= line)
      .sort((a, b) => b.wrote - a.wrote || a.login.localeCompare(b.login));
}

/** When too many cross the line for `overloaded` to single them out, how
 * many do: "6 of 23 wrote for 4 or more", so a tile never reads as nobody.
 * Null when the flag names them, or nobody crosses. */
export function tooManyWords(
   loads: readonly Pick<PersonLoad, 'wrote'>[],
   line: number
): string | null {
   const over = loads.filter(l => l.wrote >= line).length;
   return over * 4 > loads.length ? `${over} of ${loads.length} wrote for ${line} or more` : null;
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
 * and for how many days since `openSince` (its oldest open PR, firstOpenDay)
 * or else its first PR in the range opened; or done,
 * and how many days from that first PR to its last merge or close. Null
 * with no numbers for the range. It counts the days gone by, not the days
 * touched, as the Overview counts a project's age, so the two say the same.
 */
export function projectLength(
   w: Pick<ProjectWindow, 'first_opened' | 'last_closed' | 'backlog_end'> | null | undefined,
   rangeEnd: string,
   openSince?: string | null
): { open: boolean; days: number } | null {
   if (!w?.first_opened) return null;
   const from = dayStart(w.first_opened) as number;
   if (w.backlog_end > 0) {
      // still open: from its oldest open PR when known, the day every pane says
      const since = (openSince && dayStart(openSince)) || from;
      return { open: true, days: Math.round(((dayStart(rangeEnd) as number) - since) / DAY) };
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
 * A plan's outcome in a few words: "Done on time", "Done 2 weeks late",
 * "3 weeks past its end", "Ends Oct 11", parked, dropped, or "No plan".
 * A plan's finish day is the day it was marked done (status_at), whatever
 * edits came after; a plan saved before status_at existed falls back to its
 * last change. Only a hard end passed is `past_end`, owed a call: a soft one
 * passed says so as a plain fact, and ongoing work has no end to judge by.
 */
export function retroPlan(
   plan: Pick<
      RoadmapItem,
      'status' | 'start' | 'weeks' | 'end_kind' | 'updated_at' | 'status_at'
   > | null,
   today: string
): { kind: RetroPlanKind; text: string } {
   if (!plan) return { kind: 'none', text: NO_PLAN };
   if (plan.end_kind === 'ongoing') {
      if (plan.status === 'done') return { kind: 'on_time', text: 'Done' };
      if (plan.status === 'dropped' || plan.status === 'parked') {
         return { kind: plan.status, text: plan.status === 'dropped' ? 'Dropped' : 'Parked' };
      }
      return { kind: 'open', text: 'Ongoing' };
   }
   const end = planEnd(plan);
   const weeksAfter = (day: string) =>
      Math.ceil(((dayStart(day) as number) - (dayStart(end) as number)) / (7 * DAY));
   if (plan.status === 'done') {
      // from when it was marked done, not its last edit
      const at = plan.status_at ?? plan.updated_at;
      const late = at == null ? 0 : weeksAfter(utcDay(at));
      return late > 0
         ? { kind: 'late', text: `Done ${n(late, 'week')} late` }
         : { kind: 'on_time', text: 'Done on time' };
   }
   if (plan.status === 'dropped') return { kind: 'dropped', text: 'Dropped' };
   if (plan.status === 'parked') return { kind: 'parked', text: 'Parked' };
   if (end < today) {
      return {
         kind: plan.end_kind === 'hard' ? 'past_end' : 'open',
         text: pastEnd(weeksAfter(today), plan.end_kind),
      };
   }
   return {
      kind: 'open',
      text: plan.start > today ? `Starts ${dayWords(plan.start)}` : `Ends ${dayWords(end)}`,
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
 * marked so), and project issues closed as completed in it that no
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
      const at = plan.status_at ?? plan.updated_at;
      if (plan.status !== 'done' || at == null) continue;
      const day = utcDay(at);
      if (!inRange(day)) continue;
      const key = plan.project ?? `plan:${plan.id}`;
      out.set(key, { key, name: plan.name, onTime: day <= (endOf(plan) ?? day) });
   }
   for (const p of projects) {
      if (p.state !== 'closed' || p.state_reason === 'not_planned' || !p.closed_at) continue;
      const day = p.closed_at.slice(0, 10);
      if (!inRange(day) || out.has(p.slug)) continue;
      const plan = planFor(p.slug, plans);
      out.set(p.slug, {
         key: p.slug,
         name: p.name,
         // ongoing work has no end to finish late by
         onTime: plan ? day <= (endOf(plan) ?? day) : null,
      });
   }
   return [...out.values()];
}

/** What finished, narrowed to the projects these rows spent days on: a
 * team's or a person's finished plans are the ones they worked on. */
export function finishedOn(finished: readonly Finished[], rows: readonly RetroRow[]): Finished[] {
   const worked = new Set(rows.map(r => r.pr.project));
   return finished.filter(f => worked.has(f.key));
}

/** What a comparison compares with: "30 days before", or "day before" for
 * one day, so a note reads "1 more than the day before". */
export function beforeWords(rangeDays: number): string {
   return rangeDays === 1 ? 'day before' : `${rangeDays} days before`;
}

/** How quickly the merged PRs merged, said after their count ("16 merged,
 * half of them within about 7 hours of opening"): half of several merged
 * within the median, and one merged PR has only its own time. Null with
 * none merged. */
export function mergeSpeed(merged: number, medianDays: number | null): string | null {
   if (!merged || medianDays == null) return null;
   return merged === 1
      ? `${durationWords(medianDays)} after it opened`
      : `half of them within ${durationWords(medianDays)} of opening`;
}

/**
 * A spreadsheet cell: quoted when it holds a comma, a quote or a line break,
 * and a title that starts like a formula (=, +, -, @) gets a leading
 * apostrophe, since a PR's title is anyone's text and a sheet would run it.
 */
function csvCell(value: string | number): string {
   const text =
      typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value);
   return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The rows as CSV: one line per person, PR and week, so a sheet can split
 * the days any way the page doesn't. */
export function retroCsv(
   rows: readonly RetroRow[],
   data: Pick<RetroData, 'weeks'>,
   teamOf: (login: string) => string | null,
   nameOf: (slug: string) => string
): string {
   const head = [
      'Week of',
      'Person',
      'Team',
      'Writing or reviewing',
      'Days',
      'PR',
      'Title',
      'Project',
   ];
   const lines = rows.map(r => [
      data.weeks[r.week],
      r.login,
      teamOf(r.login) ?? '',
      r.own ? 'writing' : 'reviewing',
      r.days,
      `${r.pr.repo}#${r.pr.number}`,
      r.pr.title,
      r.pr.project ? nameOf(r.pr.project) : '',
   ]);
   return [head, ...lines].map(l => l.map(csvCell).join(',')).join('\n') + '\n';
}
