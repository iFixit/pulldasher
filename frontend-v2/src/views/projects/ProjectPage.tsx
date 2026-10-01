import { useState } from 'react';
import type { DecideRow } from '../../../../shared/model/decide';
import {
   projectOf,
   targetOf,
   type DayPoint,
   type ProjectGroup,
   type ProjectWindow,
   type Today,
   type WindowCounts,
} from '../../../../shared/model/projects';
import {
   healthStanding,
   isUnderWay,
   planFor,
   type RoadmapItem,
} from '../../../../shared/model/roadmap';
import { issueKey } from '../../../../shared/model/work';
import type { PullData } from '../../../../shared/types';
import { EmptyState } from '../../components/bits';
import { GroupHeader, Rows } from '../../components/Lane';
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
import { stageWord, type PortfolioItem } from '../../model/portfolio';
import { setOngoing } from '../../model/settingsData';
import { StatsCard } from '../stats/parts';
import { reasonWords } from './Decide';
import { ChartSlot, FlowWeeksChart, OpenPrsChart } from './lazyCharts';
import {
   FlagWords,
   PeopleStack,
   ProjectFacts,
   WindowTiles,
   type Navigate,
   type ProjectsNav,
} from './parts';
import { healthWords, PlanFacts } from './roadmapHealth';
import { ProjectWorkSection, type PullLookup } from './Work';

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
 * it answers "will this land in time?" in one sentence. A late finish is
 * amber only when the plan's health isn't already asking for the call.
 */
function Forecast({
   group,
   days,
   dueOn,
   asked,
}: {
   group: ProjectGroup;
   days: DayPoint[];
   dueOn: string | null;
   /** the plan's own health already says it's in trouble */
   asked: boolean;
}) {
   const open = group.open.length;
   if (!open || days.length < 2) return null;
   const last = days[days.length - 1].departed;
   const before = days[Math.max(0, days.length - 1 - PACE_DAYS)].departed;
   const finished = last - before;
   if (finished <= 0) {
      return (
         <p className="m-0 text-xs text-ink-3">
            No PR here merged or closed in the last four weeks, so there’s no pace to estimate a
            finish date from.
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
         title="A rough guide: it assumes the last four weeks’ pace holds and no new PRs arrive."
      >
         At the last four weeks’ pace ({finished} merged or closed, about{' '}
         {Math.round(perWeek * 10) / 10} a week), the {open} open PR{open === 1 ? '' : 's'} take
         about {weeks} week
         {weeks === 1 ? '' : 's'}: around {dateWords(eta)}.
         {due && (
            <span className={late && !asked ? 'text-warn' : undefined}>
               {' '}
               That’s {late ? 'after' : 'on or before'} the {dayWords(due)} target.
            </span>
         )}
      </p>
   );
}

/** The project's own backlog chart, on at least 90 days ending on the
 * range's last day. */
function ProjectFlow({ data, range }: { data: ProjectsData | null | undefined; range: Range }) {
   return (
      <section className="mb-7">
         <GroupHeader title="Is its backlog growing?" sub={rangeWords(chartWindow(range))} />
         <StatsCard>
            {data === null ? (
               <p className="m-0 text-[13px] text-ink-3">
                  Couldn’t load the chart. Try again in a minute.
               </p>
            ) : (
               <div className="flex flex-col gap-4">
                  <ChartSlot height={200}>
                     {data && <OpenPrsChart days={data.window.days} picked={range} />}
                  </ChartSlot>
                  <ChartSlot height={210}>
                     {data && <FlowWeeksChart weeks={data.window.weeks} picked={range} />}
                  </ChartSlot>
               </div>
            )}
         </StatsCard>
      </section>
   );
}

/**
 * What Decide asks about this project, in Decide's words, so the page
 * answers the question it was opened for. Its plan's health already shows
 * an at-risk or off-track call, so those aren't repeated.
 */
function DecideAsks({ rows, navigate }: { rows: DecideRow[]; navigate: Navigate }) {
   const said = rows.flatMap(row =>
      row.reasons
         .filter(r => r.kind !== 'off_track' && r.kind !== 'at_risk')
         .map(
            r =>
               (rows.length > 1 && row.item ? `${row.item.name}: ` : '') + reasonWords(r, row.item)
         )
   );
   if (!said.length) return null;
   return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-secondary px-3.5 py-2 text-xs">
         <span className="font-medium text-warn">Decide asks</span>
         <span className="min-w-0 text-ink-2">{said.join(' ')}</span>
         <button
            type="button"
            onClick={() => navigate({ project: null, view: 'decide' })}
            className="hit pressable ml-auto rounded border-0 bg-transparent p-0 text-xs font-medium text-brand hover:underline"
         >
            Make the call in Decide
         </button>
      </div>
   );
}

/**
 * One project's page: its name, standing and who is on it; one card with
 * its issue's facts, its plan, what Decide asks about it, and when it might
 * finish; its issues with the PRs that link them; its numbers for the range
 * against the days before; and its backlog chart. The issue holds the name,
 * lead, target and parents, and the labels hold the PRs, so those are
 * edited on GitHub.
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
   nav,
   navigate,
   item,
   plans,
   ongoingSaved,
   opts,
   onPerson,
   asks,
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
   nav: ProjectsNav;
   navigate: Navigate;
   /** its row on the project list, for its stage and name; missing for a
    * slug the list doesn't know */
   item: PortfolioItem | undefined;
   /** the roadmap's plans, null while they load */
   plans: readonly RoadmapItem[] | null;
   /** the projects marked ongoing on the board (not by label) */
   ongoingSaved: string[];
   /** how the board draws its PR rows */
   opts: RowOptions;
   /** narrow the board to a person's work */
   onPerson: (login: string) => void;
   /** Decide's rows about this project */
   asks: DecideRow[];
}) {
   // the box flips at once; a failed save puts it back and says why
   const [want, setWant] = useState<boolean | null>(null);
   const [saveError, setSaveError] = useState<string | null>(null);
   // the chart's days, which the forecast reads too (fetched once, cached)
   const flow = useProjectsData(chartWindow(range), slug);
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
            sub={`No issue or PR (open, merged in the last 14 days, or in the date range) carries the ${prefix}${slug} label.`}
         />
      );
   }
   const standing = item
      ? stageWord(item)
      : live
      ? 'In progress'
      : group
      ? 'Quiet'
      : project?.state === 'closed'
      ? project.state_reason === 'not_planned'
         ? 'Dropped'
         : 'Done'
      : 'Not in progress';
   const byLabel = !!project?.ongoing;
   const ongoing = byLabel || (want ?? ongoingSaved.includes(slug));
   const markOngoing = (on: boolean) => {
      setWant(on);
      setSaveError(null);
      void setOngoing(slug, on).then(r => {
         if (!('error' in r)) return;
         setWant(null);
         setSaveError(r.error);
      });
   };
   const plan = plans ? planFor(slug, plans) : null;
   const healthAsks =
      !!plan && isUnderWay(plan.status) && !!healthWords(healthStanding(plan))?.warn;
   // a pace only means something when the range runs up to today
   const current = range.end >= dayOf(new Date());
   const forecast =
      live && !ongoing && current && flow ? (
         <Forecast
            group={live}
            days={flow.window.days}
            dueOn={targetOf(project)?.due_on ?? null}
            asked={healthAsks}
         />
      ) : null;
   // what the board knows of each PR: open ones live on the board (in any
   // project, or none), and the last two weeks' merges
   const liveIndex = new Map(
      [
         ...today.live.flatMap(g => g.open),
         ...today.quiet.flatMap(g => g.open),
         ...today.misc,
         ...today.unsorted,
         ...today.doubleLabeled,
      ].map(p => [issueKey(p.data), p])
   );
   const knownIndex = new Map([...merged, ...closed].map(p => [issueKey(p), p]));
   const pulls: PullLookup = {
      live: ref => liveIndex.get(issueKey(ref)),
      known: ref => knownIndex.get(issueKey(ref)),
   };
   const nameOf = (s: string) => data?.projects.find(p => p.slug === s)?.name ?? null;
   const parts = (data?.projects ?? [])
      .filter(p => p.parents.includes(slug))
      .map(p => ({ slug: p.slug, name: p.name }));
   const people = group?.people ?? [];
   const devs = people.filter(login => teamOf(login) != null);
   const others = people.filter(login => teamOf(login) == null);
   return (
      <>
         <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="m-0 text-base font-semibold leading-snug">
               {item?.name ?? project?.name ?? slug}
            </h2>
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
                        Developers <PeopleStack logins={devs} size={20} onPerson={onPerson} />
                     </span>
                  )}
                  {others.length > 0 && (
                     <span className="inline-flex items-center gap-1.5">
                        Non-developers <PeopleStack logins={others} size={20} onPerson={onPerson} />
                     </span>
                  )}
               </span>
            )}
         </div>
         <div className="mb-7">
            <Rows>
               <ProjectFacts
                  g={{ slug }}
                  project={project}
                  prefix={prefix}
                  ongoing={ongoing}
                  links={{ navigate, nameOf, parts }}
                  onOngoing={markOngoing}
                  ongoingByLabel={byLabel}
               />
               <PlanFacts slug={slug} nav={nav} navigate={navigate} />
               <DecideAsks rows={asks} navigate={navigate} />
               {forecast && <div className="border-t border-secondary px-3.5 py-2">{forecast}</div>}
            </Rows>
            {saveError && <p className="m-0 mt-1 text-xs text-warn">{saveError}</p>}
         </div>
         <ProjectWorkSection
            slug={slug}
            label={prefix + slug}
            plans={plans}
            pulls={pulls}
            opts={opts}
            nameOf={s => nameOf(s) ?? s}
            navigate={navigate}
         />
         {w && (
            <section className="mb-7">
               <GroupHeader title="In the date range" sub={rangeWords(range)} />
               <StatsCard>
                  <WindowTiles w={w} prev={before} period={`${rangeDays(range)} days before`} />
               </StatsCard>
            </section>
         )}
         <ProjectFlow data={flow} range={range} />
      </>
   );
}
