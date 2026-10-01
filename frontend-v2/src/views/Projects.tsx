import { useCallback, useEffect, useMemo } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { DerivedPull } from '../../../shared/model/status';
import type { PullData } from '../../../shared/types';
import { closedIssues } from '../../../shared/model/decide';
import { buildToday, MISC_SLUG, type Today } from '../../../shared/model/projects';
import { backend } from '../backend/socket';
import { EmptyState, Segmented } from '../components/bits';
import { Icon } from '../components/Icon';
import type { RowOptions } from '../components/Row';
import {
   DEFAULT_RANGE,
   ongoingSlugs,
   previousRange,
   refreshProjectsData,
   resolveRange,
   teamLookup,
   useProjectsData,
   type Range,
} from '../model/projectData';
import { useWorkData, workVersion } from '../model/workData';
import { portfolioItems } from '../model/portfolio';
import { loadRoadmap, useRoadmap } from '../model/roadmapData';

/** how long a burst of changes on the server settles before one refetch */
const CHANGE_SETTLE_MS = 2000;
import { DateRangePicker } from './projects/DateRangePicker';
import { Decide, decideRows } from './projects/Decide';
import { Overview } from './projects/Overview';
import { People } from './projects/People';
import { ProjectPage } from './projects/ProjectPage';
import { Retro } from './projects/Retro';
import { Roadmap } from './projects/Roadmap';
import type { Navigate, ProjectsNav } from './projects/parts';

export type { ProjectsNav } from './projects/parts';

const NO_TODAY: Today = { live: [], quiet: [], misc: [], unsorted: [], doubleLabeled: [] };

/** The way back from a project's page, named for where it goes. */
const BACK_WORDS: Record<ProjectsNav['view'], string> = {
   overview: 'All projects',
   decide: 'Decide',
   roadmap: 'Roadmap',
   people: 'People',
   retro: 'Look back',
};

/**
 * The Projects tab, for the person who plans the work: an overview of every
 * project (headline numbers, charts, and one sortable list), the roadmap
 * (the plan, dragged into shape, with the PRs' real activity drawn over it),
 * and the people (who is on what, and whether review keeps up). A job outside
 * Pulldasher files each PR with a project label and keeps one GitHub issue per
 * project; the roadmap is Pulldasher's own. Today is built here from the live
 * socket pulls, so it moves with the board; the project issues and the
 * history come from /projects-data.
 */
export function Projects({
   pulls,
   closed,
   allPulls,
   allClosed,
   prefix,
   nav,
   navigate,
   opts,
   me,
}: {
   /** people's open PRs, narrowed by the repo and people filters only */
   pulls: DerivedPull[];
   /** people's PRs closed in the last 14 days, same narrowing */
   closed: PullData[];
   /** the same two lists before the filters narrow them, for Decide */
   allPulls: DerivedPull[];
   allClosed: PullData[];
   /** the project label prefix; null when the server isn't set up for projects */
   prefix: string | null;
   nav: ProjectsNav;
   navigate: Navigate;
   opts: RowOptions;
   me: string;
}) {
   // a person clicked anywhere on this tab opens their row on People, so the
   // click stays in Projects and sets no filter that would change its counts
   const onPersonHere = useCallback(
      (login: string) => navigate({ view: 'people', project: null, who: login }, { push: true }),
      [navigate]
   );
   // a change made on the server (anyone's call, an issue added, a sync)
   // reaches this board: what it shows is fetched again in the background,
   // once a burst of changes settles, keeping the old numbers up meanwhile
   useEffect(() => {
      let wait: ReturnType<typeof setTimeout> | null = null;
      const off = backend.onProjectsChanged(() => {
         if (wait) clearTimeout(wait);
         wait = setTimeout(() => {
            refreshProjectsData();
            workVersion.set({ n: workVersion.get().n + 1 });
            void loadRoadmap();
         }, CHANGE_SETTLE_MS);
      });
      return () => {
         if (wait) clearTimeout(wait);
         off();
      };
   }, []);
   // this tab shows hidden PRs anyway, so its rows don't offer to hide one
   const tabOpts = useMemo(
      () => ({ ...opts, noHide: true, onPerson: onPersonHere }),
      [opts, onPersonHere]
   );
   const rangeKey = resolveRange(nav.range) ? nav.range : DEFAULT_RANGE;
   const range = resolveRange(rangeKey) as Range;
   const data = useProjectsData(prefix ? range : null);
   // the same days just before the range, for every "compared with" line
   const prev = useProjectsData(prefix ? previousRange(range) : null);
   // every view counts every PR, whatever the filter bar narrows: a project
   // whose PRs are filtered out would otherwise look quiet or finished, and a
   // click on a face would rewrite the planner's numbers
   const today = useMemo(
      () => (prefix ? buildToday(data?.projects ?? [], allPulls, allClosed, prefix) : NO_TODAY),
      [data, allPulls, allClosed, prefix]
   );
   const scoped = allPulls.length !== pulls.length || allClosed.length !== closed.length;
   const teamOf = useMemo(() => teamLookup(data?.teams ?? {}), [data]);
   const { items: plans } = useRoadmap();
   // each plan's PRs by the dates, each project's issues, and which
   // projects run with no end
   const work = useWorkData(plans);
   const ongoing = useMemo(() => ongoingSlugs(data), [data]);
   const items = useMemo(
      () =>
         portfolioItems(
            data?.projects ?? [],
            today,
            data?.window.projects ?? {},
            teamOf,
            Date.now(),
            plans ?? [],
            work?.projects ?? null,
            ongoing
         ),
      [data, today, teamOf, plans, work, ongoing]
   );
   const closedProjects = useMemo(() => closedIssues(data?.projects ?? []), [data]);
   // the calls owed, counted on the tab so they're seen from every view
   const decisions = useMemo(
      () => (plans ? decideRows(today, plans, closedProjects, work, ongoing) : null),
      [today, plans, closedProjects, work, ongoing]
   );
   const views: [ProjectsNav['view'], string][] = [
      ['overview', 'Overview'],
      ['decide', 'Decide'],
      ['roadmap', 'Roadmap'],
      ['people', 'People'],
      ['retro', 'Look back'],
   ];
   const nameOf = useMemo(() => {
      const names = new Map(items.map(i => [i.slug, i.name]));
      names.set(MISC_SLUG, 'One-offs');
      return (slug: string) => names.get(slug) ?? slug;
   }, [items]);

   if (!prefix) {
      return (
         <EmptyState
            variant="search"
            title="Projects aren’t set up here"
            sub="This Pulldasher has no projects block in its config.js. See config.example.js."
         />
      );
   }
   const rangePicker = (
      <DateRangePicker
         rangeKey={rangeKey}
         range={range}
         onChange={key => navigate({ range: key })}
      />
   );
   // one toolbar for the tab: the way back or the view switch, and the date
   // range picker wherever the page shows numbers for a range
   const toolbar = (
      <div className="mb-4 flex flex-wrap items-center gap-3">
         {nav.project ? (
            // named for where it goes: the view the page was opened from
            <button
               type="button"
               onClick={() => navigate({ project: null })}
               className="hit pressable inline-flex items-center gap-1 rounded border-0 bg-transparent p-0 text-[13px] font-medium text-ink-2 hover:text-brand"
            >
               <Icon icon={ChevronLeft} size={14} />
               {BACK_WORDS[nav.view]}
            </button>
         ) : (
            <Segmented
               ariaLabel="projects view"
               value={nav.view}
               options={views}
               counts={{ decide: decisions?.length }}
               tabs
               // a view's own picks (its sort, team, person, week) stay with it,
               // so one view never quietly narrows the next; the range, the find
               // and the roadmap's zoom carry over, each shown where it applies
               onChange={view =>
                  navigate({
                     view,
                     item: null,
                     sort: '',
                     psort: '',
                     team: null,
                     who: null,
                     only: null,
                     week: null,
                     origin: null,
                  })
               }
            />
         )}
         {/* the Overview and Decide are about now, and the roadmap has its
             own months and quarters; the range is for looking back. A
             project's page puts it beside the numbers it sets. */}
         {!nav.project && (nav.view === 'people' || nav.view === 'retro') && rangePicker}
         {scoped && (
            <span className="text-xs text-ink-3">
               Projects counts every PR, whatever the filter bar narrows.
            </span>
         )}
      </div>
   );
   return (
      <>
         {toolbar}
         {nav.project ? (
            // a project's page counts all of its PRs, whatever the filter bar
            // narrows elsewhere, as Decide does
            <ProjectPage
               key={nav.project}
               slug={nav.project}
               today={today}
               data={data}
               prev={prev}
               range={range}
               closed={allClosed}
               prefix={prefix}
               teamOf={teamOf}
               nav={nav}
               navigate={navigate}
               item={items.find(i => i.slug === nav.project)}
               plans={plans}
               ongoingSaved={data?.ongoing ?? []}
               opts={tabOpts}
               onPerson={onPersonHere}
               asks={(decisions ?? []).filter(row => row.slug === nav.project)}
               rangePicker={rangePicker}
            />
         ) : nav.view === 'people' ? (
            <People
               data={data}
               prev={prev}
               today={today}
               range={range}
               teamOf={teamOf}
               nameOf={nameOf}
               me={me}
               onPerson={onPersonHere}
            />
         ) : nav.view === 'decide' ? (
            <Decide
               today={today}
               items={items}
               closed={closedProjects}
               teamOf={teamOf}
               teamMembers={data?.teams ?? {}}
               rotation={data?.decide_rotation ?? null}
               work={work}
               ongoing={ongoing}
               nav={nav}
               navigate={navigate}
            />
         ) : nav.view === 'retro' ? (
            <Retro
               range={range}
               plans={plans ?? []}
               items={items}
               teams={data?.teams ?? {}}
               teamOf={teamOf}
               nameOf={nameOf}
               nav={nav}
               navigate={navigate}
               onPerson={onPersonHere}
            />
         ) : nav.view === 'roadmap' ? (
            <Roadmap
               items={items}
               teamMembers={data?.teams ?? {}}
               teamOf={teamOf}
               nav={nav}
               navigate={navigate}
            />
         ) : (
            <Overview
               today={today}
               data={data}
               prefix={prefix}
               items={items}
               teamOf={teamOf}
               nameOf={nameOf}
               nav={nav}
               navigate={navigate}
               opts={tabOpts}
               decisions={decisions}
               me={me}
               onPerson={onPersonHere}
            />
         )}
      </>
   );
}
