import type { DerivedPull, Status } from '../../../../shared/model/status';
import { n } from '../../../../shared/format';
import type { DecideRow } from '../../../../shared/model/decide';
import { Fold, FoldRows, RestGroup } from '../../components/Lane';
import type { RowOptions } from '../../components/Row';
import {
   chartWindow,
   rangeDays,
   rangeWords,
   useProjectsData,
   type ProjectsData,
   type Range,
} from '../../model/projectData';
import { MISC_SLUG, type Today } from '../../../../shared/model/projects';
import type { PortfolioItem } from '../../model/portfolio';
import { groupRows, retroRows } from '../../model/retro';
import { useRetroData } from '../../model/retroData';
import { StatsCard } from '../stats/parts';
import { ChartSlot, FlowWeeksChart, OpenPrsChart } from './lazyCharts';
import { Tile, versus, versusDays, type Navigate, type ProjectsNav } from './parts';
import { Portfolio } from './Portfolio';
import { PlansStanding } from './roadmapHealth';

const WAITING: Status[] = ['needs_cr', 'needs_recr', 'needs_qa'];

/** The headline numbers: the calls owed, what's live, what's waiting, and
 * how the range compares with the same number of days before. */
function Headline({
   today,
   data,
   prev,
   range,
   items,
   teamOf,
   navigate,
   onReview,
   decisions,
}: {
   today: Today;
   data: ProjectsData;
   prev: ProjectsData | null | undefined;
   range: Range;
   items: PortfolioItem[];
   teamOf: (login: string) => string | null;
   navigate: Navigate;
   /** to the review board, where the PRs waiting on review are */
   onReview: () => void;
   /** the Decide queue; null until the roadmap loads */
   decisions: DecideRow[] | null;
}) {
   const t = data.window.totals;
   const before = prev?.window.totals;
   const period = `${rangeDays(range)} days before`;
   const openNow: DerivedPull[] = [
      ...today.live.flatMap(g => g.open),
      ...today.misc,
      ...today.unsorted,
   ];
   const waiting = openNow.filter(p => WAITING.includes(p.status));
   const waitingOnOthers = waiting.filter(p => teamOf(p.data.user.login) == null).length;
   const started = items.filter(
      i => i.window?.first_opened && i.window.first_opened >= range.start
   );
   const finished = items.filter(
      i =>
         i.status === 'done' &&
         i.project?.closed_at &&
         i.project.closed_at.slice(0, 10) >= range.start &&
         i.project.closed_at.slice(0, 10) <= range.end
   );
   const neverDecided = decisions?.filter(d => d.reasons.some(r => r.kind === 'new')).length;
   return (
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
         <Tile
            value={decisions ? decisions.length : '…'}
            label="To decide"
            title="Projects and plans that need a call: new work with no decision, plans past their end, stalls, and updates saying at risk or off track. Click to decide."
            note={neverDecided != null ? `${neverDecided} never decided` : undefined}
            onClick={() => navigate({ view: 'decide', item: null })}
         />
         <Tile
            value={today.live.length}
            label="Live projects"
            title="Projects with an open PR, or a merge in the last 14 days. Click for the list."
            note={`${started.length} started, ${finished.length} finished in the range`}
            onClick={() => {
               navigate({ status: 'live' });
               document.getElementById('all-projects')?.scrollIntoView({ block: 'start' });
            }}
         />
         <Tile
            value={waiting.length}
            label="Waiting on review now"
            title="Open PRs that need a CR or QA before they can move. Click for the review board."
            note={`${waitingOnOthers} by non-developers`}
            onClick={onReview}
         />
         <Tile
            value={t.merged}
            label="Merged"
            title="PRs merged in the range"
            note={versus(t.merged, before?.merged, period)}
         />
         <Tile
            value={t.median_days_to_merge ?? 'none'}
            label="Median days to merge"
            title="Median days from opened to merged, over the PRs merged in the range"
            note={versusDays(t.median_days_to_merge, before?.median_days_to_merge, period)}
         />
         <Tile
            value={`${t.developers} · ${t.non_developers}`}
            label="Developers · others"
            onClick={() => navigate({ view: 'people', item: null })}
            title="People with a PR in the range: on a developer team, and everyone else. Click for the People view."
            note={
               before ? `${before.developers} · ${before.non_developers} the ${period}` : undefined
            }
         />
      </div>
   );
}

/**
 * Is the backlog growing: the PRs open each day, and under it what arrived
 * and what merged each week, over at least 90 days ending on the range's
 * last day, the days before the range veiled.
 */
function BacklogCard({ range }: { range: Range }) {
   const shown = chartWindow(range);
   const data = useProjectsData(shown);
   return (
      <StatsCard title="Is the backlog growing?" sub={rangeWords(shown)}>
         {data === null ? (
            <p className="mt-3 text-[13px] text-ink-3">Couldn’t load the charts.</p>
         ) : (
            <div className="mt-3 flex flex-col gap-4">
               <ChartSlot height={200}>
                  {data && <OpenPrsChart days={data.window.days} picked={range} />}
               </ChartSlot>
               <ChartSlot height={210}>
                  {data && <FlowWeeksChart weeks={data.window.weeks} picked={range} />}
               </ChartSlot>
            </div>
         )}
      </StatsCard>
   );
}

/**
 * Where the time went, the top of Look back: the projects that took the
 * most developer-days in the range, most first, each bar labeled with its
 * days and share so it needs no axis. A project opens its page; the rest
 * is one click away in Look back.
 */
function TimeCard({
   range,
   nameOf,
   navigate,
}: {
   range: Range;
   nameOf: (slug: string) => string;
   navigate: Navigate;
}) {
   const data = useRetroData(range);
   const groups = data ? groupRows(retroRows(data), r => r.pr.project ?? '', data) : null;
   const total = groups?.reduce((sum, g) => sum + g.days, 0) ?? 0;
   const shown = groups?.slice(0, 7) ?? [];
   const rest = groups?.slice(7) ?? [];
   const most = shown[0]?.days ?? 1;
   const days = (d: number) => `${d < 10 ? Math.round(d * 10) / 10 : Math.round(d)} days`;
   const pct = (d: number) => `${total ? Math.round((100 * d) / total) : 0}%`;
   return (
      <StatsCard>
         <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="m-0 text-sm font-semibold text-ink">Where the time went</h3>
            <span className="text-xs text-ink-3">{rangeWords(range)}</span>
            <span className="flex-1" />
            <button
               type="button"
               onClick={() => navigate({ view: 'retro' })}
               className="pressable rounded border-0 bg-transparent p-0 text-xs text-ink-3 hover:text-brand hover:underline"
            >
               Look back at all of it
            </button>
         </div>
         {data === null ? (
            <p className="m-0 mt-3 text-[13px] text-ink-3">Couldn’t load the days.</p>
         ) : !groups ? (
            <p className="m-0 mt-3 text-[13px] text-ink-3">Adding up the days…</p>
         ) : !groups.length ? (
            <p className="m-0 mt-3 text-[13px] text-ink-3">No one touched a PR in these days.</p>
         ) : (
            <>
               <p className="m-0 mt-1 text-xs text-ink-3">
                  {days(total)} of developers’ time, by project. A day counts once per person, split
                  across the PRs they touched that day.
               </p>
               <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
                  {shown.map(g => {
                     const name = g.key ? nameOf(g.key) : 'Not filed to a project';
                     const opens = g.key && g.key !== MISC_SLUG;
                     return (
                        <li key={g.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3">
                           {opens ? (
                              <button
                                 type="button"
                                 onClick={() => navigate({ project: g.key })}
                                 className="pressable min-w-0 truncate rounded border-0 bg-transparent p-0 text-left text-[13px] text-ink hover:text-brand hover:underline"
                              >
                                 {name}
                              </button>
                           ) : (
                              <span className="min-w-0 truncate text-[13px] text-ink">{name}</span>
                           )}
                           <span className="text-xs text-ink-2 tabular-nums">
                              {days(g.days)} · {pct(g.days)}
                           </span>
                           <span className="col-span-2 mt-0.5 h-1.5 rounded-full bg-muted">
                              <span
                                 className={`block h-full rounded-full ${
                                    g.key ? 'bg-brand' : 'bg-ink-3/50'
                                 }`}
                                 style={{ width: `${Math.max((g.days / most) * 100, 1)}%` }}
                              />
                           </span>
                        </li>
                     );
                  })}
               </ul>
               {rest.length > 0 && (
                  <p className="m-0 mt-2 text-xs text-ink-3">
                     and {n(rest.length, 'more project')}:{' '}
                     {days(rest.reduce((sum, g) => sum + g.days, 0))}
                  </p>
               )}
            </>
         )}
      </StatsCard>
   );
}

/**
 * The planner's overview: the headline numbers, where the backlog and the
 * merged work are going, and every project on one list. PRs outside any
 * project close it out, since sorting them is someone's job too.
 */
export function Overview({
   today,
   data,
   prev,
   range,
   prefix,
   items,
   teamOf,
   nameOf,
   nav,
   navigate,
   opts,
   onReview,
   decisions,
}: {
   today: Today;
   data: ProjectsData | null | undefined;
   prev: ProjectsData | null | undefined;
   range: Range;
   prefix: string;
   items: PortfolioItem[];
   teamOf: (login: string) => string | null;
   nameOf: (slug: string) => string;
   nav: ProjectsNav;
   navigate: Navigate;
   opts: RowOptions;
   onReview: () => void;
   decisions: DecideRow[] | null;
}) {
   // two-label PRs already sit in a project, so they aren't "outside" ones
   const outside = today.misc.length + today.unsorted.length;
   return (
      <div className="flex flex-col gap-5">
         {data === null && (
            <p className="m-0 text-xs text-ink-3">
               Couldn’t load the project issues or the range’s numbers. Projects show by label until
               they load.
            </p>
         )}
         {data && (
            <StatsCard>
               <Headline
                  today={today}
                  data={data}
                  prev={prev}
                  range={range}
                  items={items}
                  teamOf={teamOf}
                  navigate={navigate}
                  onReview={onReview}
                  decisions={decisions}
               />
            </StatsCard>
         )}
         <PlansStanding nav={nav} navigate={navigate} />
         <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(380px,1fr))]">
            <BacklogCard range={range} />
            <TimeCard range={range} nameOf={nameOf} navigate={navigate} />
         </div>
         <Portfolio
            items={items}
            teamOf={teamOf}
            nameOf={nameOf}
            nav={nav}
            navigate={navigate}
            opts={opts}
         />
         {outside + today.doubleLabeled.length > 0 && (
            <RestGroup title="PRs outside projects" sub={n(outside, 'open PR')}>
               <Fold
                  count={today.misc.length}
                  label="One-offs"
                  gloss={`PRs labeled ${prefix}misc: work with no project around it.`}
                  id="projects:misc"
               >
                  <FoldRows list={today.misc} opts={opts} id="projects:misc" />
               </Fold>
               <Fold
                  count={today.unsorted.length}
                  label="Not in a project yet"
                  gloss={`PRs with no ${prefix} label.`}
                  id="projects:unsorted"
               >
                  <FoldRows list={today.unsorted} opts={opts} id="projects:unsorted" />
               </Fold>
               <Fold
                  count={today.doubleLabeled.length}
                  label="Two project labels"
                  gloss="A PR belongs to one project. These show under their first label until someone removes the other."
                  id="projects:double"
               >
                  <FoldRows list={today.doubleLabeled} opts={opts} id="projects:double" />
               </Fold>
            </RestGroup>
         )}
      </div>
   );
}
