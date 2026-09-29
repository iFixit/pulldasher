import { epoch } from '../format';
import type { Label, PullData } from '../types';
import type { DerivedPull, Status } from './status';

/**
 * Projects: what the open PRs add up to. A PR joins a project through one
 * label, `<prefix><slug>` (`project:workbench`), and a project's own record
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
/** the slug for one-off PRs that fit no project */
export const MISC_SLUG = 'misc';
/** a merge this recent keeps a project on Today */
export const LIVE_DAYS = 14;
/** fewest PRs before "one person" is worth saying; below it, one author is normal */
export const ONE_PERSON_MIN_PRS = 3;
/** other live projects a lead can be on before the lead reads as spread thin */
export const LEAD_SPREAD_MIN = 3;

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
   target: { title: string; due_on: string | null } | null;
}

/** Every project slug a PR's labels name, sorted so every reader agrees. */
export function projectSlugs(labels: readonly Pick<Label, 'title'>[], prefix: string): string[] {
   return labels
      .filter(l => l.title.startsWith(prefix) && l.title.length > prefix.length)
      .map(l => l.title.slice(prefix.length))
      .sort();
}

/** A PR's project: a real project before misc when it carries both, else
 * the first label alphabetically; null with no project label at all. */
export function projectOf(labels: readonly Pick<Label, 'title'>[], prefix: string): string | null {
   const slugs = projectSlugs(labels, prefix);
   return slugs.find(s => s !== MISC_SLUG) ?? slugs[0] ?? null;
}

export type ProjectFlag = 'one_person' | 'waiting_on_review' | 'lead_spread' | 'issue_closed';

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
   /** open PRs with no project label yet */
   unsorted: DerivedPull[];
   /** open PRs carrying more than one project label */
   doubleLabeled: DerivedPull[];
}

/** The name to show: the issue's title, or the bare slug before an issue exists. */
export function projectName(g: Pick<ProjectGroup, 'slug' | 'project'>): string {
   return g.project?.name ?? g.slug;
}

const WAITING_ON_REVIEW: Status[] = ['needs_cr', 'needs_recr', 'needs_qa'];

/**
 * Today: every project with work in flight, from the open PRs, the recently
 * merged ones (the server keeps LIVE_DAYS of them in memory), and the
 * project issues. Pass people's PRs only; bots are the caller's call.
 */
export function buildToday(
   projects: readonly Project[],
   open: readonly DerivedPull[],
   closed: readonly PullData[],
   prefix: string,
   now: number = Date.now() / 1000
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
      if (projectSlugs(p.data.labels, prefix).length > 1) today.doubleLabeled.push(p);
      const slug = projectOf(p.data.labels, prefix);
      if (slug == null) today.unsorted.push(p);
      else if (slug === MISC_SLUG) today.misc.push(p);
      else group(slug).open.push(p);
   }
   for (const p of closed) {
      if (!p.merged_at || now - epoch(p.merged_at) > LIVE_DAYS * DAY) continue;
      const slug = projectOf(p.labels, prefix);
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
      const updates = g.open.map(p => epoch(p.data.updated_at));
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

   // how many live projects each person has work in, for the lead check
   const liveCount = new Map<string, number>();
   for (const g of today.live)
      for (const login of g.people) liveCount.set(login, (liveCount.get(login) ?? 0) + 1);
   for (const g of today.live) {
      if (g.people.length === 1 && g.open.length + g.merged.length >= ONE_PERSON_MIN_PRS)
         g.flags.push('one_person');
      if (g.open.length >= 2 && g.open.every(p => WAITING_ON_REVIEW.includes(p.status)))
         g.flags.push('waiting_on_review');
      const lead = g.project?.lead;
      if (lead) {
         const elsewhere = (liveCount.get(lead) ?? 0) - (g.people.includes(lead) ? 1 : 0);
         if (elsewhere >= LEAD_SPREAD_MIN) g.flags.push('lead_spread');
      }
      if (g.project?.state === 'closed') g.flags.push('issue_closed');
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
   /** its project (misc included); null with no project label */
   project: string | null;
   opened: number;
   /** when it merged or closed; null while open */
   closed: number | null;
   merged: boolean;
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
}

export interface PersonWindow extends WindowCounts {
   /** projects this person had a PR in during the window, misc left out */
   projects: string[];
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

export interface WindowStats {
   /** first and last UTC day of the window, both counted */
   start: string;
   end: string;
   totals: WindowCounts;
   /** by project slug, misc included */
   projects: Record<string, WindowCounts>;
   /** PRs with no project label */
   unsorted: WindowCounts;
   people: Record<string, PersonWindow>;
   /** one point per day, for the backlog chart */
   days: DayPoint[];
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
   counts: WindowCounts;
   agesStart: number[];
   agesEnd: number[];
}

const tally = (): Tally => ({
   counts: {
      backlog_start: 0,
      backlog_end: 0,
      opened: 0,
      merged: 0,
      closed: 0,
      median_age_start_days: null,
      median_age_end_days: null,
   },
   agesStart: [],
   agesEnd: [],
});

function median(xs: number[]): number | null {
   if (!xs.length) return null;
   const s = [...xs].sort((a, b) => a - b);
   const mid = Math.floor(s.length / 2);
   const m = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
   return Math.round(m * 10) / 10;
}

const finish = ({ counts, agesStart, agesEnd }: Tally): WindowCounts => ({
   ...counts,
   median_age_start_days: median(agesStart),
   median_age_end_days: median(agesEnd),
});

/**
 * Backlog and throughput for the UTC days `start` through `end`, overall, per
 * project and per person. Every bucket satisfies backlog_start + opened -
 * merged - closed = backlog_end, the check the history rebuild used. A PR is
 * counted under its current project label, which is exact unless it moved
 * between projects. Pass people's PRs only, and a valid start <= end.
 */
export function windowStats(spans: readonly PullSpan[], start: string, end: string): WindowStats {
   const from = dayStart(start) ?? 0;
   const to = (dayStart(end) ?? from) + DAY;
   const dayCount = Math.max(1, Math.round((to - from) / DAY));
   const totals = tally();
   const unsorted = tally();
   const projects = new Map<string, Tally>();
   const people = new Map<string, { t: Tally; projects: Set<string> }>();
   const openedOn = new Array<number>(dayCount).fill(0);
   const departedOn = new Array<number>(dayCount).fill(0);

   for (const s of spans) {
      // skip PRs that never overlapped the window
      if (s.opened >= to || (s.closed != null && s.closed < from)) continue;
      const openAt = (t: number) => s.opened < t && (s.closed == null || s.closed >= t);
      const openedIn = s.opened >= from;
      const departedIn = s.closed != null && s.closed < to;
      let byProject = s.project == null ? unsorted : projects.get(s.project);
      if (!byProject) {
         byProject = tally();
         projects.set(s.project as string, byProject);
      }
      let person = people.get(s.author);
      if (!person) {
         person = { t: tally(), projects: new Set() };
         people.set(s.author, person);
      }
      if (s.project != null && s.project !== MISC_SLUG) person.projects.add(s.project);
      for (const t of [totals, byProject, person.t]) {
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
            if (s.merged) t.counts.merged++;
            else t.counts.closed++;
         }
      }
      if (openedIn) openedOn[Math.floor((s.opened - from) / DAY)]++;
      if (departedIn) departedOn[Math.floor(((s.closed as number) - from) / DAY)]++;
   }

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
      projects: Object.fromEntries([...projects].map(([slug, t]) => [slug, finish(t)])),
      unsorted: finish(unsorted),
      people: Object.fromEntries(
         [...people].map(([login, p]) => [login, { ...finish(p.t), projects: [...p.projects].sort() }])
      ),
      days,
   };
}
