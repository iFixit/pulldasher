import { MISC_SLUG } from './projects';
import {
   addWeeks,
   endOf,
   isUnderWay,
   mondayOf,
   planEnd,
   planFor,
   type RoadmapItem,
   type RoadmapOrigin,
} from './roadmap';

/**
 * How loaded each week is, for the roadmap's load chart, each team lane's
 * words, and GET /api/v1/load: the projects in flight, split by whether the
 * roadmap has decided on them. Weeks up to this one count what the PRs did.
 * Weeks ahead count, if nothing changes: each plan until its planned end
 * (one already past its end, with its project still open, keeps counting,
 * since nothing says it's done; ongoing work, with no end, counts every week
 * from its start), and every open project big enough to owe a decision that
 * has none. Parked, finished and dropped work counts only in the past.
 */

/** A project's real span: its first PR in the horizon to its last merge or
 * close, with `end` null while it's still in flight. */
export interface InFlightSpan {
   slug: string;
   start: string;
   end: string | null;
}

/** How many of a week's projects on the roadmap came from where: `unsaid`
 * for a plan nobody has said it about. */
export type OriginCounts = Record<RoadmapOrigin | 'unsaid', number>;

export interface LoadWeek {
   /** the Monday that starts it */
   week: string;
   /** on the roadmap: planned or decided on */
   onPlan: number;
   /** onPlan, split by where each plan's work came from */
   origins: OriginCounts;
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

/** What one week counts: the projects, and whether the roadmap has each,
 * and the plans. */
export interface WeekMembers {
   projects: Map<string, 'on' | 'off'>;
   /** plans running that week, or past their end with their project still open */
   plans: Set<number>;
}

/**
 * The rules above as a lookup from a week to what it counts, so the chart's
 * numbers and a picked week's rows can't disagree. A project counts once,
 * however many of its plans run that week. `ahead` names the projects with
 * no plan to keep counting after this week (decide.ts's needsDecision);
 * every open one when left out.
 */
export function weekMembers({
   today,
   plans,
   spans,
   ahead,
}: {
   today: string;
   plans: readonly RoadmapItem[];
   spans: readonly InFlightSpan[];
   ahead?: ReadonlySet<string>;
}): (week: string) => WeekMembers {
   const thisWeek = mondayOf(today);
   const kept = plans.filter(p => p.status !== 'dropped');
   // every project the roadmap has a word on, dropped included: a dropped
   // project isn't "no plan", it's a decision
   const decided = new Set(plans.flatMap(p => (p.project ? [p.project] : [])));
   const onRoadmap = new Set(kept.flatMap(p => (p.project ? [p.project] : [])));
   const open = new Set(spans.filter(s => s.end == null).map(s => s.slug));
   const undecided = [...(ahead ?? open)].filter(slug => open.has(slug) && !decided.has(slug));
   const running = (p: RoadmapItem, week: string) =>
      p.start <= sunday(week) && (endOf(p) ?? week) >= week;
   return week => {
      const projects = new Map<string, 'on' | 'off'>();
      const counted = new Set<number>();
      if (week <= thisWeek) {
         for (const s of spans) {
            if (s.start <= sunday(week) && (s.end ?? today) >= week) {
               projects.set(s.slug, onRoadmap.has(s.slug) ? 'on' : 'off');
            }
         }
         // a plan with no PRs yet is still work in flight once it's under way
         for (const p of kept) {
            if (!p.project && (p.status === 'active' || p.status === 'done') && running(p, week)) {
               counted.add(p.id);
            }
         }
         return { projects, plans: counted };
      }
      for (const p of kept) {
         if (!isUnderWay(p.status)) continue;
         // past its end already and still open: it keeps going
         const end = endOf(p);
         const overrun = !!p.project && open.has(p.project) && end != null && end < thisWeek;
         if (running(p, week) || overrun) {
            counted.add(p.id);
            if (p.project) projects.set(p.project, 'on');
         }
      }
      for (const slug of undecided) projects.set(slug, 'off');
      return { projects, plans: counted };
   };
}

export function loadByWeek({
   weeks,
   today,
   plans,
   spans,
   ahead,
}: {
   weeks: readonly string[];
   today: string;
   plans: readonly RoadmapItem[];
   spans: readonly InFlightSpan[];
   ahead?: ReadonlySet<string>;
}): LoadWeek[] {
   const members = weekMembers({ today, plans, spans, ahead });
   const byId = new Map(plans.map(p => [p.id, p]));
   const linked = new Set(plans.flatMap(p => (p.project ? [p.id] : [])));
   const thisWeek = mondayOf(today);
   // a project's origin is its speaking plan's, the same plan its row shows
   const originOf = new Map<string, RoadmapOrigin | null>();
   const projectOrigin = (slug: string) => {
      if (!originOf.has(slug)) originOf.set(slug, planFor(slug, plans)?.origin ?? null);
      return originOf.get(slug) ?? 'unsaid';
   };
   return weeks.map(week => {
      const m = members(week);
      let onPlan = 0;
      let offPlan = 0;
      const origins: OriginCounts = { asked: 0, fire: 0, chosen: 0, unsaid: 0 };
      for (const [slug, standing] of m.projects) {
         if (standing === 'on') {
            onPlan++;
            origins[projectOrigin(slug)]++;
         } else offPlan++;
      }
      // a plan with a project counts as its project; one without, by itself
      for (const id of m.plans) {
         if (linked.has(id)) continue;
         onPlan++;
         origins[byId.get(id)?.origin ?? 'unsaid']++;
      }
      return { week, onPlan, origins, offPlan, projected: week > thisWeek };
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
