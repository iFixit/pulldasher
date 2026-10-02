import { epoch } from '../format';
import type { PullData } from '../types';
import { issueKey } from './issueRef';
import type { DerivedPull } from './status';
import { MISC_SLUG, projectOf, projectSlugs } from './projectLabel';
import { prStage } from './stage';

export { MISC_SLUG, projectOf, projectSlugs } from './projectLabel';

/**
 * Projects: what the open PRs add up to. A PR joins a project through one
 * label, `<prefix><slug>` (`project:workbench`), or with no label by linking
 * one of the project's issues ("Parts of #N"), and a project's own record
 * is a GitHub issue carrying the same label: its title is the name, its
 * assignee the lead, its milestone the rough target, `parent:<slug>` labels
 * its parents (any number of them), and an `ongoing` label marks work with no
 * end. Open means live, closed as completed means done, closed as not planned
 * means dropped or merged into another project. A job outside Pulldasher
 * writes all of it; Pulldasher only reads what GitHub already has.
 *
 * Pure like the rest of shared/: the board runs these over the live socket
 * pulls, and the server runs the same functions behind /projects-data and
 * /api/v1/projects + /api/v1/people, so the tab and the API can't disagree.
 */

export const DEFAULT_PROJECT_PREFIX = 'project:';
export const PARENT_PREFIX = 'parent:';
export const ONGOING_LABEL = 'ongoing';
/** a merge this recent keeps a project on Today */
export const LIVE_DAYS = 14;
/** fewest PRs before "one person" is worth saying; below it, one author is normal */
export const ONE_PERSON_MIN_PRS = 3;

const DAY = 86400;

/** A project as its issue describes it: the wire shape /projects-data sends. */
export interface Project {
   slug: string;
   name: string;
   /** where the project's issue lives */
   repo: string;
   number: number;
   state: 'open' | 'closed';
   /** GitHub's close reason: 'completed' is done, 'not_planned' dropped or merged */
   state_reason: string | null;
   ongoing: boolean;
   parents: string[];
   lead: string | null;
   /** its milestone */
   target: { title: string; due_on: string | null } | null;
   /** GitHub's issue fields on it: the Start date and Target date days
    * (YYYY-MM-DD) and the Priority, lowercased; null for one not set */
   fields: { start: string | null; target: string | null; priority: string | null };
   /** when the issue was opened and closed (ISO); null when not known or open */
   created_at: string | null;
   closed_at: string | null;
}

/** A project's target: its issue's Target date field, which says it for
 * that one issue, or else its milestone. `title` is the milestone's, null
 * for a Target date. */
export interface ProjectTarget {
   title: string | null;
   due_on: string | null;
}
export function targetOf(
   p: Pick<Project, 'target' | 'fields'> | null | undefined
): ProjectTarget | null {
   if (p?.fields?.target) return { title: null, due_on: p.fields.target };
   return p?.target ?? null;
}

export type ProjectFlag = 'one_person' | 'waiting_on_review';

export interface ProjectGroup {
   slug: string;
   /** the project's issue; null when a label names a project that has no issue yet */
   project: Project | null;
   /** open PRs, oldest first */
   open: DerivedPull[];
   /** merged in the last LIVE_DAYS, newest first */
   merged: PullData[];
   /** everyone with an open or recently merged PR here, most PRs first */
   people: string[];
   /** days since the stalest open PR last changed; null with nothing open */
   idleDays: number | null;
   /** epoch secs of the newest PR update or merge; null with neither */
   lastActivity: number | null;
   flags: ProjectFlag[];
}

export interface Today {
   /** an open PR, or a merge in the last LIVE_DAYS on a project that isn't closed */
   live: ProjectGroup[];
   /** open projects with nothing in flight */
   quiet: ProjectGroup[];
   /** open PRs filed as one-offs */
   misc: DerivedPull[];
   /** open PRs in no project: no project label, and no project's issue linked */
   unsorted: DerivedPull[];
   /** open PRs in two projects: two project labels, or no label and issues of
    * two projects linked. Each counts under the first (projectOf). */
   doubleLabeled: DerivedPull[];
}

/** The projects each PR links, by issueKey of the PR: every project that has
 * an issue it links (by its label, by hand or by a link) or whose own issue
 * it links, sorted. What a PR with no project label joins (projectOf). The
 * server reads it off each issue's side (lib/work.js loadPullLinks). */
export type PullLinks = Readonly<Record<string, readonly string[]>>;

/** The day a group's earliest open PR opened, YYYY-MM-DD; null with none
 * open. Where Decide and the roadmap's chooser start a plan for work already
 * in flight. */
export function firstOpenDay(g: Pick<ProjectGroup, 'open'>): string | null {
   return g.open.map(p => p.data.created_at.slice(0, 10)).sort()[0] ?? null;
}

/** The name to show: the issue's title, or the bare slug before an issue exists. */
export function projectName(g: Pick<ProjectGroup, 'slug' | 'project'>): string {
   return g.project?.name ?? g.slug;
}

/**
 * Today: every project with work in flight, from the open PRs, the recently
 * merged ones (the server keeps LIVE_DAYS of them in memory), and the
 * project issues, each PR in its project by projectOf (`linked` says which
 * projects' issues it links). Pass people's PRs only; bots are the caller's
 * call.
 */
export function buildToday(
   projects: readonly Project[],
   open: readonly DerivedPull[],
   closed: readonly PullData[],
   prefix: string,
   now: number = Date.now() / 1000,
   linked: PullLinks = {}
): Today {
   const bySlug = new Map(projects.map(p => [p.slug, p]));
   const groups = new Map<string, ProjectGroup>();
   const group = (slug: string) => {
      let g = groups.get(slug);
      if (!g) {
         g = {
            slug,
            project: bySlug.get(slug) ?? null,
            open: [],
            merged: [],
            people: [],
            idleDays: null,
            lastActivity: null,
            flags: [],
         };
         groups.set(slug, g);
      }
      return g;
   };

   const today: Today = { live: [], quiet: [], misc: [], unsorted: [], doubleLabeled: [] };
   for (const p of open) {
      const slugs = projectSlugs(p.data.labels, prefix);
      const links = linked[issueKey(p.data)] ?? [];
      // a label settles it; with none, links to two projects' issues don't
      if (slugs.length > 1 || (!slugs.some(s => s !== MISC_SLUG) && links.length > 1)) {
         today.doubleLabeled.push(p);
      }
      const slug = projectOf(p.data.labels, prefix, links);
      if (slug == null) today.unsorted.push(p);
      else if (slug === MISC_SLUG) today.misc.push(p);
      else group(slug).open.push(p);
   }
   for (const p of closed) {
      if (!p.merged_at || now - epoch(p.merged_at) > LIVE_DAYS * DAY) continue;
      const slug = projectOf(p.labels, prefix, linked[issueKey(p)]);
      if (slug != null && slug !== MISC_SLUG) group(slug).merged.push(p);
   }
   // an open project with nothing in flight still exists: it lands in quiet
   for (const p of projects) if (p.state === 'open') group(p.slug);

   for (const g of groups.values()) {
      g.open.sort((a, b) => epoch(a.data.created_at) - epoch(b.data.created_at));
      g.merged.sort((a, b) => epoch(b.merged_at ?? '') - epoch(a.merged_at ?? ''));
      const prs = new Map<string, number>();
      for (const login of [
         ...g.open.map(p => p.data.user.login),
         ...g.merged.map(p => p.user.login),
      ])
         prs.set(login, (prs.get(login) ?? 0) + 1);
      g.people = [...prs.keys()].sort(
         (a, b) => (prs.get(b) ?? 0) - (prs.get(a) ?? 0) || a.localeCompare(b)
      );
      // real work only: updated_at moves on any label edit
      const updates = g.open.map(p => epoch(p.data.status?.activity_at ?? p.data.updated_at));
      g.idleDays = updates.length ? Math.floor((now - Math.min(...updates)) / DAY) : null;
      const activity = [...updates, ...g.merged.map(p => epoch(p.merged_at ?? ''))];
      g.lastActivity = activity.length ? Math.max(...activity) : null;
   }

   // a closed project only stays on Today while a PR is still open in it;
   // its recent merges alone are a finished project's receipt
   const isLive = (g: ProjectGroup) =>
      g.open.length > 0 || (g.merged.length > 0 && g.project?.state !== 'closed');
   today.live = [...groups.values()].filter(isLive);
   today.quiet = [...groups.values()].filter(g => !isLive(g) && g.project?.state === 'open');

   for (const g of today.live) {
      if (g.people.length === 1 && g.open.length + g.merged.length >= ONE_PERSON_MIN_PRS)
         g.flags.push('one_person');
      // by the project page's stage rule, so the flag and its list agree
      if (g.open.length >= 2 && g.open.every(p => prStage(p) === 'review'))
         g.flags.push('waiting_on_review');
   }

   const byName = (a: ProjectGroup, b: ProjectGroup) => projectName(a).localeCompare(projectName(b));
   const byRecent = (a: ProjectGroup, b: ProjectGroup) =>
      (b.lastActivity ?? 0) - (a.lastActivity ?? 0);
   today.live.sort((a, b) => b.open.length - a.open.length || byRecent(a, b) || byName(a, b));
   today.quiet.sort((a, b) => byRecent(a, b) || byName(a, b));
   return today;
}

/** One PR's lifetime, the unit the window counts are built from (epoch secs). */
export interface PullSpan {
   author: string;
   /** its project by projectOf (misc included); null when it's in none */
   project: string | null;
   opened: number;
   /** when it merged or closed; null while open */
   closed: number | null;
   merged: boolean;
}

/** One CR or QA stamp, for counting who reviews whose work. */
export interface ReviewSpan {
   reviewer: string;
   /** who wrote the PR the stamp is on */
   author: string;
   /** epoch secs the stamp was given */
   at: number;
}

export interface WindowCounts {
   /** open at the start of the first day */
   backlog_start: number;
   /** open at the end of the last day */
   backlog_end: number;
   opened: number;
   merged: number;
   /** closed without merging */
   closed: number;
   /** median age in days of the PRs open at each end; null with none open */
   median_age_start_days: number | null;
   median_age_end_days: number | null;
   /** median days from opened to merged, over the PRs merged in the window */
   median_days_to_merge: number | null;
   /** distinct people with a PR in the window: on a developer team, or not */
   developers: number;
   non_developers: number;
}

export interface ProjectWindow extends WindowCounts {
   /** the day its earliest PR in the window opened, which can be before the window */
   first_opened: string | null;
   /** the day of its latest merge or close in the window; null with none */
   last_closed: string | null;
}

export interface PersonWindow extends WindowCounts {
   /** projects this person had a PR in during the window, misc left out */
   projects: string[];
   /** their developer team from config; null for everyone else */
   team: string | null;
   /** CR and QA stamps they gave in the window, on other people's PRs */
   reviews: number;
   /** of those, stamps on a non-developer's PR */
   reviews_on_non_dev: number;
}

export interface DayPoint {
   /** a UTC day, YYYY-MM-DD */
   date: string;
   /** the backlog at the start plus everything opened through this day */
   arrived: number;
   /** everything merged or closed through this day */
   departed: number;
   /** open at the end of this day: arrived minus departed */
   backlog: number;
}

/** One week of the window, Monday first; the first and last can be partial. */
export interface WeekPoint {
   /** the Monday that starts it, YYYY-MM-DD */
   week: string;
   opened: { developers: number; non_developers: number };
   merged: { developers: number; non_developers: number };
   /** merged PRs by project slug (misc included); '' for those in no project */
   merged_by_project: Record<string, number>;
   /** stamps given that week, by who wrote the PR */
   reviews: { on_developers: number; on_non_developers: number };
}

export interface WindowStats {
   /** first and last UTC day of the window, both counted */
   start: string;
   end: string;
   totals: WindowCounts;
   /** by project slug, misc included */
   projects: Record<string, ProjectWindow>;
   /** PRs in no project */
   unsorted: WindowCounts;
   people: Record<string, PersonWindow>;
   /** one point per day, for the backlog chart */
   days: DayPoint[];
   /** one point per week, for the charts that split work by project or by who did it */
   weeks: WeekPoint[];
}

export interface WindowOptions {
   /** a developer's team, from config; null for anyone else. Default: nobody is a developer. */
   teamOf?: (login: string) => string | null;
   /** CR and QA stamps to count; the caller leaves out bots and bots' PRs */
   reviews?: readonly ReviewSpan[];
}

/** Epoch secs at the start of a YYYY-MM-DD UTC day, or null if it isn't one. */
export function dayStart(date: string): number | null {
   if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
   const ms = Date.parse(`${date}T00:00:00Z`);
   // Date.parse rolls impossible days over (Feb 30 is March 2), so compare back
   return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== date ? null : ms / 1000;
}

/** The YYYY-MM-DD UTC day an epoch-secs instant falls on. */
export function utcDay(epochSecs: number): string {
   return new Date(epochSecs * 1000).toISOString().slice(0, 10);
}

interface Tally {
   counts: Omit<
      WindowCounts,
      | 'median_age_start_days'
      | 'median_age_end_days'
      | 'median_days_to_merge'
      | 'developers'
      | 'non_developers'
   >;
   agesStart: number[];
   agesEnd: number[];
   toMerge: number[];
   authors: Set<string>;
}

const tally = (): Tally => ({
   counts: { backlog_start: 0, backlog_end: 0, opened: 0, merged: 0, closed: 0 },
   agesStart: [],
   agesEnd: [],
   toMerge: [],
   authors: new Set(),
});

function median(xs: number[]): number | null {
   if (!xs.length) return null;
   const s = [...xs].sort((a, b) => a - b);
   const mid = Math.floor(s.length / 2);
   const m = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
   return Math.round(m * 10) / 10;
}

/**
 * Backlog and throughput for the UTC days `start` through `end`, overall, per
 * project and per person, plus a point per day and per week for the charts.
 * Every bucket satisfies backlog_start + opened - merged - closed =
 * backlog_end, the check the history rebuild used. A PR is counted under its
 * project now (projectOf: its label, else the issues it links), which is
 * exact unless it moved between projects.
 * Pass people's PRs only, and a valid start <= end. With `teamOf`, people
 * split into developers (on a team in config) and everyone else; with
 * `reviews`, each person's stamps given in the window are counted too.
 */
export function windowStats(
   spans: readonly PullSpan[],
   start: string,
   end: string,
   { teamOf = () => null, reviews = [] }: WindowOptions = {}
): WindowStats {
   const from = dayStart(start) ?? 0;
   const to = (dayStart(end) ?? from) + DAY;
   const dayCount = Math.max(1, Math.round((to - from) / DAY));
   const isDev = (login: string) => teamOf(login) != null;
   const totals = tally();
   const unsorted = tally();
   const projects = new Map<string, Tally & { first: number; last: number | null }>();
   const people = new Map<string, { t: Tally; projects: Set<string>; reviews: number; onNonDev: number }>();
   const person = (login: string) => {
      let p = people.get(login);
      if (!p) {
         p = { t: tally(), projects: new Set(), reviews: 0, onNonDev: 0 };
         people.set(login, p);
      }
      return p;
   };
   const openedOn = new Array<number>(dayCount).fill(0);
   const departedOn = new Array<number>(dayCount).fill(0);
   // weeks start on the Monday on or before the first day
   const monday = from - ((new Date(from * 1000).getUTCDay() + 6) % 7) * DAY;
   const weeks: WeekPoint[] = Array.from(
      { length: Math.max(1, Math.ceil((to - monday) / (7 * DAY))) },
      (_, i) => ({
         week: utcDay(monday + i * 7 * DAY),
         opened: { developers: 0, non_developers: 0 },
         merged: { developers: 0, non_developers: 0 },
         merged_by_project: {},
         reviews: { on_developers: 0, on_non_developers: 0 },
      })
   );
   const weekOf = (t: number) => weeks[Math.floor((t - monday) / (7 * DAY))];

   for (const s of spans) {
      // skip PRs that never overlapped the window
      if (s.opened >= to || (s.closed != null && s.closed < from)) continue;
      const openAt = (t: number) => s.opened < t && (s.closed == null || s.closed >= t);
      const openedIn = s.opened >= from;
      const departedIn = s.closed != null && s.closed < to;
      const group = isDev(s.author) ? 'developers' : 'non_developers';
      let byProject: Tally = unsorted;
      if (s.project != null) {
         let p = projects.get(s.project);
         if (!p) {
            p = { ...tally(), first: s.opened, last: null };
            projects.set(s.project, p);
         }
         p.first = Math.min(p.first, s.opened);
         if (departedIn) p.last = Math.max(p.last ?? 0, s.closed as number);
         byProject = p;
      }
      const who = person(s.author);
      if (s.project != null && s.project !== MISC_SLUG) who.projects.add(s.project);
      for (const t of [totals, byProject, who.t]) {
         t.authors.add(s.author);
         if (openAt(from)) {
            t.counts.backlog_start++;
            t.agesStart.push((from - s.opened) / DAY);
         }
         if (openAt(to)) {
            t.counts.backlog_end++;
            t.agesEnd.push((to - s.opened) / DAY);
         }
         if (openedIn) t.counts.opened++;
         if (departedIn) {
            if (s.merged) {
               t.counts.merged++;
               t.toMerge.push(((s.closed as number) - s.opened) / DAY);
            } else t.counts.closed++;
         }
      }
      if (openedIn) {
         openedOn[Math.floor((s.opened - from) / DAY)]++;
         weekOf(s.opened).opened[group]++;
      }
      if (departedIn) {
         departedOn[Math.floor(((s.closed as number) - from) / DAY)]++;
         if (s.merged) {
            const w = weekOf(s.closed as number);
            w.merged[group]++;
            const key = s.project ?? '';
            w.merged_by_project[key] = (w.merged_by_project[key] ?? 0) + 1;
         }
      }
   }

   for (const r of reviews) {
      if (r.at < from || r.at >= to || r.reviewer === r.author) continue;
      const who = person(r.reviewer);
      const onDev = isDev(r.author);
      who.reviews++;
      if (!onDev) who.onNonDev++;
      weekOf(r.at).reviews[onDev ? 'on_developers' : 'on_non_developers']++;
   }

   const finish = ({ counts, agesStart, agesEnd, toMerge, authors }: Tally): WindowCounts => {
      const devs = [...authors].filter(isDev).length;
      return {
         ...counts,
         median_age_start_days: median(agesStart),
         median_age_end_days: median(agesEnd),
         median_days_to_merge: median(toMerge),
         developers: devs,
         non_developers: authors.size - devs,
      };
   };

   let arrived = totals.counts.backlog_start;
   let departed = 0;
   const days = openedOn.map((opened, i) => {
      arrived += opened;
      departed += departedOn[i];
      return { date: utcDay(from + i * DAY), arrived, departed, backlog: arrived - departed };
   });

   return {
      start,
      end,
      totals: finish(totals),
      projects: Object.fromEntries(
         [...projects].map(([slug, p]) => [
            slug,
            {
               ...finish(p),
               first_opened: utcDay(p.first),
               last_closed: p.last == null ? null : utcDay(p.last),
            },
         ])
      ),
      unsorted: finish(unsorted),
      people: Object.fromEntries(
         [...people].map(([login, p]) => [
            login,
            {
               ...finish(p.t),
               projects: [...p.projects].sort(),
               team: teamOf(login),
               reviews: p.reviews,
               reviews_on_non_dev: p.onNonDev,
            },
         ])
      ),
      days,
      weeks,
   };
}
