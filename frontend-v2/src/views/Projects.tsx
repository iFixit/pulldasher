import { useMemo } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { DerivedPull } from '../../../shared/model/status';
import type { PullData } from '../../../shared/types';
import { buildToday, MISC_SLUG, type Today } from '../../../shared/model/projects';
import { EmptyState, Segmented } from '../components/bits';
import { Icon } from '../components/Icon';
import type { RowOptions } from '../components/Row';
import {
   DEFAULT_RANGE,
   previousRange,
   resolveRange,
   teamLookup,
   useProjectsData,
   type Range,
} from '../model/projectData';
import { portfolioItems } from '../model/portfolio';
import { useRoadmap } from '../model/roadmapData';
import { DateRangePicker } from './projects/DateRangePicker';
import { Overview } from './projects/Overview';
import { People } from './projects/People';
import { ProjectPage } from './projects/ProjectPage';
import { Roadmap } from './projects/Roadmap';
import type { Navigate, ProjectsNav } from './projects/parts';

export type { ProjectsNav } from './projects/parts';

const VIEWS: [ProjectsNav['view'], string][] = [
   ['overview', 'Overview'],
   ['roadmap', 'Roadmap'],
   ['people', 'People'],
];

const NO_TODAY: Today = { live: [], quiet: [], misc: [], unsorted: [], doubleLabeled: [] };

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
   prefix,
   nav,
   navigate,
   opts,
   me,
   onPerson,
   onReview,
}: {
   /** people's open PRs, narrowed by the repo and people filters only */
   pulls: DerivedPull[];
   /** people's PRs closed in the last 14 days, same narrowing */
   closed: PullData[];
   /** the project label prefix; null when the server isn't set up for projects */
   prefix: string | null;
   nav: ProjectsNav;
   navigate: Navigate;
   opts: RowOptions;
   me: string;
   onPerson: (login: string) => void;
   /** to the review board */
   onReview: () => void;
}) {
   const rangeKey = resolveRange(nav.range) ? nav.range : DEFAULT_RANGE;
   const range = resolveRange(rangeKey) as Range;
   const data = useProjectsData(prefix ? range : null);
   // the same days just before the range, for every "compared with" line
   const prev = useProjectsData(prefix ? previousRange(range) : null);
   const today = useMemo(
      () => (prefix ? buildToday(data?.projects ?? [], pulls, closed, prefix) : NO_TODAY),
      [data, pulls, closed, prefix]
   );
   const teamOf = useMemo(() => teamLookup(data?.teams ?? {}), [data]);
   const { items: plans } = useRoadmap();
   const items = useMemo(
      () =>
         portfolioItems(
            data?.projects ?? [],
            today,
            data?.window.projects ?? {},
            teamOf,
            Date.now(),
            plans ?? []
         ),
      [data, today, teamOf, plans]
   );
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
   // one toolbar for the tab: the way back or the view switch, and the date
   // range picker wherever the page shows numbers for a range
   const toolbar = (
      <div className="mb-4 flex flex-wrap items-center gap-3">
         {nav.project ? (
            <button
               type="button"
               onClick={() => navigate({ project: null })}
               className="hit pressable inline-flex items-center gap-1 rounded border-0 bg-transparent p-0 text-[13px] font-medium text-ink-2 hover:text-brand"
            >
               <Icon icon={ChevronLeft} size={14} />
               All projects
            </button>
         ) : (
            <Segmented
               ariaLabel="projects view"
               value={nav.view}
               options={VIEWS}
               onChange={view => navigate({ view, item: null })}
            />
         )}
         {/* the roadmap has its own months and quarters; the range is for numbers */}
         {(nav.project || nav.view !== 'roadmap') && (
            <DateRangePicker
               rangeKey={rangeKey}
               range={range}
               onChange={key => navigate({ range: key })}
            />
         )}
      </div>
   );
   return (
      <>
         {toolbar}
         {nav.project ? (
            <ProjectPage
               slug={nav.project}
               today={today}
               data={data}
               prev={prev}
               range={range}
               closed={closed}
               prefix={prefix}
               teamOf={teamOf}
               opts={opts}
               nav={nav}
               navigate={navigate}
            />
         ) : nav.view === 'people' ? (
            <People
               data={data}
               prev={prev}
               today={today}
               range={range}
               teamOf={teamOf}
               me={me}
               onPerson={onPerson}
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
               prev={prev}
               range={range}
               prefix={prefix}
               items={items}
               teamOf={teamOf}
               nameOf={nameOf}
               nav={nav}
               navigate={navigate}
               opts={opts}
               onReview={onReview}
            />
         )}
      </>
   );
}
