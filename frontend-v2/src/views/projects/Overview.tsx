import { useMemo, type ReactNode } from 'react';
import { n } from '../../../../shared/format';
import { STALL_DAYS, type DecideRow } from '../../../../shared/model/decide';
import type { Today } from '../../../../shared/model/projects';
import { LoadFailed } from '../../components/bits';
import { Fold, FoldRows, laneShown, RestGroup } from '../../components/Lane';
import type { RowOptions } from '../../components/Row';
import {
   AGE_BUCKETS,
   bucketDays,
   bucketOf,
   ENDS_SOON_DAYS,
   IDLE_BUCKETS,
   withCalls,
   withWorkers,
   type BucketDef,
   type PortfolioItem,
} from '../../model/portfolio';
import { refreshProjectsData, type ProjectsData } from '../../model/projectData';
import { median, peopleByProject } from '../../model/retro';
import { days, NOT_IN_A_PROJECT } from '../../model/words';
import { StatsCard } from '../stats/parts';
import type { Bucket } from './charts';
import { BucketChart, ChartSlot } from './lazyCharts';
import { switchView, Tile, type Navigate, type ProjectsNav } from './parts';
import { Portfolio } from './Portfolio';
import { useWhoIsOnWhat, type WhoRow } from './WhoIsOnWhat';

/** Scroll a section of the page into view, under the sticky header. */
const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: 'start' });

/** "dana and erin", or the first two and how many more. */
function names(logins: string[]): string {
   if (logins.length <= 2) return logins.join(' and ');
   return `${logins.slice(0, 2).join(', ')} and ${logins.length - 2} more`;
}

/**
 * The tiles: whether anything needs a look now, each opening what it
 * counts. Amber is kept for what someone owes: the calls Decide asks, and
 * the people on too many projects; the counts of stalls and slips are
 * slices of those calls, so they stay ink, and on a phone only the owed
 * tiles show.
 */
function Tiles({
   items,
   today,
   overloaded,
   line,
   decisions,
   navigate,
}: {
   items: PortfolioItem[];
   today: Today;
   /** undefined while the last 14 days load, null when they failed */
   overloaded: WhoRow[] | null | undefined;
   line: number;
   decisions: DecideRow[] | null;
   navigate: Navigate;
}) {
   const progress = items.filter(i => i.stage === 'progress');
   const ages = progress.map(i => i.ageDays).filter((d): d is number => d != null);
   const middleAge = ages.length ? Math.round(median(ages)) : null;
   const stalled = progress
      .filter(i => i.stalled)
      .sort((a, b) => (b.lastActivity?.days ?? 0) - (a.lastActivity?.days ?? 0));
   const behind = items.filter(i => i.behind);
   const ending = items.filter(i => i.endsSoon);
   const filedOpen = today.live.reduce((sum, g) => sum + g.open.length, 0);
   const allOpen = filedOpen + today.misc.length + today.unsorted.length;
   const behindWords = (['off_track', 'past_end', 'missed'] as const)
      .map(kind => [kind, behind.filter(i => i.behind === kind).length] as const)
      .filter(([, count]) => count > 0)
      .map(
         ([kind, count]) =>
            `${count} ${
               kind === 'off_track'
                  ? 'off track'
                  : kind === 'past_end'
                  ? 'past the plan’s end'
                  : 'past the target'
            }`
      )
      .join(', ');
   const newWork = decisions?.filter(d => d.reasons.some(r => r.kind === 'new')).length;
   const owedCalls = !!decisions?.length;
   const overloadedNow = !!overloaded?.length;
   // a tile opens exactly what it counts: no find or earlier pick on top
   const toList = (patch: Partial<ProjectsNav>) => {
      navigate({ find: '', only: null, ...patch });
      scrollTo('all-projects');
   };
   // quiet tiles give way on a phone, where the list is what matters
   const onPhone = (owed: boolean, tile: ReactNode) =>
      owed ? tile : <div className="hidden md:contents">{tile}</div>;
   return (
      <div className={owedCalls || overloadedNow ? '' : 'hidden md:block'}>
         <StatsCard>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
               {onPhone(
                  overloadedNow,
                  <Tile
                     value={
                        overloaded === undefined
                           ? '…'
                           : overloaded === null
                           ? '?'
                           : overloaded.length
                     }
                     label="Overloaded"
                     note={
                        overloaded === undefined
                           ? null
                           : overloaded === null
                           ? 'couldn’t load'
                           : overloaded.length
                           ? names(overloaded.map(r => r.login))
                           : `nobody on ${line} or more projects`
                     }
                     warn={overloadedNow}
                     title={`Developers who wrote or reviewed PRs on ${line} or more different projects in the last 14 days. Click to open People.`}
                     // the same 14 days the tile counts, narrowed to who it names
                     onClick={() =>
                        navigate({ ...switchView('people'), only: 'overloaded', range: '14d' })
                     }
                  />
               )}
               {onPhone(
                  false,
                  <Tile
                     value={progress.length}
                     label="Projects in progress"
                     note={`holding ${filedOpen} of the ${allOpen} open PRs`}
                     title="Projects with an open PR or a merge in the last 14 days, and not parked, done or dropped on the roadmap. Click to list them."
                     onClick={() => toList({ status: 'live' })}
                  />
               )}
               {onPhone(
                  false,
                  <Tile
                     value={middleAge == null ? 'none' : days(middleAge)}
                     label="Median time open"
                     note={`${ages.filter(d => d >= 90).length} open 90 days or more`}
                     title="How long the projects in progress have been open, from each one’s oldest open PR: half are newer than this, half older. Click to list them oldest first."
                     onClick={() => toList({ status: 'live', sort: 'age' })}
                  />
               )}
               {onPhone(
                  false,
                  <Tile
                     value={stalled.length}
                     label="Stalled"
                     note={
                        stalled.length
                           ? `longest ${stalled[0].name}, ${days(
                                stalled[0].lastActivity?.days ?? 0
                             )}`
                           : `none untouched for ${STALL_DAYS} days`
                     }
                     title={`Projects in progress with open PRs and no activity on any of them for ${STALL_DAYS} days or more: no push, comment, review, stamp or merge. Click to list ${
                        stalled.length ? 'them' : 'the projects in progress, longest quiet first'
                     }.`}
                     onClick={() =>
                        toList(
                           stalled.length
                              ? { status: 'live', only: 'stalled' }
                              : { status: 'live', sort: 'last' }
                        )
                     }
                  />
               )}
               {onPhone(
                  false,
                  <Tile
                     value={behind.length}
                     label="Behind plan"
                     note={
                        behind.length
                           ? behindWords
                           : `${n(ending.length, 'plan')} end in the next ${ENDS_SOON_DAYS} days`
                     }
                     title={`Projects past their plan’s end or their target date with PRs still open, or whose latest update says off track with no new plan since. Click to list ${
                        behind.length
                           ? 'them'
                           : ending.length
                           ? `the plans ending in the next ${ENDS_SOON_DAYS} days`
                           : 'every project, the soonest target first'
                     }.`}
                     onClick={() =>
                        toList(
                           behind.length
                              ? { status: 'all', only: 'behind' }
                              : ending.length
                              ? { status: 'all', only: 'ending' }
                              : { status: 'all', sort: 'target' }
                        )
                     }
                  />
               )}
               {onPhone(
                  owedCalls,
                  <Tile
                     value={decisions ? decisions.length : '…'}
                     label="To decide"
                     note={
                        !decisions
                           ? null
                           : decisions.length
                           ? `${newWork} new, with no plan yet`
                           : 'none owed'
                     }
                     warn={owedCalls}
                     title="The calls owed: new work with no plan, plans past their end, stalled work, updates that say at risk or off track, and finished work still taking PRs. Click to decide them."
                     onClick={() => navigate(switchView('decide'))}
                  />
               )}
            </div>
         </StatsCard>
      </div>
   );
}

/** The projects in progress, counted into one chart's bars. */
function bucketsOf(items: PortfolioItem[], chart: 'age' | 'idle', defs: BucketDef[]): Bucket[] {
   // no amber bar: the stalled ones are calls the To decide tile counts
   const buckets: Bucket[] = defs.map(d => ({ tick: d.tick, items: [] }));
   for (const item of items) {
      const span = bucketDays(item, chart);
      if (span != null) buckets[bucketOf(span, defs)].items.push({ name: item.name, days: span });
   }
   return buckets;
}

/**
 * How long the projects in progress have been open, and when anyone last
 * worked on them: one bar per bucket, and a click lists only that bar's
 * projects in the table above. Parked projects are left out, and the line
 * under each chart says so.
 */
function AgeCharts({
   items,
   nav,
   navigate,
}: {
   items: PortfolioItem[];
   nav: ProjectsNav;
   navigate: Navigate;
}) {
   const progress = items.filter(i => i.stage === 'progress');
   const parked = items.filter(i => i.stage === 'parked');
   const pickedOf = (chart: 'age' | 'idle') => {
      const bar = /^(age|idle)-(\d)$/.exec(nav.only ?? '');
      return bar && bar[1] === chart ? Number(bar[2]) : null;
   };
   // the list sits above the charts, so a bar's pick brings it into view
   const pick = (chart: 'age' | 'idle', i: number) => {
      navigate({
         status: 'live',
         find: '',
         only: pickedOf(chart) === i ? null : `${chart}-${i}`,
      });
      scrollTo('all-projects');
   };
   const span = (list: number[]) => {
      if (!list.length) return '';
      const lo = Math.min(...list);
      const hi = Math.max(...list);
      return lo === hi ? days(lo) : `${lo} to ${hi} days`;
   };
   const notCounted = (chart: 'age' | 'idle') => {
      const parkedDays = parked
         .map(i => bucketDays(i, chart))
         .filter((d): d is number => d != null);
      const parts: string[] = [];
      if (parked.length) {
         const range = span(parkedDays);
         parts.push(
            `${n(parked.length, 'parked project')}${
               range ? (chart === 'age' ? `, open ${range}` : `, last worked on ${range} ago`) : ''
            }`
         );
      }
      const none = progress.filter(i => bucketDays(i, chart) == null).length;
      if (none) parts.push(`${none} with only merges and nothing open`);
      if (!parts.length) return null;
      const text = `Not counted: ${parts.join('; ')}.`;
      return parked.length ? (
         <button
            type="button"
            onClick={() => {
               navigate({ status: 'parked', find: '', only: null });
               scrollTo('all-projects');
            }}
            className="hit pressable mt-2 rounded border-0 bg-transparent p-0 text-left text-xs text-ink-3 hover:text-brand hover:underline"
            title="List the parked projects"
         >
            {text}
         </button>
      ) : (
         <p className="m-0 mt-2 text-xs text-ink-3">{text}</p>
      );
   };
   const card = (
      chart: 'age' | 'idle',
      title: string,
      sub: string,
      defs: BucketDef[],
      ariaLabel: string
   ) => (
      <StatsCard title={title} sub={sub}>
         {progress.length ? (
            <div className="mt-3">
               <ChartSlot height={170}>
                  <BucketChart
                     buckets={bucketsOf(progress, chart, defs)}
                     unit="Projects in progress"
                     ariaLabel={ariaLabel}
                     picked={pickedOf(chart)}
                     onPick={i => pick(chart, i)}
                  />
               </ChartSlot>
               {notCounted(chart)}
            </div>
         ) : (
            <p className="m-0 mt-3 text-[13px] text-ink-3">Nothing in progress.</p>
         )}
      </StatsCard>
   );
   return (
      <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr))]">
         {card(
            'age',
            'How long they’ve been open',
            'from each project’s oldest open PR',
            AGE_BUCKETS,
            'Projects in progress, by how long they have been open'
         )}
         {card(
            'idle',
            'When they were last worked on',
            `${STALL_DAYS} days or more is stalled`,
            IDLE_BUCKETS,
            'Projects in progress, by how long since anyone worked on them'
         )}
      </div>
   );
}

/**
 * The Overview: where the projects stand now. The tiles say whether
 * anything needs a look; then every project on one list, what's owed
 * first; then how long the projects in progress have been open and when
 * they last moved; and the PRs outside any project close it out, since
 * sorting them is someone's job too. Who is on what lives on People, where
 * the Overloaded tile goes. Every number is as of now; Look back covers a
 * range.
 */
export function Overview({
   today,
   data,
   prefix,
   items,
   teamOf,
   nameOf,
   nav,
   navigate,
   opts,
   decisions,
   me,
   onPerson,
}: {
   today: Today;
   data: ProjectsData | null | undefined;
   prefix: string;
   items: PortfolioItem[];
   teamOf: (login: string) => string | null;
   nameOf: (slug: string) => string;
   nav: ProjectsNav;
   navigate: Navigate;
   opts: RowOptions;
   decisions: DecideRow[] | null;
   me: string;
   onPerson: (login: string) => void;
}) {
   const { rows, who, line } = useWhoIsOnWhat(data?.teams, today, teamOf);
   // who worked on each lately, and the calls Decide asks of each, which
   // give every row's Plan cell its words and its one amber mark
   const listed = useMemo(
      () => withCalls(rows ? withWorkers(items, peopleByProject(rows)) : items, decisions),
      [items, rows, decisions]
   );
   const overloaded = useMemo(
      () =>
         who &&
         who
            .filter(r => r.projects.length >= line)
            .sort((a, b) => b.projects.length - a.projects.length),
      [who, line]
   );
   // two-label PRs already sit in a project, so they aren't "outside" ones
   const outside = today.misc.length + today.unsorted.length;
   const allOpen = today.live.reduce((sum, g) => sum + g.open.length, 0) + outside;
   return (
      <div className="flex flex-col gap-6">
         {data === null && (
            <LoadFailed
               what="the project issues, so projects show by their label"
               onRetry={refreshProjectsData}
            />
         )}
         <Tiles
            items={listed}
            today={today}
            overloaded={overloaded}
            line={line}
            decisions={decisions}
            navigate={navigate}
         />
         <Portfolio
            items={listed}
            prefix={prefix}
            workersLoaded={rows != null}
            nameOf={nameOf}
            nav={nav}
            navigate={navigate}
            opts={opts}
            onPerson={onPerson}
            me={me}
         />
         <AgeCharts items={listed} nav={nav} navigate={navigate} />
         {outside + today.doubleLabeled.length > 0 && (
            <RestGroup
               title="PRs outside projects"
               sub={`${n(outside, 'open PR')}, ${
                  allOpen ? Math.round((100 * outside) / allOpen) : 0
               }% of all open PRs`}
            >
               <Fold
                  count={today.misc.length}
                  label="One-offs"
                  gloss={`PRs labeled ${prefix}misc: small work with no project around it.`}
                  id="projects:misc"
               >
                  <FoldRows
                     list={today.misc}
                     opts={opts}
                     id="projects:misc"
                     cap={laneShown(40, opts)}
                  />
               </Fold>
               <Fold
                  count={today.unsorted.length}
                  label={NOT_IN_A_PROJECT}
                  gloss={`PRs with no ${prefix} label. Label one to count it toward a project.`}
                  id="projects:unsorted"
               >
                  <FoldRows
                     list={today.unsorted}
                     opts={opts}
                     id="projects:unsorted"
                     cap={laneShown(40, opts)}
                  />
               </Fold>
               <Fold
                  count={today.doubleLabeled.length}
                  label="Two project labels"
                  gloss="A PR belongs to one project. These count under their first label until someone removes the other."
                  id="projects:double"
               >
                  <FoldRows
                     list={today.doubleLabeled}
                     opts={opts}
                     id="projects:double"
                     cap={laneShown(40, opts)}
                  />
               </Fold>
            </RestGroup>
         )}
      </div>
   );
}
