import { epoch, n } from '../../../shared/format';
import {
   compareRows,
   RANK,
   STALL_DAYS,
   type DecideReason,
   type DecideRow,
} from '../../../shared/model/decide';
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
   HEALTH_WORD,
   healthStanding,
   isUnderWay,
   planEnd,
   planFor,
   type RoadmapItem,
} from '../../../shared/model/roadmap';
import type { Status } from '../../../shared/model/status';
import type { PullData } from '../../../shared/types';
import type { IssueCounts } from '../../../shared/model/work';
import { dayOf } from './days';
import { dayWords } from './projectData';
import type { ProjectWorker } from './retro';
import {
   ALL_ISSUES_CLOSED,
   BEING_WORKED_ON,
   LAST_14_DAYS,
   missedTarget,
   NO_PLAN,
   NO_UPDATE_YET,
   pastEnd,
   UPDATE_DUE,
} from './words';

/**
 * The portfolio: one row per project, for the person who plans the work
 * rather than reviews it. It joins the sources the Projects tab already
 * has: the project issues (name, lead, target, parents, open or closed),
 * Today (open PRs, people, flags, from the live board), the roadmap's plans,
 * and the picked range's numbers. Pure, so the list, the charts over it and
 * the CSV export can't disagree.
 */

/** Words written for the middle of a sentence ("being worked on") as a
 * label that starts with them. */
export const upperFirst = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);
/** Words written to start a line ("No PR activity") in the middle of one. */
export const lowerFirst = (words: string) => words.charAt(0).toLowerCase() + words.slice(1);

/** A label's slug read as words, the name of a project no issue or plan
 * names yet: "webdriver-deflake" is "Webdriver deflake", not a code. */
export const slugName = (slug: string) => upperFirst(slug.replace(/[-_]+/g, ' '));

/** Where a project is: being worked on (an open PR or a merge in the last
 * 14 days, and not parked, done or dropped on the roadmap), parked, quiet
 * (open, nothing in flight), or closed (done or dropped). "In progress" is
 * only ever a plan's status. */
export type Stage = 'progress' | 'parked' | 'quiet' | 'closed';

/** Whether it has work in flight by its PRs alone: live (an open PR or a
 * merge in the last 14 days), quiet, or its issue closed as done or dropped.
 * The roadmap and Decide read this; the list reads `stage`, and both
 * (beingWorkedOn). */
export type ProjectStatus = 'live' | 'quiet' | 'done' | 'dropped';

/** Enough of a PR to name and link it. */
export interface PrRef {
   repo: string;
   number: number;
   title: string;
}

/** A call Decide asks about a project: why, and the plan it's about (null
 * for work with no plan). */
export interface Ask {
   reason: DecideReason;
   item: RoadmapItem | null;
}

/** A project's plan in a few words for its table cell: the worst call
 * Decide asks, or else what its plan says. */
export type PlanKind =
   | 'reopened'
   | 'issue_closed'
   | 'moving'
   | 'off_track'
   | 'missed'
   | 'past_end'
   | 'issues_done'
   | 'stalled'
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
   /** empty for work with no plan that needs none yet */
   text: string;
   /** amber, the row's one mark: someone owes a call or an update */
   warn: boolean;
   /** the plan the words are about, which a click opens */
   planId: number | null;
}

export interface PortfolioItem {
   slug: string;
   /** its issue's title, or else its plan's name, or else its label's slug
    * read as words (slugName) */
   name: string;
   project: Project | null;
   /** Today's group when the project is live or quiet */
   group: ProjectGroup | null;
   status: ProjectStatus;
   stage: Stage;
   /** its issue's assignee, or else its plan's lead, or else whoever has the
    * most PRs in it, open or merged in the last 14 days (`leadByPrs`) */
   lead: string | null;
   /** no issue or plan names a lead, so it's the one with the most PRs:
    * said "by PRs" wherever the lead shows */
   leadByPrs: boolean;
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
   /** the calls Decide asks about it (withCalls); empty until those load */
   asks: Ask[];
   /** how the issues attached to it stand (shared/model/work.ts); null
    * with none attached, or before they load */
   issues: IssueCounts | null;
   /** it runs with no end: marked on the board or by its issue's label */
   ongoing: boolean;
   /** being worked on (stage progress), with open PRs and no activity for
    * STALL_DAYS */
   stalled: boolean;
   /** how it's behind, the first that holds: its latest update says off
    * track and the plan hasn't changed since, it's past its plan's end with
    * PRs open, or past its target with PRs open; null when it isn't */
   behind: 'off_track' | 'past_end' | 'missed' | null;
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

/** Whole weeks from a plan's last day to `day`. */
const weeksPast = (end: string, day: string) =>
   Math.ceil(((dayStart(day) as number) - (dayStart(end) as number)) / (7 * DAY));

/** A call Decide asks, in the few words a table cell has room for. */
function callWords(reason: DecideReason): Pick<PlanCell, 'kind' | 'text'> {
   switch (reason.kind) {
      case 'reopened':
         return {
            kind: 'reopened',
            text: `${reason.as === 'dropped' ? 'Dropped' : 'Done'}, still taking PRs`,
         };
      case 'issue_closed':
         return { kind: 'issue_closed', text: 'Issue closed, plan open' };
      case 'moving':
         return { kind: 'moving', text: 'Parked, still worked on' };
      case 'off_track':
      case 'at_risk':
         return { kind: reason.kind, text: HEALTH_WORD[reason.kind] };
      case 'missed':
         return { kind: 'missed', text: missedTarget(dayWords(reason.due)) };
      case 'over':
      case 'ended':
         return { kind: 'past_end', text: pastEnd(reason.weeks) };
      case 'issues_done':
         return { kind: 'issues_done', text: ALL_ISSUES_CLOSED };
      case 'stalled':
         return { kind: 'stalled', text: 'Stalled' };
      case 'new':
         return { kind: 'no_plan', text: NO_PLAN };
   }
}

/**
 * A project's plan in a few words, carrying the row's one amber mark. When
 * Decide asks about it (`asks`), the worst call it asks, in Decide's order.
 * Otherwise what the plan says, amber only where someone still owes
 * something: off track, past its end, at risk, or an update owed. A project
 * with no plan that Decide doesn't ask about says nothing, since small work
 * ships without one.
 */
export function planCell(
   item: Pick<PortfolioItem, 'plan' | 'project'> & { asks?: readonly Ask[] },
   day: string,
   now: number
): PlanCell {
   const { plan, asks = [] } = item;
   if (asks.length) {
      const worst = asks.reduce((a, b) =>
         // Decide's own order, worst first, so the cell names the call
         // Decide puts first
         RANK[b.reason.kind] < RANK[a.reason.kind] ? b : a
      );
      return {
         ...callWords(worst.reason),
         warn: true,
         planId: (worst.item ?? plan)?.id ?? null,
      };
   }
   if (plan && isUnderWay(plan.status)) {
      const standing = healthStanding(plan, now);
      const update =
         standing.kind === 'current' || standing.kind === 'stale' ? standing.update : null;
      const end = planEnd(plan);
      const owed = { warn: true, planId: plan.id };
      if (update?.health === 'off_track')
         return { kind: 'off_track', text: HEALTH_WORD.off_track, ...owed };
      if (end < day) return { kind: 'past_end', text: pastEnd(weeksPast(end, day)), ...owed };
      if (update?.health === 'at_risk')
         return { kind: 'at_risk', text: HEALTH_WORD.at_risk, ...owed };
      if (standing.kind === 'missing') return { kind: 'no_update', text: NO_UPDATE_YET, ...owed };
      if (standing.kind === 'stale') return { kind: 'update_due', text: UPDATE_DUE, ...owed };
      const calm = { warn: false, planId: plan.id };
      if (update) return { kind: 'on_track', text: HEALTH_WORD.on_track, ...calm };
      return plan.start > day
         ? { kind: 'ends', text: `Starts ${dayWords(plan.start)}`, ...calm }
         : { kind: 'ends', text: `Ends ${dayWords(end)}`, ...calm };
   }
   if (plan?.status === 'parked') {
      return { kind: 'parked', text: 'Parked', warn: false, planId: plan.id };
   }
   if (plan || item.project?.state === 'closed') {
      const dropped = plan
         ? plan.status === 'dropped'
         : item.project?.state_reason === 'not_planned';
      return {
         kind: 'stopped',
         text: dropped ? 'Dropped' : 'Done',
         warn: false,
         planId: plan?.id ?? null,
      };
   }
   return { kind: 'no_plan', text: '', warn: false, planId: null };
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
      const named = project?.lead ?? plan?.lead ?? null;
      const item: PortfolioItem = {
         slug,
         name: project?.name ?? plan?.name ?? slugName(slug),
         project,
         group,
         status,
         stage,
         // people come most PRs first (projects.ts buildToday)
         lead: named ?? people[0] ?? null,
         leadByPrs: !named && people.length > 0,
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
         // what Decide asks comes in later (withCalls)
         planCell: planCell({ plan, project }, day, secs),
         asks: [],
         issues: issues?.get(slug) ?? null,
         ongoing: ongoing.has(slug) || !!project?.ongoing,
         stalled: false,
         behind: null,
         endsSoon: false,
      };
      item.team = plan?.team ?? mainTeam(item, teamOf);
      const underWay = plan && isUnderWay(plan.status) ? plan : null;
      const standing = underWay && healthStanding(underWay, secs);
      // an off-track update the plan has changed since is answered, as
      // Decide reads it, so the tile's words agree with the row's
      const offTrack =
         !!standing &&
         (standing.kind === 'current' || standing.kind === 'stale') &&
         standing.update.health === 'off_track' &&
         standing.update.at > (underWay?.updated_at ?? 0);
      item.stalled =
         stage === 'progress' && item.open > 0 && (item.lastActivity?.days ?? 0) >= STALL_DAYS;
      item.behind = offTrack
         ? 'off_track'
         : underWay && planEnd(underWay) < day && item.open > 0
         ? 'past_end'
         : stage !== 'closed' && item.open > 0 && (item.dueInDays ?? 0) < 0 && target?.due_on
         ? 'missed'
         : null;
      item.endsSoon = !!underWay && planEnd(underWay) >= day && planEnd(underWay) <= soon;
      return item;
   });
}

/** How a project is behind (`behind`), in the words its row uses: "Off
 * track", "3 weeks past its end", "Missed its Sep 26 target"; null when it
 * isn't. */
export function behindWords(
   item: Pick<PortfolioItem, 'behind' | 'plan' | 'target'>,
   day: string
): string | null {
   switch (item.behind) {
      case 'off_track':
         return HEALTH_WORD.off_track;
      case 'past_end':
         // `behind` reads the plan under way, which is the one planFor gives
         return item.plan && pastEnd(weeksPast(planEnd(item.plan), day));
      case 'missed':
         return item.target?.due_on ? missedTarget(dayWords(item.target.due_on)) : null;
      default:
         return null;
   }
}

/**
 * The items with the calls Decide asks about each, so a row's Plan cell
 * names the worst one and wears the row's one amber mark. Without Decide's
 * rows (the roadmap still loading) the cells say only what each plan says.
 */
export function withCalls(
   items: readonly PortfolioItem[],
   decisions: readonly DecideRow[] | null,
   now: number = Date.now()
): PortfolioItem[] {
   const asks = new Map<string, Ask[]>();
   for (const row of decisions ?? []) {
      if (!row.slug) continue;
      const list = asks.get(row.slug) ?? [];
      list.push(...row.reasons.map(reason => ({ reason, item: row.item })));
      asks.set(row.slug, list);
   }
   const day = dayOf(new Date(now));
   return items.map(i => {
      const a = asks.get(i.slug);
      return a ? { ...i, asks: a, planCell: planCell({ ...i, asks: a }, day, now / 1000) } : i;
   });
}

/** The items with who worked on each in the last 14 days (retro.ts peopleByProject). */
export function withWorkers(
   items: readonly PortfolioItem[],
   workers: ReadonlyMap<string, ProjectWorker[]>
): PortfolioItem[] {
   return items.map(i => ({ ...i, workers: workers.get(i.slug) ?? [] }));
}

/**
 * Whether its PRs are moving on work that's going: being worked on, or
 * parked, done or dropped work Decide asks about because its PRs still
 * move, which belongs on the list a Monday opens to. The Overview's first
 * tab, its tile and its charts count these, so they agree.
 */
export function beingWorkedOn(item: Pick<PortfolioItem, 'stage' | 'status' | 'asks'>): boolean {
   return item.stage === 'progress' || (item.status === 'live' && item.asks.length > 0);
}

/**
 * Whether a project is the viewer's: they lead it (by PRs too), or have a
 * PR open in it or merged in the last 14 days. A done or dropped one stays
 * only while Decide asks about it, since its PRs still move. The Overview
 * lists these first, as Yours.
 */
export function isYours(
   item: Pick<PortfolioItem, 'lead' | 'developers' | 'nonDevelopers' | 'stage' | 'status' | 'asks'>,
   me: string
): boolean {
   const mine = (login: string | null) => !!login && login.toLowerCase() === me.toLowerCase();
   return (
      (mine(item.lead) || [...item.developers, ...item.nonDevelopers].some(mine)) &&
      (item.stage !== 'closed' || beingWorkedOn(item))
   );
}

/** The tabs over the list, in the order they show. `live` is the projects
 * being worked on, named for the URLs shared before parked had a tab of
 * its own. Parked or finished work Decide asks about shows in two. */
export const STATUS_FILTERS: [string, string][] = [
   ['live', `${upperFirst(BEING_WORKED_ON)}, ${LAST_14_DAYS}`],
   ['parked', 'Parked'],
   ['quiet', 'Quiet'],
   ['closed', 'Done or dropped'],
   ['all', 'All'],
];

export function matchesStatus(item: PortfolioItem, filter: string): boolean {
   if (filter === 'all') return true;
   if (filter === 'live') return beingWorkedOn(item);
   return item.stage === filter;
}

/** One bar of the Overview's charts: its axis label, the same in words for
 * the line over the list, and the days it holds (fewer than `under`). */
export interface BucketDef {
   tick: string;
   words: string;
   under: number;
}

/** How long the projects being worked on have been open, from their oldest open PR. */
export const AGE_BUCKETS: BucketDef[] = [
   { tick: 'Under 2 wk', words: 'open under 2 weeks', under: 14 },
   { tick: '2-4 wk', words: 'open 2 to 4 weeks', under: 28 },
   { tick: '1-2 mo', words: 'open 1 to 2 months', under: 60 },
   { tick: '2-3 mo', words: 'open 2 to 3 months', under: 90 },
   { tick: '3-6 mo', words: 'open 3 to 6 months', under: 180 },
   { tick: '6+ mo', words: 'open 6 months or more', under: Infinity },
];

/** How long since anyone worked on a project being worked on; the last bar is stalled. */
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
   if (only === 'behind') return !!item.behind;
   if (only === 'ending') return item.endsSoon;
   const bar = /^(age|idle)-(\d)$/.exec(only ?? '');
   if (!bar) return true;
   const chart = bar[1] as 'age' | 'idle';
   const days = bucketDays(item, chart);
   return (
      beingWorkedOn(item) &&
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

/** What a row offers the find box. */
export interface FindFields {
   name: string;
   slug: string | null;
   lead: string | null;
   team: string | null;
   parents: readonly string[];
}

/**
 * The find box read once, for every view that narrows by it: null when it's
 * empty, else a test for a row. Words match anywhere in the name, slug,
 * lead, team or parents. "lead:" or "team:" before a name matches the
 * leads or teams it starts, so "lead:mla" finds mlahargou's before the
 * login is typed out; "parent:" matches a parent exactly, which is what a
 * click on a parent puts in the box.
 */
export function findFilter(find: string): ((row: FindFields) => boolean) | null {
   const q = find.trim().toLowerCase();
   if (!q) return null;
   const exact = /^(lead|team|parent):\s*(.+)$/.exec(q);
   if (exact) {
      const [, field, name] = exact;
      if (field === 'parent') return row => row.parents.some(p => p.toLowerCase() === name);
      return row => (row[field as 'lead' | 'team'] ?? '').toLowerCase().startsWith(name);
   }
   return row =>
      [row.name, row.slug, row.lead, row.team, ...row.parents].some(s =>
         (s ?? '').toLowerCase().includes(q)
      );
}

/** Whether a project's row matches the find box (findFilter). */
export function matchesFind(item: PortfolioItem, find: string): boolean {
   const filter = findFilter(find);
   return !filter || filter(item);
}

/** The list's columns by sort key. Last activity is `last`, not the `idle`
 * it once was, since `idle` is what the URL holds when nothing was picked
 * (lens.ts DEFAULT_SORT), and that now means the list's default order. */
export type SortKey =
   | 'name'
   | 'lead'
   | 'team'
   | 'age'
   | 'last'
   | 'people'
   | 'open'
   | 'waiting'
   | 'merged'
   | 'plan'
   | 'issues'
   | 'target';

const STAGE_RANK: Record<Stage, number> = { progress: 0, parked: 1, quiet: 2, closed: 3 };

/** A row's place in the default order: a call Decide asks, then an update
 * its lead owes (amber too, but nobody decides it), then the rest. */
const owedRank = (i: PortfolioItem) => (i.asks.length ? 0 : i.planCell.warn ? 1 : 2);

/** The calls asked about a project as one of Decide's rows, for Decide's
 * own order (decide.ts compareRows). */
const asRow = (i: PortfolioItem): DecideRow => ({
   slug: i.slug,
   item: null,
   reasons: i.asks.map(a => a.reason),
});

/** Each column's natural order: names A to Z, the soonest target first, and
 * the biggest number first everywhere else, so Last activity leads with the
 * longest quiet. The Plan column, the default, puts what's owed first: the
 * calls Decide asks in Decide's own order, so its worst call tops both
 * lists, then the updates owed, then the rest, each by the longest quiet.
 * `dir` is -1 to reverse; blanks sink either way. */
const SORTS: Record<SortKey, (a: PortfolioItem, b: PortfolioItem, dir: number) => number> = {
   name: (a, b, dir) => dir * a.name.localeCompare(b.name),
   lead: (a, b, dir) => nullsLast(a.lead, b.lead, (x, y) => dir * x.localeCompare(y)),
   team: (a, b, dir) => nullsLast(a.team, b.team, (x, y) => dir * x.localeCompare(y)),
   age: (a, b, dir) => nullsLast(a.ageDays, b.ageDays, (x, y) => dir * (y - x)),
   last: (a, b, dir) =>
      nullsLast(
         a.lastActivity?.days ?? null,
         b.lastActivity?.days ?? null,
         (x, y) => dir * (y - x)
      ),
   people: (a, b, dir) => dir * (b.workers.length - a.workers.length),
   open: (a, b, dir) => dir * (b.open - a.open),
   waiting: (a, b, dir) => dir * (b.waiting - a.waiting),
   merged: (a, b, dir) => dir * (b.merged - a.merged),
   plan: (a, b, dir) =>
      dir *
         (owedRank(a) - owedRank(b) ||
            (a.asks.length && b.asks.length ? compareRows(asRow(a), asRow(b)) : 0)) ||
      SORTS.last(a, b, dir),
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

/** Parse a sort param: a column key, `-` in front to reverse it. Anything
 * else, the URL's nothing-picked `idle` included, is the default order. */
export function parseSort(raw: string | null): { key: SortKey; reversed: boolean } {
   const reversed = !!raw?.startsWith('-');
   const key = (reversed ? (raw as string).slice(1) : raw) as SortKey;
   return key in SORTS ? { key, reversed } : { key: 'plan', reversed: false };
}

/** Sort a copy: the chosen column, then work being worked on before the
 * rest, then more open PRs, then the name, so ties never shuffle between
 * renders. */
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
 * project with two parents shows under both, since it serves both, and a
 * parent heads its own group, ahead of its parts, rather than sitting under
 * "No parent". Groups come in name order, teams in their configured order
 * (`teams`, as settings list them) and then any other by name, with the
 * no-value group last. `repeats` holds the projects an earlier group
 * already showed, so one call isn't drawn in amber twice.
 */
export function groupItems(
   items: readonly PortfolioItem[],
   by: string,
   nameOf: (slug: string) => string = slug => slug,
   teams: readonly string[] = []
): { title: string; items: PortfolioItem[]; repeats: ReadonlySet<string> }[] {
   if (by !== 'parent' && by !== 'lead' && by !== 'team')
      return [{ title: '', items: [...items], repeats: new Set() }];
   const none = { parent: 'No parent', lead: 'No lead', team: 'No team' }[by];
   const groups = new Map<string, PortfolioItem[]>();
   const add = (title: string, item: PortfolioItem) => {
      if (!groups.has(title)) groups.set(title, []);
      groups.get(title)?.push(item);
   };
   const parents = new Set(by === 'parent' ? items.flatMap(i => i.parents) : []);
   for (const item of items) if (parents.has(item.slug)) add(nameOf(item.slug), item);
   for (const item of items) {
      if (by === 'parent') {
         for (const p of item.parents) add(nameOf(p), item);
         if (!item.parents.length && !parents.has(item.slug)) add(none, item);
      } else add((by === 'lead' ? item.lead : item.team) ?? none, item);
   }
   // a team settings don't list sorts after the ones they do
   const place = (title: string) => {
      const at = by === 'team' ? teams.indexOf(title) : -1;
      return at === -1 ? teams.length : at;
   };
   const seen = new Set<string>();
   return [...groups]
      .sort(([a], [b]) =>
         a === none ? 1 : b === none ? -1 : place(a) - place(b) || a.localeCompare(b)
      )
      .map(([title, list]) => {
         const repeats = new Set(list.filter(i => seen.has(i.slug)).map(i => i.slug));
         for (const i of list) seen.add(i.slug);
         return { title, items: list, repeats };
      });
}

const STAGE_WORD: Record<Stage, string> = {
   progress: upperFirst(BEING_WORKED_ON),
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
   const raw = value == null ? '' : String(value);
   // a title that starts like a formula (=, +, -, @) runs as one in a
   // spreadsheet; a leading quote keeps it text
   const text = typeof value === 'string' && /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
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
      // the table leaves a plan nobody needs blank; a sheet says so
      i.planCell.text || NO_PLAN,
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
      const plan = i.planCell.text || NO_PLAN;
      return `- ${i.name}: ${plan}${by}. ${n(i.open, 'open PR')}, ${moved}.${said}`;
   });
   return [`Where the projects stand, ${dayWords(day)}`, ...lines].join('\n');
}
