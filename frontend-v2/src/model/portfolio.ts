import {
   MISC_SLUG,
   projectName,
   type Project,
   type ProjectFlag,
   type ProjectGroup,
   type ProjectWindow,
   type Today,
   type WeekPoint,
} from '../../../shared/model/projects';
import type { RoadmapItem } from '../../../shared/model/roadmap';
import type { Status } from '../../../shared/model/status';

/**
 * The portfolio: one row per project, for the person who plans the work
 * rather than reviews it. It joins three sources the Projects tab already
 * has: the project issues (name, lead, target, parents, open or closed),
 * Today (open PRs, people, flags, from the live board), and the picked
 * range's numbers (merged, days to merge, developers and non-developers).
 * Pure, so the list, the timeline and the CSV export can't disagree.
 */

export type ProjectStatus = 'live' | 'quiet' | 'done' | 'dropped';

export interface PortfolioItem {
   slug: string;
   name: string;
   project: Project | null;
   /** Today's group when the project is live or quiet */
   group: ProjectGroup | null;
   status: ProjectStatus;
   lead: string | null;
   target: Project['target'];
   /** whole days until the target's due date, negative once it's past */
   dueInDays: number | null;
   /** parent slugs, from the issue's parent: labels */
   parents: string[];
   open: number;
   /** open PRs waiting on a CR or QA */
   waiting: number;
   /** people with an open PR or a merge in the last 14 days, split by team */
   developers: string[];
   nonDevelopers: string[];
   /** the picked range's numbers; null when nothing of it overlaps the range */
   window: ProjectWindow | null;
   idleDays: number | null;
   flags: ProjectFlag[];
}

const WAITING: Status[] = ['needs_cr', 'needs_recr', 'needs_qa'];
const DAY_MS = 86_400_000;

/** Every project the tab knows about: issues, live or quiet groups, and
 * labels seen in the range's history. Misc is one-offs, not a project. */
export function portfolioItems(
   projects: readonly Project[],
   today: Today,
   window: Record<string, ProjectWindow>,
   teamOf: (login: string) => string | null,
   now: number = Date.now()
): PortfolioItem[] {
   const bySlug = new Map(projects.map(p => [p.slug, p]));
   const groups = new Map<string, [ProjectGroup, ProjectStatus]>();
   for (const g of today.live) groups.set(g.slug, [g, 'live']);
   for (const g of today.quiet) groups.set(g.slug, [g, 'quiet']);
   const slugs = new Set([...bySlug.keys(), ...groups.keys(), ...Object.keys(window)]);
   slugs.delete(MISC_SLUG);
   return [...slugs].map(slug => {
      const project = bySlug.get(slug) ?? null;
      const [group, live] = groups.get(slug) ?? [null, null];
      const status: ProjectStatus =
         live ??
         (project?.state === 'closed'
            ? project.state_reason === 'not_planned'
               ? 'dropped'
               : 'done'
            : 'quiet');
      const people = group?.people ?? [];
      const due = project?.target?.due_on ? Date.parse(project.target.due_on) : NaN;
      return {
         slug,
         name: group ? projectName(group) : project?.name ?? slug,
         project,
         group,
         status,
         lead: project?.lead ?? null,
         target: project?.target ?? null,
         dueInDays: Number.isNaN(due) ? null : Math.ceil((due - now) / DAY_MS),
         parents: project?.parents ?? [],
         open: group?.open.length ?? 0,
         waiting: group?.open.filter(p => WAITING.includes(p.status)).length ?? 0,
         developers: people.filter(login => teamOf(login) != null),
         nonDevelopers: people.filter(login => teamOf(login) == null),
         window: window[slug] ?? null,
         idleDays: group?.idleDays ?? null,
         flags: group?.flags ?? [],
      };
   });
}

/** The status tabs over the list, in the order they show. */
export const STATUS_FILTERS: [string, string][] = [
   ['live', 'Live'],
   ['quiet', 'Quiet'],
   ['closed', 'Done or dropped'],
   ['all', 'All'],
];

export function matchesStatus(item: PortfolioItem, filter: string): boolean {
   if (filter === 'all') return true;
   if (filter === 'closed') return item.status === 'done' || item.status === 'dropped';
   return item.status === filter;
}

/** A search over the words a planner would type: the name, the slug, a
 * parent, or the lead. */
export function matchesFind(item: PortfolioItem, find: string): boolean {
   const q = find.trim().toLowerCase();
   if (!q) return true;
   return [item.name, item.slug, item.lead ?? '', ...item.parents].some(s =>
      s.toLowerCase().includes(q)
   );
}

export type SortKey =
   | 'name'
   | 'status'
   | 'lead'
   | 'target'
   | 'people'
   | 'open'
   | 'waiting'
   | 'merged'
   | 'toMerge'
   | 'idle';

const STATUS_RANK: Record<ProjectStatus, number> = { live: 0, quiet: 1, done: 2, dropped: 3 };

/** Each column's natural order: names A to Z, the soonest target first,
 * and the biggest number first everywhere else. Nulls always sink. */
const SORTS: Record<SortKey, (a: PortfolioItem, b: PortfolioItem) => number> = {
   name: (a, b) => a.name.localeCompare(b.name),
   status: (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status],
   lead: (a, b) => nullsLast(a.lead, b.lead, (x, y) => x.localeCompare(y)),
   target: (a, b) => nullsLast(a.dueInDays, b.dueInDays, (x, y) => x - y),
   people: (a, b) =>
      b.developers.length + b.nonDevelopers.length - (a.developers.length + a.nonDevelopers.length),
   open: (a, b) => b.open - a.open,
   waiting: (a, b) => b.waiting - a.waiting,
   merged: (a, b) => (b.window?.merged ?? 0) - (a.window?.merged ?? 0),
   toMerge: (a, b) =>
      nullsLast(
         a.window?.median_days_to_merge ?? null,
         b.window?.median_days_to_merge ?? null,
         (x, y) => y - x
      ),
   idle: (a, b) => nullsLast(a.idleDays, b.idleDays, (x, y) => y - x),
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
   return key in SORTS ? { key, reversed } : { key: 'open', reversed: false };
}

/** Sort a copy: the chosen column, then live before closed, then more open
 * PRs, then the name, so ties never shuffle between renders. */
export function sortItems(items: readonly PortfolioItem[], sort: string): PortfolioItem[] {
   const { key, reversed } = parseSort(sort);
   const by = SORTS[key];
   return [...items].sort(
      (a, b) =>
         (reversed ? -by(a, b) : by(a, b)) ||
         SORTS.status(a, b) ||
         SORTS.open(a, b) ||
         SORTS.name(a, b)
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
   item: PortfolioItem,
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
   teamOf: (login: string) => string | null,
   nameOf: (slug: string) => string = slug => slug
): { title: string; items: PortfolioItem[] }[] {
   if (by !== 'parent' && by !== 'lead' && by !== 'team') return [{ title: '', items: [...items] }];
   const none = { parent: 'No parent', lead: 'No lead', team: 'Only non-developers' }[by];
   const groups = new Map<string, PortfolioItem[]>();
   const add = (title: string, item: PortfolioItem) => {
      if (!groups.has(title)) groups.set(title, []);
      groups.get(title)?.push(item);
   };
   for (const item of items) {
      if (by === 'parent') {
         if (item.parents.length) for (const p of item.parents) add(nameOf(p), item);
         else add(none, item);
      } else if (by === 'lead') add(item.lead ?? none, item);
      else add(mainTeam(item, teamOf) ?? none, item);
   }
   return [...groups]
      .sort(([a], [b]) => (a === none ? 1 : b === none ? -1 : a.localeCompare(b)))
      .map(([title, list]) => ({ title, items: list }));
}

const STATUS_WORD: Record<ProjectStatus, string> = {
   live: 'Live',
   quiet: 'Quiet',
   done: 'Done',
   dropped: 'Dropped',
};

export function statusWord(status: ProjectStatus): string {
   return STATUS_WORD[status];
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
      'Status',
      'Lead',
      'Target',
      'Target due',
      'Parents',
      'Developers',
      'Non-developers',
      'Open PRs',
      'Waiting on review',
      'Opened in range',
      'Merged in range',
      'Closed in range',
      'Median days to merge',
      'Days the stalest PR sat',
      'Issue',
   ];
   const rows = items.map(i => [
      i.name,
      i.slug,
      STATUS_WORD[i.status],
      i.lead,
      i.target?.title ?? null,
      i.target?.due_on?.slice(0, 10) ?? null,
      i.parents.join(' '),
      i.developers.join(' '),
      i.nonDevelopers.join(' '),
      i.open,
      i.waiting,
      i.window?.opened ?? 0,
      i.window?.merged ?? 0,
      i.window?.closed ?? 0,
      i.window?.median_days_to_merge ?? null,
      i.idleDays,
      i.project ? `https://github.com/${i.project.repo}/issues/${i.project.number}` : null,
   ]);
   return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n';
}

/** The project slugs the roadmap plans for: linked items not dropped. */
export function roadmapSlugs(items: readonly RoadmapItem[]): Set<string> {
   return new Set(items.flatMap(i => (i.project && i.status !== 'dropped' ? [i.project] : [])));
}

/**
 * Of the PRs merged over some weeks, how many were in a project on the
 * roadmap. One-offs and PRs in no project count toward the total only: they
 * are the unplanned work the share is measured against.
 */
export function roadmapShare(
   weeks: readonly WeekPoint[],
   planned: ReadonlySet<string>
): { planned: number; total: number } {
   let onPlan = 0;
   let total = 0;
   for (const w of weeks) {
      for (const [slug, count] of Object.entries(w.merged_by_project)) {
         total += count;
         if (planned.has(slug)) onPlan += count;
      }
   }
   return { planned: onPlan, total };
}
