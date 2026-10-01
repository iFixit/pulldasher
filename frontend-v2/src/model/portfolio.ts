import { epoch, n } from '../../../shared/format';
import { DECIDE_MIN_PRS, STALL_DAYS, issuesAllClosed } from '../../../shared/model/decide';
import {
   dayStart,
   MISC_SLUG,
   targetOf,
   utcDay,
   type Project,
   type ProjectFlag,
   type ProjectGroup,
   type ProjectTarget,
   type ProjectWindow,
   type Today,
} from '../../../shared/model/projects';
import {
   healthStanding,
   isUnderWay,
   planEnd,
   planFor,
   type RoadmapItem,
} from '../../../shared/model/roadmap';
import type { Status } from '../../../shared/model/status';
import type { PullData } from '../../../shared/types';
import type { IssueCounts } from '../../../shared/model/work';
import { DEFAULT_SORT } from '../lens';
import { dayOf } from './days';
import { dayWords } from './projectData';
import type { ProjectWorker } from './retro';

/**
 * The portfolio: one row per project, for the person who plans the work
 * rather than reviews it. It joins the sources the Projects tab already
 * has: the project issues (name, lead, target, parents, open or closed),
 * Today (open PRs, people, flags, from the live board), the roadmap's plans,
 * and the picked range's numbers. Pure, so the list, the charts over it and
 * the CSV export can't disagree.
 */

/** Where a project is: in progress (an open PR or a merge in the last 14
 * days, and not parked, done or dropped on the roadmap), parked, quiet
 * (open, nothing in flight), or closed (done or dropped). */
export type Stage = 'progress' | 'parked' | 'quiet' | 'closed';

/** Whether it has work in flight by its PRs alone: live (an open PR or a
 * merge in the last 14 days), quiet, or its issue closed as done or dropped.
 * The roadmap and Decide read this; the list reads `stage`. */
export type ProjectStatus = 'live' | 'quiet' | 'done' | 'dropped';

/** Enough of a PR to name and link it. */
export interface PrRef {
   repo: string;
   number: number;
   title: string;
}

/** A project's plan in a few words for its table cell, the worst thing
 * first; `kind` sorts it. */
export type PlanKind =
   | 'off_track'
   | 'issues_done'
   | 'past_end'
   | 'missed'
   | 'at_risk'
   | 'no_update'
   | 'update_due'
   | 'on_track'
   | 'ends'
   | 'parked'
   | 'no_plan'
   | 'stopped';
export interface PlanCell {
   kind: PlanKind;
   text: string;
   /** amber: someone owes the project something */
   warn: boolean;
}

export interface PortfolioItem {
   slug: string;
   /** its issue's title, or else its plan's name, or else the label */
   name: string;
   project: Project | null;
   /** Today's group when the project is live or quiet */
   group: ProjectGroup | null;
   status: ProjectStatus;
   stage: Stage;
   /** its issue's assignee, or else its plan's lead */
   lead: string | null;
   /** its plan's team, or else the team most of its developers are on */
   team: string | null;
   /** its issue's Target date, or else its milestone (projects.ts targetOf) */
   target: ProjectTarget | null;
   /** whole days until the target's due date, negative once it's past */
   dueInDays: number | null;
   /** parent slugs, from the issue's parent: labels */
   parents: string[];
   open: number;
   /** open PRs waiting on a CR or QA */
   waiting: number;
   /** PRs merged in the last 14 days */
   merged: number;
   /** people with an open PR or a merge in the last 14 days, split by team */
   developers: string[];
   nonDevelopers: string[];
   /** who wrote or reviewed on it in the last 14 days (withWorkers); empty
    * until those days load */
   workers: ProjectWorker[];
   /** the picked range's numbers; null when nothing of it overlaps the range */
   window: ProjectWindow | null;
   /** the day its oldest open PR opened, and whole days since; null with none open */
   openSince: string | null;
   ageDays: number | null;
   /** its newest activity on any PR (opened, pushed, a human comment, stamp
    * or review, a merge): when, whole days ago, and on which PR */
   lastActivity: { at: number; days: number; pr: PrRef } | null;
   /** its open PR gone longest with no activity; `opened` when it has had
    * none since it opened */
   stalest: { pr: PrRef; days: number; opened: boolean } | null;
   flags: ProjectFlag[];
   /** the plan that speaks for this project (roadmap.ts planFor): the first
    * under way, or else its latest decision; null when it isn't on the roadmap */
   plan: RoadmapItem | null;
   planCell: PlanCell;
   /** how the issues attached to it stand (shared/model/work.ts); null
    * with none attached, or before they load */
   issues: IssueCounts | null;
   /** it runs with no end: marked on the board or by its issue's label */
   ongoing: boolean;
   /** in progress, with open PRs and no activity for STALL_DAYS */
   stalled: boolean;
   /** off track, past its plan's end with PRs open, or past its target with PRs open */
   behind: boolean;
   /** its plan under way ends within the next ENDS_SOON_DAYS */
   endsSoon: boolean;
}

const WAITING: Status[] = ['needs_cr', 'needs_recr', 'needs_qa'];
const DAY = 86400;
/** how far ahead a plan's end counts as soon */
export const ENDS_SOON_DAYS = 14;

const ref = (p: PullData): PrRef => ({ repo: p.repo, number: p.number, title: p.title });

function stageOf(
   live: 'live' | 'quiet' | null,
   project: Project | null,
   plan: RoadmapItem | null
): Stage {
   const closedIssue = project?.state === 'closed';
   const stopped = plan?.status === 'done' || plan?.status === 'dropped';
   if (plan?.status === 'parked' && !closedIssue) return 'parked';
   if (live === 'live' && !stopped) return 'progress';
   return closedIssue || stopped ? 'closed' : 'quiet';
}

/**
 * The plan's words for a project, the worst first: off track, past its
 * plan's end, a missed target, at risk, an update owed, on track, when it
 * starts or ends, parked, and no plan. Amber on Decide's terms: "No plan"
 * only once Decide would ask for one (DECIDE_MIN_PRS or more PRs, some open).
 */
export function planCell(
   item: Pick<
      PortfolioItem,
      'plan' | 'project' | 'stage' | 'open' | 'merged' | 'target' | 'dueInDays'
   > & { issues?: IssueCounts | null; ongoing?: boolean },
   day: string,
   now: number
): PlanCell {
   const { plan } = item;
   const missed =
      item.stage !== 'closed' &&
      item.open > 0 &&
      item.dueInDays != null &&
      item.dueInDays < 0 &&
      item.target?.due_on
         ? item.target.due_on
         : null;
   if (plan && isUnderWay(plan.status)) {
      const standing = healthStanding(plan, now);
      const update =
         standing.kind === 'current' || standing.kind === 'stale' ? standing.update : null;
      const end = planEnd(plan);
      if (update?.health === 'off_track')
         return { kind: 'off_track', text: 'Off track', warn: true };
      // every issue attached to it closed, and no call since: Decide asks whether it's done
      if (item.issues && issuesAllClosed(plan, item.issues)) {
         return { kind: 'issues_done', text: 'Issues all closed', warn: true };
      }
      if (end < day) {
         const weeks = Math.ceil(
            ((dayStart(day) as number) - (dayStart(end) as number)) / (7 * DAY)
         );
         return { kind: 'past_end', text: `${weeks} wk past its end`, warn: true };
      }
      if (missed) return { kind: 'missed', text: `Missed ${dayWords(missed)} target`, warn: true };
      if (update?.health === 'at_risk') return { kind: 'at_risk', text: 'At risk', warn: true };
      if (standing.kind === 'missing') return { kind: 'no_update', text: 'No update', warn: true };
      if (standing.kind === 'stale') return { kind: 'update_due', text: 'Update due', warn: true };
      if (update) return { kind: 'on_track', text: 'On track', warn: false };
      return plan.start > day
         ? { kind: 'ends', text: `Starts ${dayWords(plan.start)}`, warn: false }
         : { kind: 'ends', text: `Ends ${dayWords(end)}`, warn: false };
   }
   if (missed) return { kind: 'missed', text: `Missed ${dayWords(missed)} target`, warn: true };
   if (plan?.status === 'parked') return { kind: 'parked', text: 'Parked', warn: false };
   if (plan || item.project?.state === 'closed') {
      const dropped = plan
         ? plan.status === 'dropped'
         : item.project?.state_reason === 'not_planned';
      return { kind: 'stopped', text: dropped ? 'Dropped' : 'Done', warn: false };
   }
   const owed = !item.ongoing && item.open > 0 && item.open + item.merged >= DECIDE_MIN_PRS;
   return { kind: 'no_plan', text: 'No plan', warn: owed };
}

/** Every project the tab knows about: issues, live or quiet groups, and
 * labels seen in the range's history. Misc is one-offs, not a project. */
export function portfolioItems(
   projects: readonly Project[],
   today: Today,
   window: Record<string, ProjectWindow>,
   teamOf: (login: string) => string | null,
   now: number = Date.now(),
   plans: readonly RoadmapItem[] = [],
   issues: ReadonlyMap<string, IssueCounts> | null = null,
   ongoing: ReadonlySet<string> = new Set()
): PortfolioItem[] {
   const secs = now / 1000;
   const day = dayOf(new Date(now));
   const soon = utcDay((dayStart(day) as number) + (ENDS_SOON_DAYS - 1) * DAY);
   const daysSince = (at: number) => Math.max(0, Math.floor((secs - at) / DAY));
   const bySlug = new Map(projects.map(p => [p.slug, p]));
   const groups = new Map<string, [ProjectGroup, 'live' | 'quiet']>();
   for (const g of today.live) groups.set(g.slug, [g, 'live']);
   for (const g of today.quiet) groups.set(g.slug, [g, 'quiet']);
   const slugs = new Set([...bySlug.keys(), ...groups.keys(), ...Object.keys(window)]);
   slugs.delete(MISC_SLUG);
   return [...slugs].map(slug => {
      const project = bySlug.get(slug) ?? null;
      const [group, live] = groups.get(slug) ?? [null, null];
      const plan = planFor(slug, plans);
      const people = group?.people ?? [];
      const target = targetOf(project);
      const due = target?.due_on ? Date.parse(target.due_on) : NaN;
      const open = group?.open ?? [];
      // open PRs come oldest first (projects.ts buildToday)
      const oldest = open[0]?.data;
      // real work only: updated_at moves on any label edit
      const onOpen = open
         .map(p => ({ at: epoch(p.data.status?.activity_at ?? p.data.updated_at), pr: p.data }))
         .filter(t => Number.isFinite(t.at));
      const onMerged = (group?.merged ?? [])
         .map(p => ({ at: epoch(p.merged_at ?? ''), pr: p }))
         .filter(t => Number.isFinite(t.at));
      type Touch = typeof onOpen[number];
      const newest = [...onOpen, ...onMerged].reduce<Touch | null>(
         (a, t) => (!a || t.at > a.at ? t : a),
         null
      );
      const stalest = onOpen.reduce<Touch | null>((a, t) => (!a || t.at < a.at ? t : a), null);
      const stage = stageOf(live, project, plan);
      const status: ProjectStatus =
         live ??
         (project?.state === 'closed'
            ? project.state_reason === 'not_planned'
               ? 'dropped'
               : 'done'
            : 'quiet');
      const item: PortfolioItem = {
         slug,
         name: project?.name ?? plan?.name ?? slug,
         project,
         group,
         status,
         stage,
         lead: project?.lead ?? plan?.lead ?? null,
         team: null,
         target,
         dueInDays: Number.isNaN(due) ? null : Math.ceil((due - now) / (DAY * 1000)),
         parents: project?.parents ?? [],
         open: open.length,
         waiting: open.filter(p => WAITING.includes(p.status)).length,
         merged: group?.merged.length ?? 0,
         developers: people.filter(login => teamOf(login) != null),
         nonDevelopers: people.filter(login => teamOf(login) == null),
         workers: [],
         window: window[slug] ?? null,
         openSince: oldest ? oldest.created_at.slice(0, 10) : null,
         ageDays: oldest ? daysSince(epoch(oldest.created_at)) : null,
         lastActivity: newest
            ? { at: newest.at, days: daysSince(newest.at), pr: ref(newest.pr) }
            : null,
         stalest: stalest
            ? {
                 pr: ref(stalest.pr),
                 days: daysSince(stalest.at),
                 opened: stalest.at <= epoch(stalest.pr.created_at),
              }
            : null,
         flags: group?.flags ?? [],
         plan,
         planCell: { kind: 'no_plan', text: '', warn: false },
         issues: issues?.get(slug) ?? null,
         ongoing: ongoing.has(slug) || !!project?.ongoing,
         stalled: false,
         behind: false,
         endsSoon: false,
      };
      item.team = plan?.team ?? mainTeam(item, teamOf);
      item.planCell = planCell(item, day, secs);
      const kind = item.planCell.kind;
      item.stalled =
         stage === 'progress' && item.open > 0 && (item.lastActivity?.days ?? 0) >= STALL_DAYS;
      item.behind =
         kind === 'off_track' || kind === 'missed' || (kind === 'past_end' && item.open > 0);
      item.endsSoon =
         !!plan && isUnderWay(plan.status) && planEnd(plan) >= day && planEnd(plan) <= soon;
      return item;
   });
}

/** The items with who worked on each in the last 14 days (retro.ts peopleByProject). */
export function withWorkers(
   items: readonly PortfolioItem[],
   workers: ReadonlyMap<string, ProjectWorker[]>
): PortfolioItem[] {
   return items.map(i => ({ ...i, workers: workers.get(i.slug) ?? [] }));
}

/** The tabs over the list, in the order they show. `live` is in progress,
 * named for the URLs shared before parked had a tab of its own. */
export const STATUS_FILTERS: [string, string][] = [
   ['live', 'In progress'],
   ['parked', 'Parked'],
   ['quiet', 'Quiet'],
   ['closed', 'Done or dropped'],
   ['all', 'All'],
];

export function matchesStatus(item: PortfolioItem, filter: string): boolean {
   if (filter === 'all') return true;
   return item.stage === (filter === 'live' ? 'progress' : filter);
}

/** One bar of the Overview's charts: its axis label, the same in words for
 * the line over the list, and the days it holds (fewer than `under`). */
export interface BucketDef {
   tick: string;
   words: string;
   under: number;
}

/** How long in-progress projects have been open, from their oldest open PR. */
export const AGE_BUCKETS: BucketDef[] = [
   { tick: 'Under 2 wk', words: 'open under 2 weeks', under: 14 },
   { tick: '2-4 wk', words: 'open 2 to 4 weeks', under: 28 },
   { tick: '1-2 mo', words: 'open 1 to 2 months', under: 60 },
   { tick: '2-3 mo', words: 'open 2 to 3 months', under: 90 },
   { tick: '3-6 mo', words: 'open 3 to 6 months', under: 180 },
   { tick: '6+ mo', words: 'open 6 months or more', under: Infinity },
];

/** How long since anyone worked on an in-progress project; the last bar is stalled. */
export const IDLE_BUCKETS: BucketDef[] = [
   { tick: 'Last 7 days', words: 'last worked on in the last 7 days', under: 7 },
   { tick: '1-2 wk ago', words: 'last worked on 1 to 2 weeks ago', under: 14 },
   { tick: '2-3 wk ago', words: 'last worked on 2 to 3 weeks ago', under: STALL_DAYS },
   {
      tick: 'Stalled, 3+ wk',
      words: `stalled, nothing for ${STALL_DAYS} days or more`,
      under: Infinity,
   },
];

export function bucketOf(days: number, buckets: readonly BucketDef[]): number {
   return buckets.findIndex(b => days < b.under);
}

/** The days a bucket chart counts an item by: its age, or days since its
 * last activity. Null leaves it out. */
export function bucketDays(item: PortfolioItem, chart: 'age' | 'idle'): number | null {
   return chart === 'age' ? item.ageDays : item.lastActivity?.days ?? null;
}

/**
 * What a tile or a chart's bar narrowed the list to, from the URL's `only`:
 * stalled, behind, ending soon, or one bar, `age-2` or `idle-3`. Null or an
 * unknown value keeps everything.
 */
export function matchesOnly(item: PortfolioItem, only: string | null): boolean {
   if (only === 'stalled') return item.stalled;
   if (only === 'behind') return item.behind;
   if (only === 'ending') return item.endsSoon;
   const bar = /^(age|idle)-(\d)$/.exec(only ?? '');
   if (!bar) return true;
   const chart = bar[1] as 'age' | 'idle';
   const days = bucketDays(item, chart);
   return (
      item.stage === 'progress' &&
      days != null &&
      bucketOf(days, chart === 'age' ? AGE_BUCKETS : IDLE_BUCKETS) === Number(bar[2])
   );
}

/** The `only` narrowing in words, for the line over the list; null for none. */
export function onlyWords(only: string | null): string | null {
   if (only === 'stalled') return `stalled, nothing for ${STALL_DAYS} days or more`;
   if (only === 'behind') return 'behind plan';
   if (only === 'ending') return `plans ending in the next ${ENDS_SOON_DAYS} days`;
   const bar = /^(age|idle)-(\d)$/.exec(only ?? '');
   if (!bar) return null;
   return (bar[1] === 'age' ? AGE_BUCKETS : IDLE_BUCKETS)[Number(bar[2])]?.words ?? null;
}

/** A search over the words a planner would type: the name, the slug, a
 * parent, the lead, or the team. */
export function matchesFind(item: PortfolioItem, find: string): boolean {
   const q = find.trim().toLowerCase();
   if (!q) return true;
   return [item.name, item.slug, item.lead ?? '', item.team ?? '', ...item.parents].some(s =>
      s.toLowerCase().includes(q)
   );
}

export type SortKey =
   | 'name'
   | 'lead'
   | 'team'
   | 'age'
   | 'idle'
   | 'people'
   | 'open'
   | 'waiting'
   | 'merged'
   | 'plan'
   | 'issues'
   | 'target';

const STAGE_RANK: Record<Stage, number> = { progress: 0, parked: 1, quiet: 2, closed: 3 };
const PLAN_RANK: Record<PlanKind, number> = {
   off_track: 0,
   issues_done: 1,
   past_end: 2,
   missed: 3,
   at_risk: 4,
   no_update: 5,
   update_due: 6,
   no_plan: 7,
   on_track: 8,
   ends: 9,
   parked: 10,
   stopped: 11,
};

// amber words first, worst first, then the rest
const planOrder = (cell: PlanCell) => PLAN_RANK[cell.kind] + (cell.warn ? 0 : 20);

/** Each column's natural order: names A to Z, the soonest target first, the
 * plan's worst words first, and the biggest number first everywhere else,
 * so Last activity leads with the longest quiet. `dir` is -1 to reverse;
 * blanks sink either way. */
const SORTS: Record<SortKey, (a: PortfolioItem, b: PortfolioItem, dir: number) => number> = {
   name: (a, b, dir) => dir * a.name.localeCompare(b.name),
   lead: (a, b, dir) => nullsLast(a.lead, b.lead, (x, y) => dir * x.localeCompare(y)),
   team: (a, b, dir) => nullsLast(a.team, b.team, (x, y) => dir * x.localeCompare(y)),
   age: (a, b, dir) => nullsLast(a.ageDays, b.ageDays, (x, y) => dir * (y - x)),
   idle: (a, b, dir) =>
      nullsLast(
         a.lastActivity?.days ?? null,
         b.lastActivity?.days ?? null,
         (x, y) => dir * (y - x)
      ),
   people: (a, b, dir) => dir * (b.workers.length - a.workers.length),
   open: (a, b, dir) => dir * (b.open - a.open),
   waiting: (a, b, dir) => dir * (b.waiting - a.waiting),
   merged: (a, b, dir) => dir * (b.merged - a.merged),
   plan: (a, b, dir) => dir * (planOrder(a.planCell) - planOrder(b.planCell)),
   // the most issues still open first
   issues: (a, b, dir) =>
      nullsLast(a.issues?.open ?? null, b.issues?.open ?? null, (x, y) => dir * (y - x)),
   target: (a, b, dir) => nullsLast(a.dueInDays, b.dueInDays, (x, y) => dir * (x - y)),
};

function nullsLast<T>(a: T | null, b: T | null, cmp: (x: T, y: T) => number): number {
   if (a == null) return b == null ? 0 : 1;
   if (b == null) return -1;
   return cmp(a, b);
}

/** Parse a sort param: a column key, `-` in front to reverse it. */
export function parseSort(raw: string | null): { key: SortKey; reversed: boolean } {
   const reversed = !!raw?.startsWith('-');
   const key = (reversed ? (raw as string).slice(1) : raw) as SortKey;
   return key in SORTS ? { key, reversed } : { key: DEFAULT_SORT as SortKey, reversed: false };
}

/** Sort a copy: the chosen column, then in progress before the rest, then
 * more open PRs, then the name, so ties never shuffle between renders. */
export function sortItems(items: readonly PortfolioItem[], sort: string): PortfolioItem[] {
   const { key, reversed } = parseSort(sort);
   return [...items].sort(
      (a, b) =>
         SORTS[key](a, b, reversed ? -1 : 1) ||
         STAGE_RANK[a.stage] - STAGE_RANK[b.stage] ||
         SORTS.open(a, b, 1) ||
         SORTS.name(a, b, 1)
   );
}

export const GROUPINGS: [string, string][] = [
   ['none', 'No grouping'],
   ['parent', 'Parent'],
   ['lead', 'Lead'],
   ['team', 'Team'],
];

/**
 * The team a project mostly belongs to: the team most of its developers
 * are on (ties to the name first alphabetically), or null when only
 * non-developers have work in it.
 */
export function mainTeam(
   item: Pick<PortfolioItem, 'developers'>,
   teamOf: (login: string) => string | null
): string | null {
   const counts = new Map<string, number>();
   for (const login of item.developers) {
      const team = teamOf(login) as string;
      counts.set(team, (counts.get(team) ?? 0) + 1);
   }
   return (
      [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b)).map(([team]) => team)[0] ??
      null
   );
}

/**
 * Split sorted items into titled groups, keeping each group's order. A
 * project with two parents shows under both, since it serves both. Groups
 * come in name order, with the no-value group last.
 */
export function groupItems(
   items: readonly PortfolioItem[],
   by: string,
   nameOf: (slug: string) => string = slug => slug
): { title: string; items: PortfolioItem[] }[] {
   if (by !== 'parent' && by !== 'lead' && by !== 'team') return [{ title: '', items: [...items] }];
   const none = { parent: 'No parent', lead: 'No lead', team: 'No team' }[by];
   const groups = new Map<string, PortfolioItem[]>();
   const add = (title: string, item: PortfolioItem) => {
      if (!groups.has(title)) groups.set(title, []);
      groups.get(title)?.push(item);
   };
   for (const item of items) {
      if (by === 'parent') {
         if (item.parents.length) for (const p of item.parents) add(nameOf(p), item);
         else add(none, item);
      } else add((by === 'lead' ? item.lead : item.team) ?? none, item);
   }
   return [...groups]
      .sort(([a], [b]) => (a === none ? 1 : b === none ? -1 : a.localeCompare(b)))
      .map(([title, list]) => ({ title, items: list }));
}

const STAGE_WORD: Record<Stage, string> = {
   progress: 'In progress',
   parked: 'Parked',
   quiet: 'Quiet',
   closed: 'Done or dropped',
};

/** A project's stage in a word or two, for its page: a closed one says
 * done or dropped. */
export function stageWord(item: Pick<PortfolioItem, 'stage' | 'project' | 'plan'>): string {
   if (item.stage !== 'closed') return STAGE_WORD[item.stage];
   const dropped =
      item.project?.state === 'closed'
         ? item.project.state_reason === 'not_planned'
         : item.plan?.status === 'dropped';
   return dropped ? 'Dropped' : 'Done';
}

/** "today", "1 day ago", "12 days ago". */
export function agoWords(days: number): string {
   return days === 0 ? 'today' : `${n(days, 'day')} ago`;
}

function csvCell(value: string | number | null): string {
   const text = value == null ? '' : String(value);
   return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The list as CSV, the columns a planner pastes into a sheet. */
export function portfolioCsv(items: readonly PortfolioItem[]): string {
   const head = [
      'Project',
      'Label slug',
      'Stage',
      'Lead',
      'Team',
      'Open since',
      'Days since last activity',
      'Worked on it, last 14 days',
      'Open PRs',
      'Waiting on review',
      'Merged, last 14 days',
      'Plan',
      'Issues open',
      'Issues done',
      'Issues dropped',
      'Target',
      'Target due',
      'Parents',
      'Issue',
   ];
   const rows = items.map(i => [
      i.name,
      i.slug,
      STAGE_WORD[i.stage],
      i.lead,
      i.team,
      i.openSince,
      i.lastActivity?.days ?? null,
      i.workers.map(w => w.login).join(' '),
      i.open,
      i.waiting,
      i.merged,
      i.planCell.text,
      i.issues ? i.issues.open : null,
      i.issues ? i.issues.done : null,
      i.issues ? i.issues.dropped : null,
      i.target?.title ?? null,
      i.target?.due_on?.slice(0, 10) ?? null,
      i.parents.join(' '),
      i.project ? `https://github.com/${i.project.repo}/issues/${i.project.number}` : null,
   ]);
   return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n';
}

/** The list as plain text for an email or a chat post: each project's plan
 * words, its latest update, and when it last moved. */
export function portfolioText(items: readonly PortfolioItem[], day: string): string {
   const lines = items.map(i => {
      const u = i.plan && isUnderWay(i.plan.status) ? i.plan.update : null;
      const by = u ? ` (${u.author}, ${dayWords(utcDay(u.at))})` : '';
      const moved = i.lastActivity ? `last activity ${agoWords(i.lastActivity.days)}` : 'no PRs';
      const said = u?.body ? ` ${u.body.replace(/\s*\n\s*/g, ' ')}` : '';
      return `- ${i.name}: ${i.planCell.text}${by}. ${n(i.open, 'open PR')}, ${moved}.${said}`;
   });
   return [`Where the projects stand, ${dayWords(day)}`, ...lines].join('\n');
}
