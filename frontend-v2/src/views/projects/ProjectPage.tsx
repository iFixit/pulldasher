import { pullKey } from '../../../../shared/format';
import {
   projectOf,
   type ProjectGroup,
   type ProjectWindow,
   type Today,
   type WindowCounts,
} from '../../../../shared/model/projects';
import type { PullData } from '../../../../shared/types';
import { EmptyState } from '../../components/bits';
import { ClosedRow } from '../../components/ClosedRow';
import { Fold, FoldRows, GroupHeader, RestGroup, Rows } from '../../components/Lane';
import type { RowOptions } from '../../components/Row';
import {
   chartWindow,
   dayOf,
   dayWords,
   rangeDays,
   rangeWords,
   useProjectsData,
   type ProjectsData,
   type Range,
} from '../../model/projectData';
import { StatsCard } from '../stats/parts';
import { BacklogFlowChart, ChartSlot } from './lazyCharts';
import {
   FlagWords,
   PeopleStack,
   ProjectFacts,
   WindowTiles,
   type Navigate,
   type ProjectsNav,
} from './parts';
import { PlanFacts } from './roadmapHealth';

const DAY_MS = 86_400_000;
/** how many trailing days set the pace a forecast runs on */
const PACE_DAYS = 28;

// a project with no PRs in the period before still compares, against zero
const ZERO: WindowCounts = {
   backlog_start: 0,
   backlog_end: 0,
   opened: 0,
   merged: 0,
   closed: 0,
   median_age_start_days: null,
   median_age_end_days: null,
   median_days_to_merge: null,
   developers: 0,
   non_developers: 0,
};

const dateWords = (ms: number) =>
   new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * A rough finish date for a project with an end: its open PRs divided by how
 * many it finished (merged or closed) a week over the last four. New PRs
 * keep arriving, so it's a guide, and it says so; set against the target,
 * it answers "will this land in time?" in one sentence.
 */
function Forecast({
   group,
   days,
   dueOn,
}: {
   group: ProjectGroup;
   days: { departed: number }[];
   dueOn: string | null;
}) {
   const open = group.open.length;
   if (!open || days.length < 2) return null;
   const last = days[days.length - 1].departed;
   const before = days[Math.max(0, days.length - 1 - PACE_DAYS)].departed;
   const finished = last - before;
   if (finished <= 0) {
      return (
         <p className="m-0 text-xs text-ink-3">
            Nothing here merged or closed in the last four weeks, so there’s no pace to guess a
            finish from.
         </p>
      );
   }
   const perWeek = finished / (PACE_DAYS / 7);
   const weeks = Math.max(1, Math.round(open / perWeek));
   const eta = Date.now() + weeks * 7 * DAY_MS;
   // the milestone's day as GitHub means it, the same day the facts row shows
   const due = dueOn?.slice(0, 10) ?? null;
   const late = due != null && dayOf(new Date(eta)) > due;
   return (
      <p
         className="m-0 text-xs text-ink-2"
         title="A rough guide: it assumes the last four weeks' pace holds and no new PRs arrive."
      >
         At the last four weeks’ pace ({finished} finished, about {Math.round(perWeek * 10) / 10} a
         week), the {open} open PR{open === 1 ? '' : 's'} take about {weeks} week
         {weeks === 1 ? '' : 's'}: around {dateWords(eta)}.
         {due && (
            <span className={late ? 'text-warn' : undefined}>
               {' '}
               That’s {late ? 'after' : 'before'} the {dayWords(due)} target.
            </span>
         )}
      </p>
   );
}

/** The project's own backlog chart and forecast, on at least 90 days
 * ending on the range's last day. */
function ProjectFlow({
   slug,
   range,
   group,
   ongoing,
   dueOn,
}: {
   slug: string;
   range: Range;
   group: ProjectGroup | undefined;
   ongoing: boolean;
   dueOn: string | null;
}) {
   const shown = chartWindow(range);
   const data = useProjectsData(shown, slug);
   // a pace only means something when the range runs up to today
   const current = range.end >= dayOf(new Date());
   return (
      <section className="mb-7">
         <GroupHeader title="Backlog against throughput" sub={rangeWords(shown)} />
         <StatsCard>
            {data === null ? (
               <p className="m-0 text-[13px] text-ink-3">Couldn’t load the chart.</p>
            ) : (
               <>
                  {data && group && !ongoing && current && (
                     <div className="mb-3">
                        <Forecast group={group} days={data.window.days} dueOn={dueOn} />
                     </div>
                  )}
                  <ChartSlot height={200}>
                     {data && (
                        <BacklogFlowChart days={data.window.days} picked={range} height={200} />
                     )}
                  </ChartSlot>
               </>
            )}
         </StatsCard>
      </section>
   );
}

/**
 * One project's page: what its issue says, who is on it (developers and
 * everyone else), its open PRs as board rows, what merged in the last 14
 * days, its numbers for the range against the days before, its backlog
 * chart, and, for a project with an end, a rough finish date. Everything
 * comes from GitHub, so there's nothing to edit here: the issue holds the
 * name, lead, target and parents, and the labels hold the PRs.
 */
export function ProjectPage({
   slug,
   today,
   data,
   prev,
   range,
   closed,
   prefix,
   teamOf,
   opts,
   nav,
   navigate,
}: {
   slug: string;
   today: Today;
   /** undefined while the project issues load, null if that failed */
   data: ProjectsData | null | undefined;
   prev: ProjectsData | null | undefined;
   range: Range;
   closed: PullData[];
   prefix: string;
   teamOf: (login: string) => string | null;
   opts: RowOptions;
   nav: ProjectsNav;
   navigate: Navigate;
}) {
   const live = today.live.find(g => g.slug === slug);
   const group = live ?? today.quiet.find(g => g.slug === slug);
   const project = group?.project ?? data?.projects.find(p => p.slug === slug) ?? null;
   // a closed project isn't on Today, so read its recent merges straight off
   // the closed pulls (the server keeps 14 days of them)
   const merged =
      group?.merged ?? closed.filter(p => p.merged_at && projectOf(p.labels, prefix) === slug);
   const w: ProjectWindow | undefined = data?.window.projects[slug];
   const before = prev === undefined ? undefined : prev?.window.projects[slug] ?? ZERO;
   if (!group && !project && !w && !merged.length) {
      return data === undefined ? (
         <p className="text-[13px] text-ink-3">Loading the project…</p>
      ) : (
         <EmptyState
            variant="search"
            title="No project by that name"
            sub={`Nothing open, merged lately, or on an issue carries ${prefix}${slug}.`}
         />
      );
   }
   const standing = live
      ? 'Live'
      : group
      ? 'Quiet'
      : project?.state === 'closed'
      ? project.state_reason === 'not_planned'
         ? 'Dropped'
         : 'Done'
      : 'Nothing in flight';
   const people = group?.people ?? [];
   const devs = people.filter(login => teamOf(login) != null);
   const others = people.filter(login => teamOf(login) == null);
   return (
      <>
         <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="m-0 text-base font-semibold leading-snug">{project?.name ?? slug}</h2>
            <span className="text-xs text-ink-3">{standing}</span>
            <span className="text-xs text-ink-3">{prefix + slug}</span>
            {group && (
               <span className="flex items-center gap-3 text-xs">
                  <FlagWords g={group} />
               </span>
            )}
            {people.length > 0 && (
               <span className="ml-auto flex items-center gap-3 text-xs text-ink-3">
                  {devs.length > 0 && (
                     <span className="inline-flex items-center gap-1.5">
                        Developers <PeopleStack logins={devs} size={20} />
                     </span>
                  )}
                  {others.length > 0 && (
                     <span className="inline-flex items-center gap-1.5">
                        Others <PeopleStack logins={others} size={20} />
                     </span>
                  )}
               </span>
            )}
         </div>
         <div className="mb-7">
            <Rows>
               <ProjectFacts g={{ slug }} project={project} />
               <PlanFacts slug={slug} nav={nav} navigate={navigate} />
               {group && group.open.length > 0 ? (
                  <FoldRows list={group.open} opts={opts} id={`project:${slug}:open`} />
               ) : (
                  <div className="border-t border-secondary px-3.5 py-3 text-[13px] text-ink-3">
                     No open PRs.
                  </div>
               )}
            </Rows>
         </div>
         {merged.length > 0 && (
            <RestGroup>
               <Fold
                  count={merged.length}
                  label="Merged in the last 14 days"
                  id={`project:${slug}:merged`}
                  defaultOpen
               >
                  {merged.map(p => (
                     <ClosedRow key={pullKey(p)} pull={p} lastSeen={opts.lastSeen} />
                  ))}
               </Fold>
            </RestGroup>
         )}
         {w && (
            <section className="mb-7">
               <GroupHeader title="In the date range" sub={rangeWords(range)} />
               <StatsCard>
                  <WindowTiles w={w} prev={before} period={`${rangeDays(range)} days before`} />
               </StatsCard>
            </section>
         )}
         <ProjectFlow
            slug={slug}
            range={range}
            group={live}
            ongoing={!!project?.ongoing}
            dueOn={project?.target?.due_on ?? null}
         />
      </>
   );
}
