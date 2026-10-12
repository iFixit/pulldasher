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
   trackedData,
   notTrackedSlugs,
   useProjectsData,
   type Range,
} from '../model/projectData';
import { useWorkData, workVersion } from '../model/workData';
import { portfolioItems } from '../model/portfolio';
import { loadRoadmap, trackedPlans, useRoadmap } from '../model/roadmapData';
import { loadInitiatives, useInitiatives } from '../model/initiativesData';
import { grownProjects, trackedToday } from '../model/initiativeBoard';
import { ONE_OFFS } from '../model/words';

/** how long a burst of changes on the server settles before one refetch */
const CHANGE_SETTLE_MS = 2000;
import { DateRangePicker } from './projects/DateRangePicker';
import { Decide, decideRows, useKeptCalls } from './projects/Decide';
import { AllItemsContext } from '../model/decideCalls';
import { InitiativePage } from './projects/Initiatives';
import { Overview } from './projects/Overview';
import { People } from './projects/People';
import { ProjectPage } from './projects/ProjectPage';
import { Retro } from './projects/Retro';
import { Roadmap } from './projects/Roadmap';
import { switchView, type Navigate, type ProjectsNav } from './projects/parts';

export type { ProjectsNav } from './projects/parts';

const NO_TODAY: Today = { live: [], quiet: [], misc: [], unsorted: [], doubleLabeled: [], drafts: [] };

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
   allPulls,
   allClosed,
   prefix,
   nav,
   navigate,
   opts,
   me,
}: {
   /** people's open PRs, and their PRs closed in the last 14 days, whatever
    * the filter bar narrows */
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
      (login: string) => navigate({ ...switchView('people'), who: login }, { push: true }),
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
            void loadInitiatives();
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
   // the full set, Not tracked projects too: only the readers that name it
   // (a person's own list, one project, history) see it; every list, count
   // and question reads the tracked set below
   const fullData = useProjectsData(prefix ? range : null, null, { all: true });
   const { initiatives } = useInitiatives();
   const untracked = useMemo(() => notTrackedSlugs(fullData, initiatives), [fullData, initiatives]);
   const data = useMemo(() => trackedData(fullData, initiatives), [fullData, initiatives]);
   // the same days just before the range, for every "compared with" line
   const prev = useProjectsData(prefix ? previousRange(range) : null, null, { all: true });
   // every view counts every PR, whatever the filter bar narrows: a project
   // whose PRs are filtered out would otherwise look quiet or finished, and a
   // click on a face would rewrite the planner's numbers. A PR with no
   // project label counts where the issues it links put it, as on the server.
   const fullToday = useMemo(
      () =>
         prefix
            ? buildToday(
                 fullData?.projects ?? [],
                 allPulls,
                 allClosed,
                 prefix,
                 Date.now() / 1000,
                 fullData?.pull_links
              )
            : NO_TODAY,
      [fullData, allPulls, allClosed, prefix]
   );
   const today = useMemo(() => trackedToday(fullToday, untracked), [fullToday, untracked]);
   const teamOf = useMemo(() => teamLookup(fullData?.teams ?? {}), [fullData]);
   const { items: allPlans } = useRoadmap({ all: true });
   const plans = useMemo(
      () => allPlans && trackedPlans(allPlans, initiatives),
      [allPlans, initiatives]
   );
   // each plan's PRs by the dates, each project's issues, and which
   // projects run with no end; every plan's, so the not-tracked rows get
   // their work too
   const work = useWorkData(allPlans);
   const ongoing = useMemo(() => ongoingSlugs(fullData), [fullData]);
   const allItems = useMemo(
      () =>
         portfolioItems(
            fullData?.projects ?? [],
            fullToday,
            fullData?.window.projects ?? {},
            teamOf,
            Date.now(),
            allPlans ?? [],
            work?.projects ?? null,
            ongoing
         ),
      [fullData, fullToday, teamOf, allPlans, work, ongoing]
   );
   const items = useMemo(() => allItems.filter(i => !untracked.has(i.slug)), [allItems, untracked]);
   const closedProjects = useMemo(() => closedIssues(data?.projects ?? []), [data]);
   // the Not tracked projects that grew, which Decide asks about again
   const grown = useMemo(() => grownProjects(fullData, initiatives), [fullData, initiatives]);
   // the calls owed, counted on the tab so they're seen from every view
   const decisions = useMemo(
      () =>
         plans
            ? decideRows(today, plans, closedProjects, work, ongoing, {
                 initiatives: initiatives ?? [],
                 grown,
              })
            : null,
      [today, plans, closedProjects, work, ongoing, initiatives, grown]
   );
   // a call made this visit stays with its row (a receipt and Undo) on
   // Decide and on the project's page; the badge counts what's still owed
   const kept = useKeptCalls(decisions ?? []);
   const owedCalls = decisions ? kept.owed : null;
   const views: [ProjectsNav['view'], string][] = [
      ['overview', 'Overview'],
      ['decide', 'Decide'],
      ['roadmap', 'Roadmap'],
      ['people', 'People'],
      ['retro', 'Look back'],
   ];
   // one slug: read from the full set, so a not-tracked project has its name
   const nameOf = useMemo(() => {
      const names = new Map(allItems.map(i => [i.slug, i.name]));
      names.set(MISC_SLUG, ONE_OFFS);
      return (slug: string) => names.get(slug) ?? slug;
   }, [allItems]);

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
         {nav.project || nav.initiative ? (
            // named for where it goes: the view the page was opened from
            <button
               type="button"
               onClick={() => navigate({ project: null, initiative: null })}
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
               counts={{ decide: owedCalls?.length }}
               tabs
               // a view's own picks (its sort, team, person, week) stay with it,
               // so one view never quietly narrows the next; the range, the find
               // and the roadmap's zoom carry over, each shown where it applies
               onChange={view => navigate(switchView(view))}
            />
         )}
         {/* the Overview and Decide are about now, and the roadmap has its
             own months and quarters; the range is for looking back. A
             project's page puts it beside the numbers it sets. */}
         {!nav.project &&
            !nav.initiative &&
            (nav.view === 'people' || nav.view === 'retro') &&
            rangePicker}
      </div>
   );
   return (
      <AllItemsContext.Provider value={allItems}>
         {toolbar}
         {nav.initiative && !nav.project ? (
            <InitiativePage
               key={nav.initiative}
               slug={nav.initiative}
               initiatives={initiatives}
               items={allItems}
               plans={allPlans}
               calls={kept.all}
               nav={nav}
               navigate={navigate}
               onPerson={onPersonHere}
            />
         ) : nav.project ? (
            // a project's page counts all of its PRs, whatever the filter bar
            // narrows elsewhere, as Decide does
            <ProjectPage
               key={nav.project}
               slug={nav.project}
               today={fullToday}
               data={fullData}
               range={range}
               closed={allClosed}
               prefix={prefix}
               teamOf={teamOf}
               nav={nav}
               navigate={navigate}
               item={allItems.find(i => i.slug === nav.project)}
               plans={allPlans}
               initiatives={initiatives}
               untracked={untracked.has(nav.project)}
               ongoingSaved={fullData?.ongoing ?? []}
               opts={tabOpts}
               onPerson={onPersonHere}
               asks={kept.owed.filter(row => row.slug === nav.project)}
               calls={kept.all.filter(row => row.slug === nav.project)}
               rangePicker={rangePicker}
            />
         ) : nav.view === 'people' ? (
            <People
               data={fullData}
               prev={prev}
               today={fullToday}
               range={range}
               teamOf={teamOf}
               nameOf={nameOf}
               me={me}
               items={allItems}
               nav={nav}
               navigate={navigate}
            />
         ) : nav.view === 'decide' ? (
            <Decide
               today={today}
               items={items}
               allItems={allItems}
               initiatives={initiatives}
               grown={grown}
               closed={closedProjects}
               teamOf={teamOf}
               teamMembers={data?.teams ?? {}}
               rotation={data?.decide_rotation ?? null}
               work={work}
               ongoing={ongoing}
               prefix={prefix}
               opts={tabOpts}
               nav={nav}
               navigate={navigate}
               onPerson={onPersonHere}
               projectsRepo={data?.projects_repo}
            />
         ) : nav.view === 'retro' ? (
            <Retro
               range={range}
               plans={allPlans ?? []}
               items={allItems}
               initiatives={initiatives}
               untracked={untracked}
               teams={data?.teams ?? {}}
               teamOf={teamOf}
               nameOf={nameOf}
               nav={nav}
               navigate={navigate}
               onPerson={onPersonHere}
               opts={tabOpts}
            />
         ) : nav.view === 'roadmap' ? (
            <Roadmap
               items={items}
               allItems={allItems}
               initiatives={initiatives}
               untracked={untracked}
               teamMembers={data?.teams ?? {}}
               nav={nav}
               navigate={navigate}
               decisions={owedCalls}
            />
         ) : (
            <Overview
               today={today}
               fullToday={fullToday}
               data={data}
               prefix={prefix}
               items={items}
               allItems={allItems}
               initiatives={initiatives}
               untracked={untracked}
               teamOf={teamOf}
               nameOf={nameOf}
               nav={nav}
               navigate={navigate}
               opts={tabOpts}
               decisions={owedCalls}
               me={me}
               onPerson={onPersonHere}
            />
         )}
      </AllItemsContext.Provider>
   );
}
