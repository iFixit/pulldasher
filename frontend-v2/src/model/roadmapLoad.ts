import { addWeeks, mondayOf, planEnd, type RoadmapItem } from '../../../shared/model/roadmap';

/**
 * How loaded each week is, for the roadmap's load chart and each team
 * lane's words: the projects in flight, split by whether the roadmap plans
 * for them. Weeks up to this one count what the PRs did; later weeks count
 * only the plan, since a project with no plan has no end to draw.
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
   /** in flight on the roadmap: linked projects' PRs, and plans under way */
   onPlan: number;
   /** in flight with no plan covering it; 0 after this week */
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
   const linked = new Set(kept.flatMap(p => (p.project ? [p.project] : [])));
   const running = (p: RoadmapItem, week: string) => p.start <= sunday(week) && planEnd(p) >= week;
   return weeks.map(week => {
      if (week <= thisWeek) {
         const inFlight = spans.filter(s => s.start <= sunday(week) && (s.end ?? today) >= week);
         const onPlan = inFlight.filter(s => linked.has(s.slug)).length;
         // a plan with no PRs yet is still work in flight once it's under way
         const planOnly = kept.filter(
            p => !p.project && (p.status === 'active' || p.status === 'done') && running(p, week)
         ).length;
         return {
            week,
            onPlan: onPlan + planOnly,
            offPlan: inFlight.length - onPlan,
            projected: false,
         };
      }
      const planned = kept.filter(
         p => (p.status === 'planned' || p.status === 'active') && running(p, week)
      ).length;
      return { week, onPlan: planned, offPlan: 0, projected: true };
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
