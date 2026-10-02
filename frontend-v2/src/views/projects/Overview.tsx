import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { n } from '../../../../shared/format';
import { STALL_DAYS, type DecideRow } from '../../../../shared/model/decide';
import type { Today } from '../../../../shared/model/projects';
import { FactLink, LoadFailed } from '../../components/bits';
import { Fold, FoldRows, laneShown, RestGroup, SubDoor } from '../../components/Lane';
import type { RowOptions } from '../../components/Row';
import { DEFAULT_SORT } from '../../lens';
import {
   AGE_BUCKETS,
   agoWords,
   behindWords,
   beingWorkedOn,
   bucketDays,
   bucketOf,
   ENDS_SOON_DAYS,
   IDLE_BUCKETS,
   lowerFirst,
   sortItems,
   upperFirst,
   withCalls,
   withWorkers,
   type BucketDef,
   type PortfolioItem,
} from '../../model/portfolio';
import { dayOf, refreshProjectsData, type ProjectsData } from '../../model/projectData';
import { median, OVERLOAD_MIN, peopleByProject } from '../../model/retro';
import { retryRetroData } from '../../model/retroData';
import {
   andList,
   BEING_WORKED_ON,
   days,
   LAST_14_DAYS,
   noPrActivity,
   NOT_IN_A_PROJECT,
   ONE_OFFS,
   OVERLOADED,
} from '../../model/words';
import { StatsCard } from '../stats/parts';
import type { Bucket } from './charts';
import { useCallsMadeHere } from './Decide';
import { BucketChart, ChartSlot } from './lazyCharts';
import { switchView, Tile, type Navigate, type ProjectsNav } from './parts';
import { AS_OPENED, Portfolio } from './Portfolio';
import { useWhoIsOnWhat, type WhoRow } from './WhoIsOnWhat';

const NO_ROWS: DecideRow[] = [];

/** Scroll a section of the page into view, under the sticky header. */
const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: 'start' });

/** Up to three names in a sentence, or the first two and how many more. */
const names = (logins: string[]) =>
   andList(logins.length <= 3 ? logins : [...logins.slice(0, 2), `${logins.length - 2} more`]);

/**
 * The tiles: whether anything needs a look now, each opening what it
 * counts. The owed come first: the calls Decide asks, and the people on
 * too many projects, which wear the amber; the counts of stalls and slips
 * are slices of those calls, so they stay ink, and on a phone only the owed
 * tiles show. A tile that narrows the list is a toggle, picked while the
 * list shows its chip.
 */
function Tiles({
   items,
   today,
   overloaded,
   line,
   decisions,
   nav,
   navigate,
}: {
   items: PortfolioItem[];
   today: Today;
   /** undefined while the last 14 days load, null when they failed */
   overloaded: WhoRow[] | null | undefined;
   line: number;
   decisions: DecideRow[] | null;
   nav: ProjectsNav;
   navigate: Navigate;
}) {
   const working = items.filter(beingWorkedOn);
   const ages = working.map(i => i.ageDays).filter((d): d is number => d != null);
   const middleAge = ages.length ? Math.round(median(ages)) : null;
   const stalled = working
      .filter(i => i.stalled)
      .sort((a, b) => (b.lastActivity?.days ?? 0) - (a.lastActivity?.days ?? 0));
   // the list's own order, so the one named is the one it puts first
   const behind = sortItems(
      items.filter(i => i.behind),
      DEFAULT_SORT
   );
   const ending = items.filter(i => i.endsSoon);
   // the open PRs of the projects the tile counts, so its rows' Open column
   // adds up to the same number
   const held = working.reduce((sum, i) => sum + i.open, 0);
   const allOpen =
      today.live.reduce((sum, g) => sum + g.open.length, 0) +
      today.misc.length +
      today.unsorted.length;
   const behindNote = () => {
      const [first] = behind;
      const words = behindWords(first, dayOf(new Date()));
      const more = behind.length > 1 ? `, and ${behind.length - 1} more` : '';
      return `${first.name}${words ? `, ${lowerFirst(words)}` : ''}${more}`;
   };
   const newWork = decisions?.filter(d => d.reasons.some(r => r.kind === 'new')).length;
   const owedCalls = !!decisions?.length;
   const overloadedNow = !!overloaded?.length;
   // a tile opens exactly what it counts: no find or earlier pick on top
   const toList = (patch: Partial<ProjectsNav>) => {
      navigate({ find: '', only: null, ...patch });
      scrollTo('all-projects');
   };
   // a second click on a picked tile lets the list go, as the chip's × does
   const toggle = (only: string, status: string) =>
      nav.only === only ? navigate(AS_OPENED) : toList({ status, only });
   // quiet tiles give way on a phone, where the list is what matters
   const onPhone = (owed: boolean, tile: ReactNode) =>
      owed ? tile : <div className="hidden md:contents">{tile}</div>;
   return (
      <div className={owedCalls || overloadedNow ? '' : 'hidden md:block'}>
         <StatsCard>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
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
                     title="The calls owed: new work with no plan, plans past their end, stalled work, updates that say at risk or off track, and finished or parked work whose PRs still move. Click to decide them."
                     onClick={() => navigate(switchView('decide'))}
                  />
               )}
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
                     label={upperFirst(OVERLOADED)}
                     note={
                        !overloaded
                           ? null
                           : overloaded.length
                           ? names(overloaded.map(r => r.login))
                           : `nobody on ${line} or more projects in the ${LAST_14_DAYS}`
                     }
                     warn={overloadedNow}
                     title={`Developers who wrote or reviewed PRs on ${line} or more different projects in the ${LAST_14_DAYS}. Click to open People.`}
                     // the same 14 days the tile counts, narrowed to who it names
                     onClick={() =>
                        navigate({ ...switchView('people'), only: 'overloaded', range: '14d' })
                     }
                  />
               )}
               {onPhone(
                  false,
                  <Tile
                     value={working.length}
                     label={upperFirst(BEING_WORKED_ON)}
                     note={`in the ${LAST_14_DAYS}, with ${held} of the ${allOpen} open PRs`}
                     title={`Projects with an open PR or a merge in the ${LAST_14_DAYS} that aren’t parked, done or dropped on the roadmap, unless Decide asks about them because their PRs still move. Click to list them.`}
                     onClick={() => toList({ status: 'live' })}
                  />
               )}
               {onPhone(
                  false,
                  <Tile
                     value={middleAge == null ? 'none' : days(middleAge)}
                     label="Median time open"
                     note={`${ages.filter(d => d >= 90).length} open 90 days or more`}
                     title={`How long the projects ${BEING_WORKED_ON} have been open, from each one’s oldest open PR: half are newer than this, half older. Click to list them oldest first.`}
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
                           ? `longest ${stalled[0].name}, ${lowerFirst(
                                noPrActivity(stalled[0].lastActivity?.days ?? 0)
                             )}`
                           : `none with ${lowerFirst(noPrActivity(STALL_DAYS))}`
                     }
                     title={`Projects with open PRs and no activity on any of them for ${STALL_DAYS} days or more (no push, comment, review, stamp or merge) that aren’t parked, done or dropped. Click to list ${
                        stalled.length
                           ? 'them'
                           : `the projects ${BEING_WORKED_ON}, longest quiet first`
                     }.`}
                     picked={stalled.length ? nav.only === 'stalled' : undefined}
                     onClick={() =>
                        stalled.length
                           ? toggle('stalled', 'live')
                           : toList({ status: 'live', sort: 'last' })
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
                           ? behindNote()
                           : `${n(ending.length, 'plan')} end in the next ${ENDS_SOON_DAYS} days`
                     }
                     title={`Projects past their plan’s end or their target date with PRs still open, or whose latest update says off track with no new plan since. Click to list ${
                        behind.length
                           ? 'them'
                           : ending.length
                           ? `the plans ending in the next ${ENDS_SOON_DAYS} days`
                           : 'every project, the soonest target first'
                     }.`}
                     picked={
                        behind.length
                           ? nav.only === 'behind'
                           : ending.length
                           ? nav.only === 'ending'
                           : undefined
                     }
                     onClick={() =>
                        behind.length
                           ? toggle('behind', 'all')
                           : ending.length
                           ? toggle('ending', 'all')
                           : toList({ status: 'all', sort: 'target' })
                     }
                  />
               )}
            </div>
            {/* what each tile counts, said once behind a door, for touch and
                screen readers too: a title on each tile only reaches a mouse.
                A phone shows only the owed tiles, and the views they open
                explain them, so there it gives the list the line */}
            <div className="mt-3 hidden md:block">
               <SubDoor label="What the tiles count" text="What each tile counts">
                  <p className="m-0">
                     To decide: the calls Decide asks for, such as a first plan, a new end, or work
                     marked done or parked whose PRs still move.
                  </p>
                  <p className="m-0">
                     {upperFirst(OVERLOADED)}: developers who wrote or reviewed PRs on {line} or
                     more projects in the {LAST_14_DAYS}, twice the developers’ median and never
                     under {OVERLOAD_MIN}.
                  </p>
                  <p className="m-0">
                     {upperFirst(BEING_WORKED_ON)}: an open PR or a merge in the {LAST_14_DAYS}, and
                     not parked, done or dropped, unless Decide asks about it because its PRs still
                     move.
                  </p>
                  <p className="m-0">
                     Median time open: from each one’s oldest open PR. Stalled: open PRs, and{' '}
                     {lowerFirst(noPrActivity(STALL_DAYS))} or more.
                  </p>
                  <p className="m-0">
                     Behind plan: past its plan’s end or its target with PRs open, or off track
                     since its plan last changed.
                  </p>
                  <p className="m-0">Each tile opens what it counts.</p>
               </SubDoor>
            </div>
         </StatsCard>
      </div>
   );
}

/** The projects being worked on, counted into one chart's bars. */
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
 * How long the projects being worked on have been open, and when anyone
 * last worked on them: one bar per bucket, and a click lists only that
 * bar's projects in the table above. Parked projects nobody's working on
 * are left out, and the line under each chart says so.
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
   const working = items.filter(beingWorkedOn);
   const parked = items.filter(i => i.stage === 'parked' && !beingWorkedOn(i));
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
   const span = (list: number[], chart: 'age' | 'idle') => {
      if (!list.length) return '';
      const lo = Math.min(...list);
      const hi = Math.max(...list);
      if (chart === 'age') return `open ${lo === hi ? days(lo) : `${lo} to ${hi} days`}`;
      return `last worked on ${
         lo === hi ? agoWords(lo) : `${lo ? lo : 'today'} to ${days(hi)} ago`
      }`;
   };
   const notCounted = (chart: 'age' | 'idle') => {
      const range = span(
         parked.map(i => bucketDays(i, chart)).filter((d): d is number => d != null),
         chart
      );
      const none = working.filter(i => bucketDays(i, chart) == null).length;
      if (!parked.length && !none) return null;
      const parts: ReactNode[] = [];
      if (parked.length) {
         parts.push(
            <span key="parked">
               <FactLink
                  onClick={() => {
                     navigate({ status: 'parked', find: '', only: null });
                     scrollTo('all-projects');
                  }}
                  title="List the parked projects"
               >
                  {n(parked.length, 'parked project')}
               </FactLink>
               {range ? `, ${range}` : ''}
            </span>
         );
      }
      if (none) parts.push(`${none} with only merges and nothing open`);
      return (
         <p className="m-0 mt-2 max-w-[70ch] text-xs text-ink-3">
            Not counted: {parts.flatMap((part, i) => (i ? ['; ', part] : [part]))}.
         </p>
      );
   };
   const unit = `Projects ${BEING_WORKED_ON}, ${LAST_14_DAYS}`;
   const card = (
      chart: 'age' | 'idle',
      title: string,
      sub: string,
      defs: BucketDef[],
      ariaLabel: string
   ) => (
      <StatsCard title={title} sub={sub}>
         {working.length ? (
            <div className="mt-3">
               <ChartSlot height={170}>
                  <BucketChart
                     buckets={bucketsOf(working, chart, defs)}
                     unit={unit}
                     ariaLabel={ariaLabel}
                     picked={pickedOf(chart)}
                     onPick={i => pick(chart, i)}
                  />
               </ChartSlot>
               {notCounted(chart)}
            </div>
         ) : (
            <p className="m-0 mt-3 text-[13px] text-ink-3">Nothing {BEING_WORKED_ON}.</p>
         )}
      </StatsCard>
   );
   return (
      <section>
         {/* the cards' own headings sit under this one, not under the list's */}
         <h2 className="sr-only">{`Projects ${BEING_WORKED_ON}, by age and by quiet`}</h2>
         <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr))]">
            {card(
               'age',
               'How long projects have been open',
               'from each project’s oldest open PR',
               AGE_BUCKETS,
               `Projects ${BEING_WORKED_ON}, by how long they have been open`
            )}
            {card(
               'idle',
               'When projects were last worked on',
               `${STALL_DAYS} days or more is stalled`,
               IDLE_BUCKETS,
               `Projects ${BEING_WORKED_ON}, by how long since anyone worked on them`
            )}
         </div>
      </section>
   );
}

/**
 * The Overview: where the projects stand now. The tiles say whether
 * anything needs a look; then every project on one list, what's owed
 * first; then how long the projects being worked on have been open and
 * when they last moved; and the PRs outside any project close it out,
 * since sorting them is someone's job too. Who is on what lives on People,
 * where the Overloaded tile goes. Every number is as of now; Look back
 * covers a range.
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
   // the calls owed, and the ones made in the list's rows since it opened
   const calls = useCallsMadeHere(decisions ?? NO_ROWS);
   // a row answered in place keeps its place, its tab and its receipt, as a
   // row on Decide does: the list places it as it stood just before the
   // call, while its cells say what's true now
   const answered = new Set([...calls.settled.values()].map(m => m.row.slug));
   const stood = useRef(new Map<string, PortfolioItem>());
   useEffect(() => {
      for (const item of listed) if (!answered.has(item.slug)) stood.current.set(item.slug, item);
   });
   const placeOf = (item: PortfolioItem) =>
      (answered.has(item.slug) && stood.current.get(item.slug)) || item;
   // most projects first, then by login: the order People lists them in
   const overloaded = useMemo(
      () =>
         who &&
         who
            .filter(r => r.projects.length >= line)
            .sort(
               (a, b) => b.projects.length - a.projects.length || a.login.localeCompare(b.login)
            ),
      [who, line]
   );
   // the teams in their configured order, for the list's Group by Team
   const teams = useMemo(() => Object.keys(data?.teams ?? {}), [data]);
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
         {who === null && (
            <LoadFailed
               what={`who worked on what in the ${LAST_14_DAYS}`}
               onRetry={retryRetroData}
            />
         )}
         <Tiles
            items={listed}
            today={today}
            overloaded={overloaded}
            line={line}
            decisions={decisions}
            nav={nav}
            navigate={navigate}
         />
         <Portfolio
            items={listed}
            placeOf={placeOf}
            calls={calls.all}
            prefix={prefix}
            workers={rows ? 'loaded' : who === null ? 'failed' : 'loading'}
            nameOf={nameOf}
            teams={teams}
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
                  label={ONE_OFFS}
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
                  gloss={`PRs with no ${prefix} label that link none of a project’s issues. Label one, or link one of a project’s issues (“Parts of #N”), to count it there.`}
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
                  label="In two projects"
                  gloss="A PR counts in one project. These have two project labels, or no label and issues of two projects linked, and count under the first until someone sorts them out."
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
