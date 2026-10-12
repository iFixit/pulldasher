import { n } from '../../../shared/format';
import type { GrownProject } from '../../../shared/model/decide';
import { homesOf, initiativeSpan, type Initiative } from '../../../shared/model/initiatives';
import { MISC_SLUG, type Today } from '../../../shared/model/projects';
import { weeksPast, type RoadmapItem } from '../../../shared/model/roadmap';
import type { PortfolioItem } from './portfolio';
import { dayWords, type ProjectsData } from './projectData';
import { byRank, isNotTrackedNow } from './initiativesData';
import { NOT_IN_A_PROJECT, ONE_OFFS, UNSORTED_WORD } from './words';

/**
 * The board's side of initiatives (shared/model/initiatives.ts): the tracked
 * Today, the grown projects Decide asks about, a guess at an Unsorted
 * project's home, and the words an initiative's band and page say.
 */

/** The key Unsorted stands for (a project with no filing) in a lane, the
 * Initiative switch and Look back's split: never a slug, so no initiative
 * can share it (PROJECT_SLUG takes no parentheses). */
export const UNSORTED = '(unsorted)';
/** The key for plans with no project, which no initiative can hold. */
export const NO_PROJECT = '(no-project)';

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
      return counts && isNotTrackedNow(slug, true, initiatives) ? [{ slug, ...counts }] : [];
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

/** "in Release safety", "in Keep the lights on", "Not tracked",
 * "Unsorted": where a project lives, mid-sentence. */
export function homeWords(home: Pick<Initiative, 'name' | 'kind'> | null | undefined): string {
   if (!home) return UNSORTED_WORD;
   return home.kind === 'untracked' ? 'Not tracked' : `in ${home.name}`;
}

/** An initiative's span and counts as its band says them, in ink: "Jul 13
 * to Nov 1 · 1 plan with an end date · 3 ongoing", or "Ended Sep 30", or nothing for
 * one with no plans. Dates come from its projects' plans (initiativeSpan). */
export function spanWords(
   projects: readonly string[],
   plans: readonly Pick<RoadmapItem, 'project' | 'status' | 'start' | 'weeks' | 'end_kind'>[],
   now: number = Date.now(),
   initiative?: Pick<Initiative, 'status' | 'status_at'>
): string {
   // a closed one says so, as the Overview and its page do
   if (initiative && initiative.status !== 'open') return closedWords(initiative, now);
   const span = initiativeSpan(projects, plans);
   if (!span.start) return '';
   const day = (d: string) => dayWords(d, { now });
   // every plan stopped, but it's open: not "Ended", which reads as closed
   if (span.end_kind === 'ended') {
      return span.ended ? `Nothing under way since ${day(span.ended)}` : '';
   }
   // a latest end already gone by reads as finished unless it says so
   const today = new Date(now).toISOString().slice(0, 10);
   const past = span.end && span.end < today ? weeksPast(span.end, today) : 0;
   const parts = [
      span.end
         ? `${day(span.start)} to ${day(span.end)}${past ? `, ${n(past, 'week')} past` : ''}`
         : `Since ${day(span.start)}`,
      ...endParts(span),
   ];
   return parts.filter(Boolean).join(' · ');
}

/** How many of its plans have an end and how many are ongoing: "2 plans
 * with an end date", "1 ongoing", each only when there are any. */
export function endParts(span: { with_end: number; ongoing: number }): string[] {
   return [
      span.with_end ? `${n(span.with_end, 'plan')} with an end date` : '',
      span.ongoing ? `${span.ongoing} ongoing` : '',
   ].filter(Boolean);
}

/** A closed initiative, in one phrase everywhere: "Closed as done Sep 20". */
export function closedWords(
   initiative: Pick<Initiative, 'status' | 'status_at'>,
   now: number = Date.now()
): string {
   const on =
      initiative.status_at != null
         ? ` ${dayWords(new Date(initiative.status_at * 1000).toISOString().slice(0, 10), { now })}`
         : '';
   return `Closed as ${initiative.status}${on}`;
}

/** What an initiative's band says on hover, on the Roadmap and the
 * Overview alike: its goal, how much it holds ("10 projects, 7 being worked
 * on"), its owner, and whether it's closed. */
export function bandGloss(
   initiative: Pick<Initiative, 'name' | 'goal' | 'owner' | 'kind' | 'status' | 'status_at'>,
   projects: number,
   working: number
): string {
   const held = `${n(projects, 'project')}, ${working} being worked on`;
   const owner = initiative.owner ? ` Owned by ${initiative.owner}.` : '';
   const goal = initiative.goal ? `${initiative.goal.replace(/\.?$/, '.')} ` : '';
   const closed = initiative.status === 'open' ? '' : ` ${closedWords(initiative)}.`;
   return `${goal}${held}.${owner}${closed}`;
}

/** Look back's split by initiative: the group a PR's project's days go
 * in. Not tracked is one group, filed there or by its repo. */
export const SPLIT_UNSORTED = UNSORTED;
export const SPLIT_NOT_TRACKED = '(not-tracked)';
export const SPLIT_ONE_OFFS = '(one-offs)';
export const SPLIT_NO_PROJECT = '(none)';

/** A PR's project's group in Look back's split by initiative: its
 * initiative's slug (Keep the lights on among them), Not tracked, Unsorted
 * for a project filed nowhere, small work, or no project at all. */
export function initiativeSplitKey(
   project: string | null,
   homes: ReadonlyMap<string, { initiative: Pick<Initiative, 'slug' | 'kind'> }>,
   untracked: ReadonlySet<string>
): string {
   if (!project) return SPLIT_NO_PROJECT;
   if (project === MISC_SLUG) return SPLIT_ONE_OFFS;
   const home = homes.get(project)?.initiative;
   if (home?.kind === 'untracked' || (!home && untracked.has(project))) return SPLIT_NOT_TRACKED;
   return home ? home.slug : SPLIT_UNSORTED;
}

/** That split's groups in order: the initiatives in their rank, then
 * Unsorted, Not tracked, small work and no project. */
export function initiativeSplitRank(initiatives: readonly Initiative[]): (key: string) => number {
   const order = byRank(initiatives)
      .filter(i => i.kind !== 'untracked')
      .map(i => i.slug);
   const tail = [SPLIT_UNSORTED, SPLIT_NOT_TRACKED, SPLIT_ONE_OFFS, SPLIT_NO_PROJECT];
   return key =>
      tail.includes(key)
         ? order.length + tail.indexOf(key)
         : order.indexOf(key) < 0
         ? order.length - 0.5
         : order.indexOf(key);
}

/** A group of that split by name, in the words the Projects table uses. */
export function initiativeSplitLabel(key: string, initiatives: readonly Initiative[]): string {
   switch (key) {
      case SPLIT_UNSORTED:
         return UNSORTED_WORD;
      case SPLIT_NOT_TRACKED:
         return 'Not tracked';
      case SPLIT_ONE_OFFS:
         return ONE_OFFS;
      case SPLIT_NO_PROJECT:
         return NOT_IN_A_PROJECT;
      default:
         return initiatives.find(i => i.slug === key)?.name ?? key;
   }
}
