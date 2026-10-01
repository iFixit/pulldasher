import { useMemo } from 'react';
import { n } from '../../../../shared/format';
import { STALL_DAYS, type DecideRow } from '../../../../shared/model/decide';
import type { Today } from '../../../../shared/model/projects';
import { Fold, FoldRows, laneShown, RestGroup } from '../../components/Lane';
import type { RowOptions } from '../../components/Row';
import {
   AGE_BUCKETS,
   bucketDays,
   bucketOf,
   ENDS_SOON_DAYS,
   IDLE_BUCKETS,
   withWorkers,
   type BucketDef,
   type PortfolioItem,
} from '../../model/portfolio';
import type { ProjectsData } from '../../model/projectData';
import { median, peopleByProject } from '../../model/retro';
import { StatsCard } from '../stats/parts';
import type { Bucket } from './charts';
import { BucketChart, ChartSlot } from './lazyCharts';
import { Tile, type Navigate, type ProjectsNav } from './parts';
import { Portfolio } from './Portfolio';
import { useWhoIsOnWhat, WhoIsOnWhat, type WhoRow } from './WhoIsOnWhat';

/** Scroll a section of the page into view, under the sticky header. */
const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: 'start' });

/**
 * The tiles: whether anything needs a look now. Each opens what it counts:
 * the people table, or the project list narrowed or sorted to match.
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
      .map(kind => [kind, behind.filter(i => i.planCell.kind === kind).length] as const)
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
   const toList = (patch: Partial<ProjectsNav>) => {
      navigate({ only: null, ...patch });
      scrollTo('all-projects');
   };
   return (
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
         <Tile
            value={overloaded === undefined ? '…' : overloaded === null ? '?' : overloaded.length}
            label="Overloaded"
            note={overloaded === null ? 'couldn’t load' : `on ${line} or more projects`}
            warn={!!overloaded?.length}
            title={`Developers who wrote or reviewed PRs on ${line} or more different projects in the last 14 days. Click to see who is on what.`}
            onClick={() => scrollTo('who-is-on-what')}
         />
         <Tile
            value={progress.length}
            label="Projects in progress"
            note={`holding ${filedOpen} of the ${allOpen} open PRs`}
            title="Projects with an open PR or a merge in the last 14 days, and not parked, done or dropped on the roadmap. Click to list them."
            onClick={() => toList({ status: 'live' })}
         />
         <Tile
            value={middleAge == null ? 'none' : n(middleAge, 'day')}
            label="Median time open"
            note={`${ages.filter(d => d >= 90).length} open 90 days or more`}
            title="How long the projects in progress have been open, from each one’s oldest open PR: half are newer than this, half older. Click to list them oldest first."
            onClick={() => toList({ status: 'live', sort: 'age' })}
         />
         <Tile
            value={stalled.length}
            label="Stalled"
            note={
               stalled.length
                  ? `longest ${stalled[0].name}, ${n(stalled[0].lastActivity?.days ?? 0, 'day')}`
                  : `none untouched for ${STALL_DAYS} days`
            }
            warn={stalled.length > 0}
            title={`Projects in progress with open PRs and no activity on any of them for ${STALL_DAYS} days or more: no push, comment, review, stamp or merge. Click to list them.`}
            onClick={() => toList({ status: 'live', only: 'stalled' })}
         />
         <Tile
            value={behind.length}
            label="Behind plan"
            note={
               behind.length
                  ? behindWords
                  : `${n(ending.length, 'plan')} end in the next ${ENDS_SOON_DAYS} days`
            }
            warn={behind.length > 0}
            title={`Projects whose latest update says off track, or that are past their plan’s end or their target date with PRs still open. Click to list ${
               behind.length ? 'them' : `the plans ending in the next ${ENDS_SOON_DAYS} days`
            }.`}
            onClick={() => toList({ status: 'all', only: behind.length ? 'behind' : 'ending' })}
         />
         <Tile
            value={decisions ? decisions.length : '…'}
            label="To decide"
            note={newWork != null ? `${newWork} new, with no plan yet` : undefined}
            title="Projects and plans waiting on a decision: new work with no plan, plans past their end, stalled work, and updates that say at risk or off track. Click to decide them."
            onClick={() => navigate({ view: 'decide', item: null })}
         />
      </div>
   );
}

/** The projects in progress, counted into one chart's bars. */
function bucketsOf(items: PortfolioItem[], chart: 'age' | 'idle', defs: BucketDef[]): Bucket[] {
   const buckets: Bucket[] = defs.map((d, i) => ({
      tick: d.tick,
      items: [],
      // the last bar of the activity chart is the stalled one
      warn: chart === 'idle' && i === defs.length - 1,
   }));
   for (const item of items) {
      const days = bucketDays(item, chart);
      if (days != null) buckets[bucketOf(days, defs)].items.push({ name: item.name, days });
   }
   return buckets;
}

/**
 * How long the projects in progress have been open, and when anyone last
 * worked on them: one bar per bucket, and a click lists only that bar's
 * projects in the table below. Parked projects are left out, and the line
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
   const pick = (chart: 'age' | 'idle', i: number) =>
      navigate({ status: 'live', only: pickedOf(chart) === i ? null : `${chart}-${i}` });
   const span = (days: number[]) => {
      if (!days.length) return '';
      const lo = Math.min(...days);
      const hi = Math.max(...days);
      return lo === hi ? n(lo, 'day') : `${lo} to ${hi} days`;
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
               navigate({ status: 'parked', only: null });
               scrollTo('all-projects');
            }}
            className="pressable mt-2 rounded border-0 bg-transparent p-0 text-left text-xs text-ink-3 hover:text-brand hover:underline"
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
      <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]">
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
 * anything needs a look; then who is on what over the last 14 days, how
 * long projects have been open and when they last moved, and every project
 * on one list. PRs outside any project close it out, since sorting them is
 * someone's job too. Every number is as of now; Look back covers a range.
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
   const { rows, who, line, middle } = useWhoIsOnWhat(data?.teams, today, teamOf);
   const listed = useMemo(
      () => (rows ? withWorkers(items, peopleByProject(rows)) : items),
      [items, rows]
   );
   const bySlug = useMemo(() => new Map(listed.map(i => [i.slug, i])), [listed]);
   // two-label PRs already sit in a project, so they aren't "outside" ones
   const outside = today.misc.length + today.unsorted.length;
   const allOpen = today.live.reduce((sum, g) => sum + g.open.length, 0) + outside;
   return (
      <div className="flex flex-col gap-6">
         {data === null && (
            <p className="m-0 text-xs text-warn">
               Couldn’t load the project issues, so projects show by their label. Reload to try
               again.
            </p>
         )}
         <StatsCard>
            <Tiles
               items={listed}
               today={today}
               overloaded={who && who.filter(r => r.projects.length >= line)}
               line={line}
               decisions={decisions}
               navigate={navigate}
            />
         </StatsCard>
         <Portfolio
            items={listed}
            prefix={prefix}
            workersLoaded={rows != null}
            nameOf={nameOf}
            nav={nav}
            navigate={navigate}
            opts={opts}
            onPerson={onPerson}
         />
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
                  label="Not in a project yet"
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
         <WhoIsOnWhat
            rows={who}
            line={line}
            middle={middle}
            items={bySlug}
            nameOf={nameOf}
            me={me}
            onPerson={onPerson}
            nav={nav}
            navigate={navigate}
         />
         <AgeCharts items={listed} nav={nav} navigate={navigate} />
      </div>
   );
}
