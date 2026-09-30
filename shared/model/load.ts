import { MISC_SLUG } from './projects';
import { addWeeks, mondayOf, planEnd, type RoadmapItem } from './roadmap';

/**
 * How loaded each week is, for the roadmap's load chart, each team lane's
 * words, and GET /api/v1/load: the projects in flight, split by whether the
 * roadmap has decided on them. Weeks up to this one count what the PRs did.
 * Weeks ahead count, if nothing changes: each plan until its planned end
 * (one already past its end, with its project still open, keeps counting,
 * since nothing says it's done), and every open project with no decision
 * at all. Parked, finished and dropped work counts only in the past.
 */

/** A project's real span: its first PR in the horizon to its last merge or
 * close, with `end` null while it's still in flight. */
export interface InFlightSpan {
   slug: string;
   start: string;
   end: string | null;
}

export interface LoadWeek {
   /** the Monday that starts it */
   week: string;
   /** on the roadmap: planned or decided on */
   onPlan: number;
   /** in flight with no plan or decision */
   offPlan: number;
   /** after this week, so counted from the plan rather than from PRs */
   projected: boolean;
}

/** Every Monday from the week holding `from` up to `to`, `to` not included. */
export function mondaysBetween(from: string, to: string): string[] {
   const out: string[] = [];
   for (let week = mondayOf(from); week < to; week = addWeeks(week, 1)) out.push(week);
   return out;
}

const sunday = (week: string) => planEnd({ start: week, weeks: 1 });
const underWay = (p: RoadmapItem) => p.status === 'planned' || p.status === 'active';

export function loadByWeek({
   weeks,
   today,
   plans,
   spans,
}: {
   weeks: readonly string[];
   today: string;
   plans: readonly RoadmapItem[];
   spans: readonly InFlightSpan[];
}): LoadWeek[] {
   const thisWeek = mondayOf(today);
   const kept = plans.filter(p => p.status !== 'dropped');
   // every project the roadmap has a word on, dropped included: a dropped
   // project isn't "no plan", it's a decision
   const decided = new Set(plans.flatMap(p => (p.project ? [p.project] : [])));
   const onRoadmap = new Set(kept.flatMap(p => (p.project ? [p.project] : [])));
   const open = new Set(spans.filter(s => s.end == null).map(s => s.slug));
   const running = (p: RoadmapItem, week: string) => p.start <= sunday(week) && planEnd(p) >= week;
   return weeks.map(week => {
      if (week <= thisWeek) {
         const inFlight = spans.filter(s => s.start <= sunday(week) && (s.end ?? today) >= week);
         const onPlan = inFlight.filter(s => onRoadmap.has(s.slug)).length;
         // a plan with no PRs yet is still work in flight once it's under way
         const planOnly = kept.filter(
            p => !p.project && (p.status === 'active' || p.status === 'done') && running(p, week)
         ).length;
         return {
            week,
            onPlan: onPlan + planOnly,
            offPlan: inFlight.filter(s => !onRoadmap.has(s.slug)).length,
            projected: false,
         };
      }
      const onPlan = kept.filter(
         p =>
            underWay(p) &&
            (running(p, week) ||
               // past its end already and still open: it keeps going
               (!!p.project && open.has(p.project) && planEnd(p) < thisWeek))
      ).length;
      const offPlan = [...open].filter(slug => !decided.has(slug)).length;
      return { week, onPlan, offPlan, projected: true };
   });
}

/** The busiest week from this one on, in plans and projects together; null
 * when nothing is in flight. */
export function peakFrom(
   weeks: readonly LoadWeek[],
   today: string
): { count: number; week: string } | null {
   const thisWeek = mondayOf(today);
   let peak: { count: number; week: string } | null = null;
   for (const w of weeks) {
      const count = w.onPlan + w.offPlan;
      if (w.week >= thisWeek && count > (peak?.count ?? 0)) peak = { count, week: w.week };
   }
   return peak;
}

/**
 * Each project's span from a window's numbers: open ones run to today, the
 * rest end at their last merge or close. `live` names the projects with work
 * in flight now, and where each started when the window doesn't say.
 */
export function spansFrom(
   history: Record<string, { first_opened: string | null; last_closed: string | null }>,
   live: Record<string, string | null>,
   from: string
): InFlightSpan[] {
   const spans: InFlightSpan[] = [];
   for (const [slug, firstOpen] of Object.entries(live)) {
      const start = history[slug]?.first_opened ?? firstOpen;
      if (start) spans.push({ slug, start, end: null });
   }
   for (const [slug, w] of Object.entries(history)) {
      if (slug in live || !slug || slug === MISC_SLUG) continue;
      if (w.first_opened && w.last_closed && w.last_closed >= from) {
         spans.push({ slug, start: w.first_opened, end: w.last_closed });
      }
   }
   return spans;
}
