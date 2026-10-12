import { n } from '../../../shared/format';
import type { GrownProject } from '../../../shared/model/decide';
import { homesOf, initiativeSpan, type Initiative } from '../../../shared/model/initiatives';
import type { Today } from '../../../shared/model/projects';
import type { RoadmapItem } from '../../../shared/model/roadmap';
import type { PortfolioItem } from './portfolio';
import { dayWords, type ProjectsData } from './projectData';
import { byRank, untrackedNow } from './initiativesData';

/**
 * The board's side of initiatives (shared/model/initiatives.ts): the tracked
 * Today, the grown projects Decide asks about, a guess at an Unsorted
 * project's home, and the words an initiative's band and page say.
 */

/** The slug of the home Unsorted stands for: a project with no filing. */
export const UNSORTED = 'unsorted';

/** Today without the Not tracked projects: what every count and question
 * reads. PRs outside any project stay, since they're in no project. */
export function trackedToday(today: Today, untracked: ReadonlySet<string>): Today {
   if (!untracked.size) return today;
   return {
      ...today,
      live: today.live.filter(g => !untracked.has(g.slug)),
      quiet: today.quiet.filter(g => !untracked.has(g.slug)),
   };
}

/** The Not tracked projects that grew, for decideQueue's `grown`: the
 * server's list, less any tracked by a filing made on this board since. A
 * Keep made here leaves its row until the refetch that follows every write,
 * and the row's receipt stands meanwhile. */
export function grownProjects(
   data: Pick<ProjectsData, 'grew' | 'grew_counts'> | null | undefined,
   initiatives: readonly Initiative[] | null
): GrownProject[] {
   return (data?.grew ?? []).flatMap(slug => {
      const counts = data?.grew_counts?.[slug];
      return counts && untrackedNow(slug, true, initiatives) ? [{ slug, ...counts }] : [];
   });
}

/**
 * Where an Unsorted project probably belongs: the initiative (or Keep the
 * lights on) its people work in most, counting each person once per other
 * project of theirs filed there. Null with nothing to go on. Never asked of
 * a filed project: its home is the default, so taking it blind moves
 * nothing.
 */
export function guessHome(
   slug: string,
   items: readonly Pick<PortfolioItem, 'slug' | 'developers' | 'nonDevelopers'>[],
   initiatives: readonly Initiative[]
): Initiative | null {
   const homes = homesOf(initiatives);
   const mine = items.find(i => i.slug === slug);
   if (!mine) return null;
   const people = new Set([...mine.developers, ...mine.nonDevelopers]);
   const tally = new Map<number, { initiative: Initiative; count: number }>();
   for (const other of items) {
      if (other.slug === slug) continue;
      const home = homes.get(other.slug)?.initiative;
      if (!home || home.kind === 'untracked' || home.status !== 'open') continue;
      const shared = [...other.developers, ...other.nonDevelopers].filter(p => people.has(p));
      if (!shared.length) continue;
      const t = tally.get(home.id) ?? { initiative: home, count: 0 };
      t.count += shared.length;
      tally.set(home.id, t);
   }
   const best = [...tally.values()].sort(
      (a, b) =>
         b.count - a.count ||
         a.initiative.priority - b.initiative.priority ||
         a.initiative.id - b.initiative.id
   )[0];
   return best?.initiative ?? null;
}

/** The homes a project can be filed in, as a chooser lists them: the open
 * initiatives in rank order (Keep the lights on among them), then Not
 * tracked. */
export function homeChoices(initiatives: readonly Initiative[]): Initiative[] {
   const open = byRank(initiatives).filter(i => i.status === 'open');
   return [
      ...open.filter(i => i.kind !== 'untracked'),
      ...open.filter(i => i.kind === 'untracked'),
   ];
}

/** "in Release safety", "in Keep the lights on", "Not tracked", "in no
 * initiative": where a project lives, mid-sentence. */
export function homeWords(home: Pick<Initiative, 'name' | 'kind'> | null | undefined): string {
   if (!home) return 'in no initiative';
   return home.kind === 'untracked' ? 'Not tracked' : `in ${home.name}`;
}

/** An initiative's span and counts as its band says them, in ink: "Jul 13
 * to Nov 1 · 1 with an end · 3 ongoing", or "Ended Sep 30", or nothing for
 * one with no plans. Dates come from its projects' plans (initiativeSpan). */
export function spanWords(
   projects: readonly string[],
   plans: readonly Pick<RoadmapItem, 'project' | 'status' | 'start' | 'weeks' | 'end_kind'>[],
   now: number = Date.now()
): string {
   const span = initiativeSpan(projects, plans);
   if (!span.start) return '';
   const day = (d: string) => dayWords(d, { now });
   if (span.end_kind === 'ended') return span.ended ? `Ended ${day(span.ended)}` : '';
   const parts = [
      span.end ? `${day(span.start)} to ${day(span.end)}` : `Since ${day(span.start)}`,
      span.with_end ? `${span.with_end} with an end` : '',
      span.ongoing ? `${span.ongoing} ongoing` : '',
   ];
   return parts.filter(Boolean).join(' · ');
}

/** What an initiative's band says on hover: its goal, its owner, and how
 * much it holds ("10 projects, 7 being worked on"). */
export function bandGloss(
   initiative: Pick<Initiative, 'name' | 'goal' | 'owner' | 'kind'>,
   projects: number,
   working: number
): string {
   const held = `${n(projects, 'project')}, ${working} being worked on`;
   const owner = initiative.owner ? ` Owner: ${initiative.owner}.` : '';
   const goal = initiative.goal ? `${initiative.goal.replace(/\.?$/, '.')} ` : '';
   return `${goal}${held}.${owner}`;
}
