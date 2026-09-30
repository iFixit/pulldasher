import { dayStart, type Today } from './projects';
import { healthStanding, planEnd, type RoadmapItem } from './roadmap';

/**
 * The decisions owed this week, for the Decide view and GET /api/v1/decide:
 * the job a product manager would do in a weekly triage, as a queue that
 * empties. A project lands here when it needs a call:
 * - `new`: in flight with no decision on the roadmap yet
 * - `stalled`: open PRs with no activity for STALL_DAYS
 * - `over`: a plan past its end, its project still in flight
 * - `ended`: a plan past its end with nothing in flight: probably done
 * - `off_track` / `at_risk`: its latest update says so, and the plan hasn't
 *   changed since
 * - `reopened`: finished or dropped, but PRs are still open
 * - `moving`: parked, but its PRs moved after it was parked
 * A decision takes it out: commit (plan it), park, finish or drop, which
 * are roadmap writes. Reasons a decision can't clear, like a stall, stay
 * quiet for STALL_DAYS after one.
 */

export const STALL_DAYS = 21;
const DAY = 86400;

export type DecideReason =
   | { kind: 'new'; since: string | null }
   | { kind: 'stalled'; days: number }
   | { kind: 'over'; weeks: number }
   | { kind: 'ended'; weeks: number }
   | { kind: 'off_track' }
   | { kind: 'at_risk' }
   | { kind: 'reopened'; open: number }
   | { kind: 'moving' };

/** What the queue needs to know about a live project. */
export interface DecideProject {
   slug: string;
   /** its earliest open PR's day, YYYY-MM-DD, or null */
   firstOpened: string | null;
   /** epoch secs of its newest PR update or merge */
   lastActivity: number | null;
   /** its open PRs */
   open: number;
}

/** The queue's input from Today's live projects. */
export function decideProjects(today: Pick<Today, 'live'>): DecideProject[] {
   return today.live.map(g => ({
      slug: g.slug,
      firstOpened: g.open.map(p => p.data.created_at.slice(0, 10)).sort()[0] ?? null,
      lastActivity: g.lastActivity,
      open: g.open.length,
   }));
}

export interface DecideRow {
   /** the project; null for a plan with no project */
   slug: string | null;
   /** the roadmap item that holds its decision, if any */
   item: RoadmapItem | null;
   reasons: DecideReason[];
}

// worst first: work nobody should be doing, then plans that slipped, then
// quiet work, then new work waiting for a first call
const RANK: Record<DecideReason['kind'], number> = {
   reopened: 0,
   moving: 1,
   off_track: 2,
   over: 3,
   ended: 4,
   stalled: 5,
   at_risk: 6,
   new: 7,
};

export function decideQueue({
   live,
   items,
   today,
   now,
}: {
   live: readonly DecideProject[];
   items: readonly RoadmapItem[];
   today: string;
   now: number;
}): DecideRow[] {
   // each project's decision is its first item by priority
   const itemFor = new Map<string, RoadmapItem>();
   for (const item of [...items].sort((a, b) => a.priority - b.priority || a.id - b.id)) {
      if (item.project && !itemFor.has(item.project)) itemFor.set(item.project, item);
   }
   const weeksPast = (item: RoadmapItem) =>
      Math.ceil(((dayStart(today) as number) - (dayStart(planEnd(item)) as number)) / (7 * DAY));
   const underWay = (item: RoadmapItem) => item.status === 'planned' || item.status === 'active';
   const decidedAt = (item: RoadmapItem) => item.updated_at ?? 0;
   const reasonsFor = (item: RoadmapItem, inFlight: boolean): DecideReason[] => {
      const reasons: DecideReason[] = [];
      if (!underWay(item)) return reasons;
      if (planEnd(item) < today) {
         reasons.push(
            inFlight
               ? { kind: 'over', weeks: weeksPast(item) }
               : { kind: 'ended', weeks: weeksPast(item) }
         );
      }
      const standing = healthStanding(item, now);
      const update =
         standing.kind === 'current' || standing.kind === 'stale' ? standing.update : null;
      // an update the plan already answered isn't owed a call again
      if (update && update.at > decidedAt(item)) {
         if (update.health === 'off_track') reasons.push({ kind: 'off_track' });
         else if (update.health === 'at_risk') reasons.push({ kind: 'at_risk' });
      }
      return reasons;
   };

   const rows: DecideRow[] = [];
   const liveSlugs = new Set(live.map(p => p.slug));
   for (const project of live) {
      const item = itemFor.get(project.slug) ?? null;
      const reasons: DecideReason[] = [];
      if (!item) reasons.push({ kind: 'new', since: project.firstOpened });
      else if (item.status === 'parked') {
         if ((project.lastActivity ?? 0) > decidedAt(item)) reasons.push({ kind: 'moving' });
      } else if (item.status === 'done' || item.status === 'dropped') {
         if (project.open > 0 && now - decidedAt(item) >= 7 * DAY) {
            reasons.push({ kind: 'reopened', open: project.open });
         }
      } else reasons.push(...reasonsFor(item, true));
      const idle =
         project.lastActivity == null ? null : Math.floor((now - project.lastActivity) / DAY);
      const quietSinceDecision = !item || now - decidedAt(item) >= STALL_DAYS * DAY;
      if (
         project.open > 0 &&
         idle != null &&
         idle >= STALL_DAYS &&
         quietSinceDecision &&
         item?.status !== 'parked'
      ) {
         reasons.push({ kind: 'stalled', days: idle });
      }
      if (reasons.length) rows.push({ slug: project.slug, item, reasons });
   }
   // plans whose project has nothing in flight, or that have no project
   for (const item of items) {
      if (item.project && liveSlugs.has(item.project)) continue;
      if (item.project && itemFor.get(item.project) !== item) continue;
      const reasons = reasonsFor(item, false);
      if (reasons.length) rows.push({ slug: item.project, item, reasons });
   }
   return rows.sort(compareRows);
}

const rank = (row: DecideRow) => Math.min(...row.reasons.map(r => RANK[r.kind]));
const weight = (row: DecideRow) =>
   row.reasons.reduce((sum, r) => {
      if (r.kind === 'stalled') return sum + r.days;
      if (r.kind === 'over' || r.kind === 'ended') return sum + r.weeks * 7;
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
      (a.slug ?? '').localeCompare(b.slug ?? '')
   );
}
