import { dayStart, firstOpenDay, targetOf, utcDay, type Project, type Today } from './projects';
import { goingProjects, homesOf, type Initiative } from './initiatives';
import { healthStanding, isUnderWay, planEnd, weeksPast, type RoadmapItem } from './roadmap';
import type { IssueCounts } from './work';

/**
 * The decisions owed this week, for the Decide view and GET /api/v1/decide:
 * the job a product manager would do in a weekly triage, as a queue that
 * empties. A row is a project, or one of its plans, that needs a call:
 * - `new`: in flight with DECIDE_MIN_PRS or more PRs and never a plan;
 *   smaller work just ships
 * - `stalled`: open PRs with no activity for STALL_DAYS, and no call since
 * - `over`: a plan past its hard end with PRs still open (with several
 *   plans, its own PRs, by the dates: model/work.ts planWork)
 * - `ended`: a plan past its hard end with none open: probably done
 *   (a soft end is an estimate, never asked about once it passes, and
 *   ongoing work has no end: roadmap.ts EndKind)
 * - `missed`: its target date passed with PRs open, and nobody replanned
 * - `off_track` / `at_risk`: its latest update says so, and the plan hasn't
 *   changed since
 * - `issue_closed`: its issue was closed after the plan last changed, and
 *   the plan still says it's going
 * - `reopened`: finished or dropped, on the roadmap or by closing its issue,
 *   a week or more ago, but PRs are still open or new ones keep opening
 *   (by the roadmap's call, never for a project marked ongoing)
 * - `moving`: parked, but its PRs changed after it was parked
 * - `issues_done`: every issue in its project is closed (model/work.ts),
 *   and the plan hasn't changed since the last one closed; only the plan
 *   running today is asked
 * Once initiatives are in use (model/initiatives.ts), five more:
 * - `unfiled`: a tracked project with no home, and 3+ PRs or a plan under
 *   way; a project already asked `new` files from that row instead
 * - `no_project`: an active plan with no project, which can't be filed in
 *   an initiative until it has one
 * - `untracked_grew`: a not-tracked project that grew (initiatives.ts grew)
 * - `goal_reached`: no project of an open initiative still going
 *   (initiatives.ts goingProjects), every plan in it stopped for
 *   GOAL_QUIET_DAYS, and no plan or filing in it changed since Keep open
 * - `reopened_in_closed`: a project in a closed initiative still going, on
 *   the project's own row when it has one
 * Every plan still under way is judged on its own, so a project's finished
 * first phase can't hide its second running late. A call is a roadmap write
 * (commit, park, finish, drop); any change to a plan counts as one.
 * With config.js projects.autoCalls on, Pulldasher makes the calls that
 * only say what already happened itself (model/autoCalls.ts), and Decide
 * leaves out what a call this pass answers (autoCalls.ts withoutAnswered).
 */

export const STALL_DAYS = 21;
/** open PRs plus merges in the last LIVE_DAYS below which a project ships
 * without a roadmap call */
export const DECIDE_MIN_PRS = 3;
/** days a finished or dropped project can keep PRs open before it's asked
 * about again */
const REOPEN_DAYS = 7;
/** days every project of an initiative has been finished or quiet before
 * Decide asks whether it reached its goal */
const GOAL_QUIET_DAYS = 14;
const DAY = 86400;

export type DecideReason =
   | { kind: 'new'; since: string | null }
   | { kind: 'stalled'; days: number }
   /** `since`: its PRs opened after its end (model/work.ts planWork) */
   | { kind: 'over'; weeks: number; since: number }
   | { kind: 'ended'; weeks: number; since: number }
   | { kind: 'missed'; due: string; open: number }
   | { kind: 'off_track' }
   | { kind: 'at_risk' }
   /** `open`: the plan's PRs still open */
   | { kind: 'issue_closed'; as: 'done' | 'dropped'; on: string; open: number }
   /** `late`: PRs opened more than a week after it was marked so */
   | {
        kind: 'reopened';
        open: number;
        late: number;
        as: 'done' | 'dropped';
        by: 'roadmap' | 'issue';
     }
   | { kind: 'moving' }
   /** `open`: the plan's PRs still open */
   | { kind: 'issues_done'; done: number; dropped: number; open: number }
   | { kind: 'unfiled' }
   | { kind: 'no_project' }
   /** `since`: PRs opened since it was set not tracked, against `baseline`,
    * its PR count then */
   | { kind: 'untracked_grew'; since: number; baseline: number }
   /** the row names no project: `initiative` is the one asked about */
   | { kind: 'goal_reached'; initiative: number }
   | { kind: 'reopened_in_closed'; initiative: number; as: 'done' | 'dropped' };

/** A not-tracked project that grew (model/initiatives.ts grew). */
export interface GrownProject {
   slug: string;
   since: number;
   baseline: number;
}

/** What the queue needs to know about a live project. */
export interface DecideProject {
   slug: string;
   /** its earliest open PR's day, YYYY-MM-DD, or null */
   firstOpened: string | null;
   /** epoch secs of its newest PR update or merge */
   lastActivity: number | null;
   /** its open PRs */
   open: number;
   /** its PRs open now or merged in the last LIVE_DAYS: how big it is */
   prs: number;
   /** its target's due day, YYYY-MM-DD, or null */
   due: string | null;
}

/** A closed project issue: GitHub's close reason, as done or dropped, and when. */
export interface ClosedIssue {
   as: 'done' | 'dropped';
   at: number;
}

/** The queue's input from Today's live projects. */
export function decideProjects(today: Pick<Today, 'live'>): DecideProject[] {
   return today.live.map(g => ({
      slug: g.slug,
      firstOpened: firstOpenDay(g),
      lastActivity: g.lastActivity,
      open: g.open.length,
      prs: g.open.length + g.merged.length,
      due: targetOf(g.project)?.due_on?.slice(0, 10) ?? null,
   }));
}

/** The closed project issues by slug: closing one is a decision too. */
export function closedIssues(
   projects: readonly Pick<Project, 'slug' | 'state' | 'state_reason' | 'closed_at'>[]
): Map<string, ClosedIssue> {
   const out = new Map<string, ClosedIssue>();
   for (const p of projects) {
      if (p.state !== 'closed') continue;
      out.set(p.slug, {
         as: p.state_reason === 'not_planned' ? 'dropped' : 'done',
         at: p.closed_at ? Date.parse(p.closed_at) / 1000 : 0,
      });
   }
   return out;
}

/** Whether a project with no plan owes a first call: PRs open, big enough to
 * plan, and its issue not closed. The load chart's weeks ahead count the
 * same projects, so small work stops counting once today is past. */
export function needsDecision(
   p: DecideProject,
   closed: ReadonlyMap<string, ClosedIssue> = new Map()
): boolean {
   return p.open > 0 && p.prs >= DECIDE_MIN_PRS && !closed.has(p.slug);
}

export interface DecideRow {
   /** the project; null for a plan with no project */
   slug: string | null;
   /** the roadmap item the call is about, if any */
   item: RoadmapItem | null;
   reasons: DecideReason[];
}

// worst first: work nobody should be doing, then decisions two records
// disagree on, then plans that slipped, then quiet work, then new work
// waiting for a first call
export const RANK: Record<DecideReason['kind'], number> = {
   reopened: 0,
   issue_closed: 1,
   moving: 2,
   off_track: 3,
   missed: 4,
   over: 5,
   ended: 6,
   issues_done: 7,
   stalled: 8,
   at_risk: 9,
   new: 10,
   // ahead of `reopened` on the row it joins: the initiative is asked first,
   // and every view's worst call (the Roadmap row, the Plan cell) is the
   // question Decide's sections ask
   reopened_in_closed: -1,
   goal_reached: 7,
   unfiled: 10,
   no_project: 10,
   untracked_grew: 10,
};

/** Whether nobody changed a plan's status since its end passed: an `ended`
 * plan Pulldasher finishes on its own. One a person put back under way
 * after its end stays as they left it. */
export function endedUnanswered(item: RoadmapItem): boolean {
   const changed = item.status_at ?? item.updated_at ?? 0;
   return changed < (dayStart(planEnd(item)) as number) + DAY;
}

/**
 * Whether a reason is one Pulldasher can answer itself (model/autoCalls.ts
 * autoCalls reads it), when its other rules agree: a first plan (`new`),
 * work picked up again (`reopened`, `moving`), and a plan finished by its
 * issues or its end with nothing left open. A closed issue with PRs still
 * open, or an end a person answered, never is.
 */
export function answeredOnItsOwn(reason: DecideReason, item: RoadmapItem | null): boolean {
   switch (reason.kind) {
      case 'new':
      case 'reopened':
      case 'moving':
         return true;
      case 'ended':
         return item != null && endedUnanswered(item);
      case 'issue_closed':
      case 'issues_done':
         return reason.open === 0;
      default:
         return false;
   }
}

/** A plan's PRs, by the dates (model/work.ts PlanWork), as Decide counts them. */
export interface PlanCounts {
   /** its PRs still open */
   openPulls: number;
   /** its PRs that opened after its end */
   afterEnd: number;
   /** for a plan marked done or dropped, its PRs opened more than a week after */
   afterDone: number;
}

/**
 * Whether Decide asks a plan "Is it done?": its project has issues, every one is
 * closed, and the plan hasn't changed since the last one closed.
 */
export function issuesAllClosed(item: RoadmapItem, counts: IssueCounts): boolean {
   return (
      counts.total > 0 &&
      counts.open === 0 &&
      (counts.lastClosedAt == null || counts.lastClosedAt > (item.updated_at ?? 0))
   );
}

/**
 * The plan Decide asks about a project's issues: its plan under way that has
 * started, the latest start (the higher id on a tie). The issues are the
 * project's, so only that one is asked. Null when none has started.
 */
export function planRunningToday(
   slug: string,
   items: readonly RoadmapItem[],
   today: string
): RoadmapItem | null {
   return (
      items
         .filter(p => p.project === slug && isUnderWay(p.status) && p.start <= today)
         .sort((a, b) => b.start.localeCompare(a.start) || b.id - a.id)[0] ?? null
   );
}

export function decideQueue({
   live,
   items,
   closed = new Map(),
   planCounts = new Map(),
   issues = new Map(),
   ongoing = new Set(),
   initiatives = [],
   grown = [],
   today,
   now,
}: {
   live: readonly DecideProject[];
   items: readonly RoadmapItem[];
   /** closed project issues, by slug */
   closed?: ReadonlyMap<string, ClosedIssue>;
   /** each plan's PRs by the dates, by plan id */
   planCounts?: ReadonlyMap<number, PlanCounts>;
   /** how each project's issues stand (model/work.ts), by slug */
   issues?: ReadonlyMap<string, IssueCounts>;
   /** projects that run with no end: they never owe a first plan, and a
    * finished plan of theirs isn't reopened by the work that follows */
   ongoing?: ReadonlySet<string>;
   /** every initiative, with the projects filed in it; none means the layer
    * isn't in use yet, so no project is asked where it belongs. `live` and
    * `items` must already leave not-tracked projects out */
   initiatives?: readonly Pick<Initiative, 'id' | 'kind' | 'status' | 'status_at' | 'projects'>[];
   /** not-tracked projects that grew, which `live` leaves out */
   grown?: readonly GrownProject[];
   /** the day `now` falls on where the team is (projects.ts dayIn): what
    * "overdue" is judged by, the vouch for an update included */
   today: string;
   now: number;
}): DecideRow[] {
   const sorted = [...items].sort((a, b) => a.priority - b.priority || a.id - b.id);
   const plansOf = new Map<string, RoadmapItem[]>();
   for (const item of sorted) {
      if (item.project) plansOf.set(item.project, [...(plansOf.get(item.project) ?? []), item]);
   }
   const rows = new Map<string, DecideRow>();
   const add = (
      slug: string | null,
      item: RoadmapItem | null,
      reason: DecideReason,
      key = `${slug ?? ''}:${item?.id ?? ''}`
   ) => {
      const row = rows.get(key) ?? { slug, item, reasons: [] };
      row.reasons.push(reason);
      rows.set(key, row);
   };
   const decidedAt = (item: RoadmapItem) => item.updated_at ?? 0;
   const weeksOver = (item: RoadmapItem) => weeksPast(planEnd(item), today);

   // what a plan under way owes; `project` is its live project, if any
   const planReasons = (item: RoadmapItem, project: DecideProject | null) => {
      const counts = planCounts.get(item.id);
      // a project with several plans counts each plan's own PRs (by the
      // dates), so a later plan's open PRs don't keep a finished one over;
      // with one plan, every PR of the project is its, as the board counts
      // them now
      const several = (item.project ? plansOf.get(item.project)?.length ?? 0 : 0) > 1;
      const open = counts && several ? counts.openPulls : project?.open ?? 0;
      const issue = item.project ? closed.get(item.project) : undefined;
      if (issue && issue.at > decidedAt(item)) {
         // the closed issue is the news; the plan's other troubles follow from it
         add(item.project, item, {
            kind: 'issue_closed',
            as: issue.as,
            on: utcDay(issue.at),
            open,
         });
         return;
      }
      // only a hard end is a commitment to ask about once it passes
      if (item.end_kind === 'hard' && planEnd(item) < today) {
         add(item.project, item, {
            kind: open > 0 ? 'over' : 'ended',
            weeks: weeksOver(item),
            since: counts?.afterEnd ?? 0,
         });
      }
      const attached = item.project ? issues.get(item.project) : undefined;
      if (
         attached &&
         planRunningToday(item.project ?? '', items, today)?.id === item.id &&
         issuesAllClosed(item, attached)
      ) {
         add(item.project, item, {
            kind: 'issues_done',
            done: attached.done,
            dropped: attached.dropped,
            open,
         });
      }
      const due = project?.due;
      // a replan after the target passed answers it
      if (due && due < today && open > 0 && decidedAt(item) < (dayStart(due) as number) + DAY) {
         add(item.project, item, { kind: 'missed', due, open });
      }
      const standing = healthStanding(item, now, today);
      const update =
         standing.kind === 'current' || standing.kind === 'stale' ? standing.update : null;
      // an update the plan already answered isn't owed a call again
      if (update && update.at > decidedAt(item)) {
         if (update.health === 'off_track') add(item.project, item, { kind: 'off_track' });
         else if (update.health === 'at_risk') add(item.project, item, { kind: 'at_risk' });
      }
   };

   for (const project of live) {
      const plans = plansOf.get(project.slug) ?? [];
      const going = plans.filter(p => isUnderWay(p.status));
      for (const item of going) planReasons(item, project);
      // with nothing under way, its latest plan is the decision, unless its
      // issue was closed after that
      const last = going.length
         ? null
         : plans.reduce<RoadmapItem | null>(
              (a, i) => (!a || decidedAt(i) > decidedAt(a) ? i : a),
              null
           );
      const issue = closed.get(project.slug);
      // open PRs gone quiet, and no call in that time
      const idle =
         project.lastActivity == null ? null : Math.floor((now - project.lastActivity) / DAY);
      const lastCall = Math.max(0, ...plans.map(decidedAt), issue?.at ?? 0);
      const holder = going[0] ?? last;
      const stalls =
         project.open > 0 &&
         idle != null &&
         idle >= STALL_DAYS &&
         now - lastCall >= STALL_DAYS * DAY &&
         holder?.status !== 'parked';
      if (!going.length) {
         if (issue && issue.at > (last ? decidedAt(last) : 0)) {
            if (project.open > 0 && now - issue.at >= REOPEN_DAYS * DAY) {
               add(project.slug, last, {
                  kind: 'reopened',
                  open: project.open,
                  late: 0,
                  as: issue.as,
                  by: 'issue',
               });
            }
         } else if (last?.status === 'parked') {
            if ((project.lastActivity ?? 0) > decidedAt(last)) {
               add(project.slug, last, { kind: 'moving' });
            }
         } else if (last && !ongoing.has(project.slug)) {
            // PRs still open a week after the call, or new ones opened after it;
            // an ongoing project's work goes on after each finished plan
            const late = planCounts.get(last.id)?.afterDone ?? 0;
            if ((project.open > 0 && now - decidedAt(last) >= REOPEN_DAYS * DAY) || late > 0) {
               add(project.slug, last, {
                  kind: 'reopened',
                  open: project.open,
                  late,
                  as: last.status === 'dropped' ? 'dropped' : 'done',
                  by: 'roadmap',
               });
            }
         } else if (!stalls && needsDecision(project, closed) && !ongoing.has(project.slug)) {
            // a stalled project's question is "park it?", not "plan it"
            add(project.slug, null, { kind: 'new', since: project.firstOpened });
         }
      }
      if (stalls) add(project.slug, holder, { kind: 'stalled', days: idle ?? 0 });
   }
   // plans under way whose project has nothing in flight, or no project
   const liveSlugs = new Set(live.map(p => p.slug));
   for (const item of sorted) {
      if (item.project && liveSlugs.has(item.project)) continue;
      if (isUnderWay(item.status)) planReasons(item, null);
   }
   initiativeReasons();
   return [...rows.values()].sort(compareRows);

   // where projects belong (model/initiatives.ts)
   function initiativeReasons() {
      for (const g of grown) {
         add(g.slug, null, { kind: 'untracked_grew', since: g.since, baseline: g.baseline });
      }
      if (!initiatives.length) return;
      const homes = homesOf(initiatives);
      const liveBySlug = new Map(live.map(p => [p.slug, p]));
      const openOf = (slug: string) => liveBySlug.get(slug)?.open ?? 0;
      const underWay = (slug: string) =>
         (plansOf.get(slug) ?? []).filter(p => isUnderWay(p.status));
      // on the project's own row when it has one (its worst, when two of
      // its plans are asked about), so a project is asked about once; else
      // on its first plan under way
      const ask = (slug: string, reason: DecideReason) => {
         const row = [...rows.values()].filter(r => r.slug === slug).sort(compareRows)[0];
         if (row) row.reasons.push(reason);
         else add(slug, underWay(slug)[0] ?? null, reason);
      };
      const unfiled = new Set([
         ...live.filter(p => p.prs >= DECIDE_MIN_PRS).map(p => p.slug),
         ...[...plansOf.keys()].filter(slug => underWay(slug).length),
      ]);
      for (const slug of unfiled) {
         if (homes.has(slug)) continue;
         // the first call files it too
         if ([...rows.values()].some(r => r.slug === slug && r.reasons.some(x => x.kind === 'new')))
            continue;
         ask(slug, { kind: 'unfiled' });
      }
      // a plan with no project has no home to give: once it's active, which
      // project is it?
      for (const item of items) {
         if (!item.project && item.status === 'active') add(null, item, { kind: 'no_project' });
      }
      for (const initiative of initiatives) {
         if (initiative.kind !== 'initiative') continue;
         const slugs = initiative.projects.map(f => f.project);
         const going = goingProjects(slugs, items, openOf);
         if (initiative.status !== 'open') {
            const as = initiative.status;
            for (const slug of going) {
               ask(slug, { kind: 'reopened_in_closed', initiative: initiative.id, as });
            }
            continue;
         }
         if (!slugs.length || going.length) continue;
         // every plan stopped, and no project with no plan merged lately
         // (Today's live holds the last LIVE_DAYS); when the last plan
         // stopped or the last project was filed here (a project filed
         // today hasn't settled in this initiative, so nothing asks on the
         // load's day), and when a plan or filing in it last changed. PR
         // activity on a finished project changes neither, so Keep open holds
         let settled = 0;
         let changed = 0;
         let quiet = true;
         for (const f of initiative.projects) {
            const plans = plansOf.get(f.project) ?? [];
            if (!plans.length && liveBySlug.has(f.project)) quiet = false;
            const times = plans.map(p => Math.max(p.status_at ?? 0, decidedAt(p)));
            settled = Math.max(settled, ...times, f.set_at);
            changed = Math.max(changed, settled, f.set_at);
         }
         if (!quiet || now - settled < GOAL_QUIET_DAYS * DAY) continue;
         // Keep open: asked again only once a plan or filing in it changes
         if (initiative.status_at != null && changed <= initiative.status_at) continue;
         add(
            null,
            null,
            { kind: 'goal_reached', initiative: initiative.id },
            `initiative:${initiative.id}`
         );
      }
   }
}

const rank = (row: DecideRow) => Math.min(...row.reasons.map(r => RANK[r.kind]));
const weight = (row: DecideRow) =>
   row.reasons.reduce((sum, r) => {
      if (r.kind === 'stalled') return sum + r.days;
      // past their end, the ones still taking new work come first
      if (r.kind === 'over' || r.kind === 'ended') return sum + r.since * 1000 + r.weeks * 7;
      return sum;
   }, 0);
const since = (row: DecideRow) => {
   const reason = row.reasons.find(r => r.kind === 'new');
   return reason?.kind === 'new' ? reason.since ?? '' : '';
};

/** The queue's order: the worst reason first, then the longest overdue or
 * idle, then the oldest new work. Exported so a view can put a row it just
 * decided back in its place. */
export function compareRows(a: DecideRow, b: DecideRow): number {
   return (
      rank(a) - rank(b) ||
      weight(b) - weight(a) ||
      since(a).localeCompare(since(b)) ||
      (a.slug ?? '').localeCompare(b.slug ?? '') ||
      (a.item?.id ?? 0) - (b.item?.id ?? 0)
   );
}
