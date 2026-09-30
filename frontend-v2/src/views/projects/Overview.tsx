import { useMemo } from 'react';
import type { DerivedPull, Status } from '../../../../shared/model/status';
import { n } from '../../../../shared/format';
import type { Today } from '../../../../shared/model/projects';
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
import { roadmapShare, roadmapSlugs, type PortfolioItem } from '../../model/portfolio';
import { useRoadmap } from '../../model/roadmapData';
import { Segmented } from '../../components/bits';
import { StatsCard } from '../stats/parts';
import { AllocationChart, BacklogFlowChart, ChartSlot } from './lazyCharts';
import { Tile, versus, versusDays, type Navigate, type ProjectsNav } from './parts';
import { Portfolio } from './Portfolio';
import { PlansStanding } from './roadmapHealth';

const WAITING: Status[] = ['needs_cr', 'needs_recr', 'needs_qa'];

/** The headline numbers: what's live, what's waiting, and how the range
 * compares with the same number of days before. */
function Headline({
   today,
   data,
   prev,
   range,
   items,
   teamOf,
   navigate,
   onReview,
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
   return (
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
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
            value={`${t.backlog_start} to ${t.backlog_end}`}
            label="Open PRs, start to end"
            title="PRs open when the range began, and when it ended"
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

/** The backlog chart: at least 90 days ending on the range's last day,
 * the days before the range paled. */
function BacklogCard({ range }: { range: Range }) {
   const shown = chartWindow(range);
   const data = useProjectsData(shown);
   return (
      <StatsCard title="Backlog against throughput" sub={rangeWords(shown)}>
         {data === null ? (
            <p className="mt-3 text-[13px] text-ink-3">Couldn’t load the chart.</p>
         ) : (
            <div className="mt-3">
               <ChartSlot height={220}>
                  {data && <BacklogFlowChart days={data.window.days} picked={range} height={220} />}
               </ChartSlot>
            </div>
         )}
         <p className="mt-1 text-xs text-ink-3">
            Green is what merged or closed since the first day; blue on top is what was still open,
            so the blue band’s height is the backlog that day.
         </p>
      </StatsCard>
   );
}

const pct = ({ planned, total }: { planned: number; total: number }) =>
   total ? Math.round((planned / total) * 100) : null;

/**
 * Where the merged work went, week by week: by project, or split by whether
 * the roadmap planned it (the share of work on the roadmap against the
 * unplanned rest: other projects, one-offs, and PRs in no project). Both
 * periods are measured against today's roadmap.
 */
function MergedWorkCard({
   data,
   prev,
   range,
   nameOf,
   nav,
   navigate,
}: {
   data: ProjectsData | null | undefined;
   prev: ProjectsData | null | undefined;
   range: Range;
   nameOf: (slug: string) => string;
   nav: ProjectsNav;
   navigate: Navigate;
}) {
   const { items: plan } = useRoadmap();
   // null until the roadmap loads: a share against no roadmap would read 0%
   const planned = useMemo(() => (plan ? roadmapSlugs(plan) : null), [plan]);
   const byPlan = nav.split === 'roadmap';
   const share = data && planned ? roadmapShare(data.window.weeks, planned) : null;
   const before = prev && planned ? roadmapShare(prev.window.weeks, planned) : null;
   return (
      <StatsCard>
         <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="m-0 text-sm font-semibold text-ink">Where the merged work went</h3>
            <span className="text-xs text-ink-3">{rangeWords(range)}</span>
            <span className="flex-1" />
            <Segmented
               ariaLabel="split the merged work"
               value={byPlan ? 'roadmap' : 'project'}
               options={[
                  ['project', 'By project'],
                  ['roadmap', 'Roadmap or not'],
               ]}
               onChange={split => navigate({ split })}
            />
         </div>
         <div className="mt-3">
            <ChartSlot height={250}>
               {data && (!byPlan || planned) && (
                  <AllocationChart
                     weeks={data.window.weeks}
                     nameOf={nameOf}
                     onPick={slug => navigate({ project: slug })}
                     planned={byPlan ? planned ?? undefined : undefined}
                  />
               )}
            </ChartSlot>
         </div>
         {byPlan && share && (
            <p className="m-0 mt-2 text-xs text-ink-3">
               {share.total
                  ? `${share.planned} of ${n(share.total, 'merged PR')} (${pct(
                       share
                    )}%) were in projects on the roadmap`
                  : 'Nothing merged in the range'}
               {before && pct(before) != null
                  ? `, against ${pct(before)}% the ${rangeDays(range)} days before`
                  : ''}
               .
            </p>
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
               />
            </StatsCard>
         )}
         <PlansStanding nav={nav} navigate={navigate} />
         <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(380px,1fr))]">
            <BacklogCard range={range} />
            <MergedWorkCard
               data={data}
               prev={prev}
               range={range}
               nameOf={nameOf}
               nav={nav}
               navigate={navigate}
            />
         </div>
         <Portfolio
            items={items}
            teamOf={teamOf}
            nameOf={nameOf}
            hasRepo={!!data?.projects_repo}
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
