import { isUnderWay, planEnd, planFor, type RoadmapItem } from '../../../shared/model/roadmap';
import type { PortfolioItem } from './portfolio';

/** One piece of a team's work being worked on. */
export interface InFlight {
   name: string;
   slug: string | null;
   /** its plan, when the roadmap has it */
   id: number | null;
}

/** how recently a done or parked project's PRs must have moved to still
 * take someone's time this week */
const MOVING_DAYS = 7;

/**
 * What a team's developers have on this week, in priority order: the one
 * count the roadmap's team lanes (their words, and the line where the people
 * run out) and Decide's team sentence share, so the two can't disagree.
 * First its plans, by the roadmap's order, one per project: a plan under way
 * whose project has PRs open (with no project, one marked in progress and in
 * its weeks), and a done or parked plan whose PRs are still open and moved
 * in the last week, since those PRs take people's time too. Then its
 * projects with PRs open and no plan (a dropped plan is none), the
 * longest-running first. Past the team's developers, the rest have nobody
 * left to staff them.
 */
export function teamLoad(
   team: string,
   plans: readonly RoadmapItem[],
   items: readonly (Pick<PortfolioItem, 'slug' | 'name' | 'team' | 'open' | 'openSince'> &
      Partial<Pick<PortfolioItem, 'lastActivity'>>)[],
   today: string
): InFlight[] {
   const bySlug = new Map(items.map(i => [i.slug, i]));
   const kept = plans.filter(p => p.status !== 'dropped');
   const onRoadmap = new Set(kept.flatMap(p => (p.project ? [p.project] : [])));
   // a project's PRs count once, for the plan that speaks for it
   // (roadmap.ts planFor): the first under way, or else its latest call
   const speaker = new Map([...onRoadmap].map(slug => [slug, planFor(slug, kept)?.id]));
   const going = (p: RoadmapItem) => {
      if (!p.project) return p.status === 'active' && p.start <= today && planEnd(p) >= today;
      const work = bySlug.get(p.project);
      if (!work?.open || speaker.get(p.project) !== p.id) return false;
      return isUnderWay(p.status) || (work.lastActivity?.days ?? MOVING_DAYS) < MOVING_DAYS;
   };
   const planned = [...kept]
      .sort((a, b) => a.priority - b.priority || a.id - b.id)
      .filter(p => p.team === team && going(p))
      .map(p => ({ name: p.name, slug: p.project, id: p.id }));
   const loose = items
      .filter(i => i.team === team && i.open > 0 && !onRoadmap.has(i.slug))
      .sort(
         (a, b) =>
            (a.openSince ?? today).localeCompare(b.openSince ?? today) ||
            a.name.localeCompare(b.name)
      )
      .map(i => ({ name: i.name, slug: i.slug, id: null }));
   return [...planned, ...loose];
}
