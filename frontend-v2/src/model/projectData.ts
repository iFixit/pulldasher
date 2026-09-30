import { useEffect, useState } from 'react';
import { isDummy, loadDummy } from '../backend/dummy';
import { DUMMY_PROJECTS, DUMMY_TEAMS } from '../backend/dummyProjects';
import { epoch } from '../../../shared/format';
import {
   dayStart,
   projectOf,
   utcDay,
   windowStats,
   type Project,
   type PullSpan,
   type ReviewSpan,
   type WindowStats,
} from '../../../shared/model/projects';
import { isSuffixBot } from '../../../shared/model/visibility';

/**
 * The Projects tab's server data: the project issues and one window's
 * numbers, from GET /projects-data. Only what the socket doesn't carry: Today
 * itself is built from the live socket pulls.
 */

export interface ProjectsData {
   label_prefix: string;
   projects_repo: string | null;
   projects: Project[];
   /** developer teams from the server's config: team name to logins.
    * Anyone not listed is a non-developer. */
   teams: Record<string, string[]>;
   window: WindowStats;
}

/** A login's developer team, or null for a non-developer. GitHub logins
 * compare case-insensitively, as on GitHub. */
export function teamLookup(teams: Record<string, string[]>): (login: string) => string | null {
   const byLogin = new Map<string, string>();
   for (const [team, logins] of Object.entries(teams))
      for (const login of logins) byLogin.set(login.toLowerCase(), team);
   return login => byLogin.get(login.toLowerCase()) ?? null;
}

const DAY = 86400;
/** the server's cap on one window (lib/projects.js MAX_WINDOW_DAYS) */
export const MAX_RANGE_DAYS = 400;

/** The presets a date picker in any analytics tool offers, in its order. */
export const RANGE_PRESETS: [string, string][] = [
   ['7d', 'Last 7 days'],
   ['30d', 'Last 30 days'],
   ['90d', 'Last 90 days'],
   ['month', 'This month'],
   ['last-month', 'Last month'],
   ['quarter', 'This quarter'],
   ['last-quarter', 'Last quarter'],
   ['ytd', 'Year to date'],
];
export { DEFAULT_RANGE } from '../lens';

export interface Range {
   /** first and last day, both counted */
   start: string;
   end: string;
}

/** A local Date's calendar day, YYYY-MM-DD. */
export function dayOf(date: Date): string {
   const m = String(date.getMonth() + 1).padStart(2, '0');
   const d = String(date.getDate()).padStart(2, '0');
   return `${date.getFullYear()}-${m}-${d}`;
}

/** A YYYY-MM-DD day in words, "Sep 22", read as UTC so it never shifts a
 * day. Milestone due dates go through here as their UTC day, the way the
 * board has always shown them (StatePopover, the CSV). */
export function dayWords(day: string): string {
   return new Date(`${day.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
   });
}

/** A YYYY-MM-DD day as a local Date at midnight, for the calendar. */
export function dateOf(day: string): Date {
   const [y, m, d] = day.split('-').map(Number);
   return new Date(y, m - 1, d);
}

/** How many days a range covers, both ends counted. */
export function rangeDays({ start, end }: Range): number {
   return Math.round(((dayStart(end) as number) - (dayStart(start) as number)) / DAY) + 1;
}

/** The same number of days just before a range: what a tile compares with. */
export function previousRange(range: Range): Range {
   const n = rangeDays(range);
   const end = (dayStart(range.start) as number) - DAY;
   return { start: utcDay(end - (n - 1) * DAY), end: utcDay(end) };
}

/**
 * A range key's days. Presets count calendar days where the reader is, so
 * "Last 30 days" ends on the day their own calendar shows; the server counts
 * the same labels as UTC days, a few hours off at each edge. A custom key is
 * `YYYY-MM-DD..YYYY-MM-DD`. Null for anything else, including a window the
 * server would refuse (more than 400 days).
 */
export function resolveRange(key: string, now: number = Date.now() / 1000): Range | null {
   const t = new Date(now * 1000);
   const [y, m, d] = [t.getFullYear(), t.getMonth(), t.getDate()];
   const today = dayOf(t);
   const q = Math.floor(m / 3) * 3;
   const lastDays = /^(\d+)d$/.exec(key);
   if (lastDays) {
      const n = Number(lastDays[1]);
      if (n < 1 || n > MAX_RANGE_DAYS) return null;
      return { start: dayOf(new Date(y, m, d - (n - 1))), end: today };
   }
   switch (key) {
      case 'month':
         return { start: dayOf(new Date(y, m, 1)), end: today };
      case 'last-month':
         return { start: dayOf(new Date(y, m - 1, 1)), end: dayOf(new Date(y, m, 0)) };
      case 'quarter':
         return { start: dayOf(new Date(y, q, 1)), end: today };
      case 'last-quarter':
         return { start: dayOf(new Date(y, q - 3, 1)), end: dayOf(new Date(y, q, 0)) };
      case 'ytd':
         return { start: dayOf(new Date(y, 0, 1)), end: today };
   }
   const custom = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(key);
   if (custom) {
      const [, start, end] = custom;
      const from = dayStart(start);
      const to = dayStart(end);
      if (from == null || to == null || from > to || (to - from) / DAY + 1 > MAX_RANGE_DAYS)
         return null;
      return { start, end };
   }
   return null;
}

/** "Last 30 days" for a preset, "Custom range" for anything picked by hand. */
export function rangeName(key: string): string {
   return RANGE_PRESETS.find(([k]) => k === key)?.[1] ?? 'Custom range';
}

/** "Aug 31 to Sep 29", with the year only when the range leaves this one. */
export function rangeWords({ start, end }: Range, now: number = Date.now() / 1000): string {
   const thisYear = String(new Date(now * 1000).getFullYear());
   const word = (day: string) =>
      dateOf(day).toLocaleDateString(undefined, {
         month: 'short',
         day: 'numeric',
         year: day.slice(0, 4) === thisYear ? undefined : 'numeric',
      });
   return start === end ? word(start) : `${word(start)} to ${word(end)}`;
}

/** A trend wants more days than the numbers do, so a chart never shows less. */
export const CHART_MIN_DAYS = 90;

/**
 * The days a chart draws for a picked range: the range itself, stretched back
 * to CHART_MIN_DAYS so a short range still shows its trend. The charts dim the
 * days outside the range, so the numbers' days stay the bright part.
 */
export function chartWindow(range: Range): Range {
   const earliest = utcDay((dayStart(range.end) as number) - (CHART_MIN_DAYS - 1) * DAY);
   return { start: range.start < earliest ? range.start : earliest, end: range.end };
}

// the dummy board has no server: run the real windowStats over its own
// pulls, with their sign-offs standing in for the review history
async function dummyData({ start, end }: Range, project: string | null): Promise<ProjectsData> {
   const { pulls, bots, projectLabelPrefix } = await loadDummy();
   const prefix = projectLabelPrefix ?? 'project:';
   const people = pulls.filter(
      p =>
         !isSuffixBot(p.user.login) &&
         !(bots ?? []).includes(p.user.login) &&
         (project == null || projectOf(p.labels, prefix) === project)
   );
   const spans: PullSpan[] = people.map(p => ({
      author: p.user.login,
      project: projectOf(p.labels, prefix),
      opened: epoch(p.created_at),
      closed: p.closed_at ? epoch(p.closed_at) : null,
      merged: !!p.merged_at,
   }));
   const reviews: ReviewSpan[] = people.flatMap(p =>
      [...p.status.allCR, ...p.status.allQA].map(sig => ({
         reviewer: sig.data.user.login,
         author: p.user.login,
         at: epoch(sig.data.created_at),
      }))
   );
   return {
      label_prefix: prefix,
      projects_repo: 'iFixit/projects',
      projects: DUMMY_PROJECTS,
      teams: DUMMY_TEAMS,
      window: windowStats(spans, start, end, { teamOf: teamLookup(DUMMY_TEAMS), reviews }),
   };
}

function load(range: Range, project: string | null): Promise<ProjectsData | null> {
   if (isDummy()) return dummyData(range, project);
   const query = new URLSearchParams({ start: range.start, end: range.end });
   if (project != null) query.set('project', project);
   return fetch(`/projects-data?${query}`)
      .then(r => (r.ok ? (r.json() as Promise<ProjectsData>) : null))
      .catch(() => null);
}

// one fetch per window, reused for 5 minutes: switching tabs and back, or the
// range view and Today asking for the same window, costs nothing
const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; data: Promise<ProjectsData | null> }>();

/**
 * One window's projects data, or one project's with `project`: undefined
 * while it loads, null if the fetch failed (the caller says so and moves on).
 * A failure isn't cached, so the next mount tries again.
 */
export function useProjectsData(
   range: Range | null,
   project: string | null = null
): ProjectsData | null | undefined {
   const key = range ? `${range.start}..${range.end}:${project ?? ''}` : '';
   const [got, setGot] = useState<{ key: string; data: ProjectsData | null }>();
   useEffect(() => {
      if (!range) return;
      let hit = cache.get(key);
      if (!hit || Date.now() - hit.at > TTL_MS) {
         hit = { at: Date.now(), data: load(range, project) };
         cache.set(key, hit);
      }
      let live = true;
      hit.data.then(data => {
         if (data == null) cache.delete(key);
         if (live) setGot({ key, data });
      });
      return () => {
         live = false;
      };
      // keyed on the days, not the range object, which callers rebuild
      // every render
   }, [key]);
   return got && got.key === key ? got.data : undefined;
}
