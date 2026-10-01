import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { issueUrl, n, pullKey } from '../../../../shared/format';
import type { DecideRow } from '../../../../shared/model/decide';
import {
   dayStart,
   projectOf,
   targetOf,
   type DayPoint,
   type ProjectGroup,
   type ProjectWindow,
   type Today,
   type WindowCounts,
} from '../../../../shared/model/projects';
import {
   HEALTH_WORD,
   healthStanding,
   isUnderWay,
   planFor,
   UPDATE_DUE_DAYS,
   type RoadmapItem,
} from '../../../../shared/model/roadmap';
import type { DerivedPull } from '../../../../shared/model/status';
import { issueKey } from '../../../../shared/model/work';
import type { PullData } from '../../../../shared/types';
import { EmptyState } from '../../components/bits';
import { ClosedRow } from '../../components/ClosedRow';
import { foldDomId, GroupHeader, openFold } from '../../components/Lane';
import { Popover } from '../../components/Popover';
import { Row, type RowOptions } from '../../components/Row';
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
import { useProjectWork } from '../../model/projectWork';
import { setOngoing } from '../../model/settingsData';
import {
   holderWords,
   prStage,
   STAGE_WORDS,
   withBoardStates,
   type PrStage,
} from '../../model/stage';
import { StatsCard } from '../stats/parts';
import { reasonWords } from './Decide';
import { ChartSlot, FlowWeeksChart, OpenPrsChart } from './lazyCharts';
import {
   flagText,
   openPlan,
   PeopleStack,
   ProjectFacts,
   targetWords,
   WindowTiles,
   type Navigate,
   type ProjectsNav,
} from './parts';
import { PLAN_STATUS_WORD, planWords, UpdatesPanel, when } from './roadmapHealth';
import { ProjectWorkSections, type PullLookup } from './Work';

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

/** words that start a line, with a capital */
const upper = (s: string) => s[0].toUpperCase() + s.slice(1);

const dateWords = (ms: number) =>
   new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** the order a project's open PRs are counted in: nearest to shipping first */
const PR_STAGES: readonly PrStage[] = ['ready', 'hold', 'review', 'work'];

/**
 * A rough finish date for a project with an end: its open PRs divided by how
 * many it finished (merged or closed) a week over the last four. New PRs
 * keep arriving, so it's a guide, and its hover says how it's worked out.
 */
function forecastOf(
   group: ProjectGroup,
   days: DayPoint[],
   dueOn: string | null
): { text: string; late: boolean; title?: string } | null {
   const open = group.open.length;
   if (!open || days.length < 2) return null;
   const last = days[days.length - 1].departed;
   const before = days[Math.max(0, days.length - 1 - PACE_DAYS)].departed;
   const finished = last - before;
   if (finished <= 0) {
      return { text: 'nothing merged or closed in four weeks to set a pace from', late: false };
   }
   const perWeek = finished / (PACE_DAYS / 7);
   const weeks = Math.max(1, Math.round(open / perWeek));
   const eta = Date.now() + weeks * 7 * DAY_MS;
   // the milestone's day as GitHub means it, the same day the target shows
   const due = dueOn?.slice(0, 10) ?? null;
   const late = due != null && dayOf(new Date(eta)) > due;
   return {
      text: `at the last four weeks’ pace, done around ${dateWords(eta)}${
         late ? ', after the target' : ''
      }`,
      late,
      title: `${finished} merged or closed in four weeks, about ${
         Math.round(perWeek * 10) / 10
      } a week, so the ${n(open, 'open PR')} take about ${n(
         weeks,
         'week'
      )}. A rough guide: it assumes the pace holds and no new PRs arrive.`,
   };
}

/** A count that opens the list of what it counts: the board's own rows,
 * each with who holds it under it. */
function CountList({
   words,
   pulls,
   opts,
}: {
   words: string;
   pulls: DerivedPull[];
   opts: RowOptions;
}) {
   return (
      <Popover
         label={`The PRs ${words}`}
         width="w-[460px] max-w-[calc(100vw-2rem)]"
         panelClass="p-1"
         trigger={t => (
            <button
               {...t}
               type="button"
               className="hit pressable rounded border-0 bg-transparent p-0 text-left text-[13px] text-ink-2 underline decoration-dotted underline-offset-2 hover:text-brand"
            >
               {pulls.length} {words}
            </button>
         )}
      >
         {pulls.map(p => {
            const who = holderWords(p, { turns: opts.turns, ageWarnDays: opts.ageWarnDays });
            return (
               <div key={pullKey(p.data)} className="border-t border-secondary first:border-t-0">
                  <Row pull={p} opts={opts} />
                  <p className="m-0 -mt-1 pb-1.5 pl-[45px] pr-3.5 text-xs text-ink-3">
                     {upper(who)}
                  </p>
               </div>
            );
         })}
      </Popover>
   );
}

/** The PRs merged lately, as the board's closed rows. */
function MergedList({ pulls, lastSeen }: { pulls: PullData[]; lastSeen: number }) {
   return (
      <Popover
         label="Merged in the last 2 weeks"
         width="w-[460px] max-w-[calc(100vw-2rem)]"
         panelClass="p-1"
         trigger={t => (
            <button
               {...t}
               type="button"
               className="hit pressable rounded border-0 bg-transparent p-0 text-left text-[13px] text-ink-2 underline decoration-dotted underline-offset-2 hover:text-brand"
            >
               {pulls.length} merged in the last 2 weeks
            </button>
         )}
      >
         {pulls.map(p => (
            <ClosedRow key={pullKey(p)} pull={p} lastSeen={lastSeen} />
         ))}
      </Popover>
   );
}

/** Something someone owes on this project, as a row of the summary: the
 * word in amber, then the why, and the way to do it right after it. */
function Owed({
   word,
   children,
   action,
}: {
   word: string;
   children: ReactNode;
   action?: ReactNode;
}) {
   return (
      <>
         <dt className="font-medium text-warn">{word}</dt>
         <dd className="m-0 text-ink-2">
            {children}
            {action && <> {action}</>}
         </dd>
      </>
   );
}

const linkClass =
   'hit pressable rounded border-0 bg-transparent p-0 text-left text-[13px] font-medium text-brand hover:underline';
const factClass =
   'hit pressable rounded border-0 bg-transparent p-0 text-left text-[13px] text-ink-2 hover:text-brand hover:underline';

/** A target in the plan's words: its name when it has one, and its day. */
function targetText(
   target: NonNullable<ReturnType<typeof targetOf>>,
   due: string | null,
   missed: boolean
): string {
   if (!due) return `target ${targetWords(target)}`;
   const day = dayWords(due);
   const name = target.title && target.title !== day ? target.title : null;
   if (missed) return name ? `missed the ${name} target, ${day}` : `missed the ${day} target`;
   return name ? `${name} target, ${day}` : `target ${day}`;
}

/** Open a fold below and bring it into view. */
function jumpTo(foldId: string | null, sectionId: string) {
   if (foldId) openFold(foldId);
   // after the fold opens, so its height is in place
   requestAnimationFrame(() =>
      document
         .getElementById(foldId ? foldDomId(foldId) : sectionId)
         ?.scrollIntoView({ block: 'start' })
   );
}

/**
 * One project's page, read top to bottom: who it is, then what's owed on
 * it and where it stands (its latest update, its plan and finish, its PRs
 * by where they stand, its issues), then its issues by stage, its PRs that
 * do none of them, the issues its PRs link that aren't in it, its numbers
 * for a range, and its backlog chart. The issue holds the name, lead,
 * target and parents, and the labels hold the PRs, so those are edited on
 * GitHub.
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
   rangePicker,
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
   /** the date range's picker, beside the numbers it sets */
   rangePicker?: ReactNode;
}) {
   // the box flips at once; a failed save puts it back and says why
   const [want, setWant] = useState<boolean | null>(null);
   const [saveError, setSaveError] = useState<string | null>(null);
   const [posting, setPosting] = useState(false);
   // a posted update is the plan's new latest one: the form's job is done
   const latestAt = (plans ? planFor(slug, plans) : null)?.update?.at ?? null;
   const formFrom = useRef(latestAt);
   useEffect(() => {
      if (posting && latestAt !== formFrom.current) setPosting(false);
      formFrom.current = latestAt;
   }, [latestAt, posting]);
   // the chart's days, which the forecast reads too (fetched once, cached)
   const flow = useProjectsData(chartWindow(range), slug);
   // its issues and PRs, which the summary counts and the list shows
   const work = useProjectWork(slug, plans);
   // its rows are on this project's page, so their popover doesn't link here
   const rowOpts = useMemo(() => ({ ...opts, onProject: undefined }), [opts]);
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
   const plan = plans ? planFor(slug, plans) : null;
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
   // its PRs' states as the board knows them now, not as they were on load
   const page = work && withBoardStates(work, pulls.live, pulls.known);
   const nameOf = (s: string) => data?.projects.find(p => p.slug === s)?.name ?? null;
   const parts = (data?.projects ?? [])
      .filter(p => p.parents.includes(slug))
      .map(p => ({ slug: p.slug, name: p.name }));
   const people = group?.people ?? [];
   const devs = people.filter(login => teamOf(login) != null);
   const others = people.filter(login => teamOf(login) == null);

   // its open PRs by where they stand, from the same list the page shows
   const onPage = new Map(
      [...(page?.issues.flatMap(i => i.prs) ?? []), ...(page?.unlinked ?? [])].map(pr => [
         issueKey(pr),
         pr,
      ])
   );
   const byStage = new Map<PrStage, DerivedPull[]>(PR_STAGES.map(s => [s, []]));
   let unread = 0;
   const mergedLately: PullData[] = [];
   for (const pr of onPage.values()) {
      const p = pulls.live(pr);
      const known = p ? undefined : pulls.known(pr);
      if (p) byStage.get(prStage(p))?.push(p);
      else if (pr.state === 'open') unread++;
      else if (known?.merged_at) mergedLately.push(known);
   }
   // what's owed on it: Decide's question, an update its lead owes, and the
   // flags the board raises, each in amber with the way to answer it
   const planHealth = plan && isUnderWay(plan.status) ? healthStanding(plan) : null;
   const update =
      planHealth?.kind === 'current' || planHealth?.kind === 'stale' ? planHealth.update : null;
   const decideSaid = asks.flatMap(row =>
      row.reasons.map(reason => {
         const words = reasonWords(reason, row.item);
         const named = asks.length > 1 && row.item ? `${row.item.name}: ${words}` : words;
         return /[.?!]$/.test(named) ? named : `${named}.`;
      })
   );
   // Decide asks about a closed issue as it is, or as one with PRs still open
   const decideClosed = asks.some(row =>
      row.reasons.some(
         r => r.kind === 'issue_closed' || (r.kind === 'reopened' && r.by === 'issue')
      )
   );
   const owed: ReactNode[] = [];
   if (decideSaid.length) {
      owed.push(
         <Owed
            key="decide"
            word="Decide asks"
            action={
               <button
                  type="button"
                  // every team's rows, so this one is there
                  onClick={() => navigate({ project: null, view: 'decide', team: null })}
                  className={linkClass}
               >
                  Make the call in Decide
               </button>
            }
         >
            {decideSaid.join(' ')}
         </Owed>
      );
   }
   if (plan && (planHealth?.kind === 'missing' || planHealth?.kind === 'stale')) {
      owed.push(
         <Owed
            key="update"
            word={planHealth.kind === 'missing' ? 'No update' : 'Update due'}
            action={
               <button
                  type="button"
                  onClick={() => setPosting(!posting)}
                  aria-expanded={posting}
                  className={linkClass}
               >
                  {posting ? 'Close' : 'Post an update'}
               </button>
            }
         >
            {planHealth.kind === 'stale'
               ? `${planHealth.update.author}’s last update was ${planHealth.days} days ago; one is due every ${UPDATE_DUE_DAYS} days.`
               : `None since it started; one is due every ${UPDATE_DUE_DAYS} days.`}
         </Owed>
      );
   }
   for (const flag of group?.flags ?? []) {
      // Decide already asks about a closed issue
      if (flag === 'issue_closed' && decideClosed) continue;
      const [word, why] = flagText(flag, group as ProjectGroup);
      const lone = group?.people[0];
      const action =
         flag === 'one_person' && lone ? (
            <button type="button" onClick={() => onPerson(lone)} className={linkClass}>
               See their PRs
            </button>
         ) : flag === 'waiting_on_review' ? (
            <CountList
               words="waiting on review"
               pulls={byStage.get('review') ?? []}
               opts={rowOpts}
            />
         ) : flag === 'issue_closed' && project ? (
            <a
               href={issueUrl(project.repo, project.number)}
               target="_blank"
               rel="noopener noreferrer"
               className={linkClass}
            >
               Open its issue
            </a>
         ) : undefined;
      owed.push(
         <Owed key={flag} word={upper(word)} action={action}>
            {why}
         </Owed>
      );
   }

   const openCount = [...byStage.values()].reduce((sum, l) => sum + l.length, 0) + unread;
   const target = targetOf(project);
   const due = target?.due_on?.slice(0, 10) ?? null;
   const missed = !!due && due < dayOf(new Date()) && openCount > 0;
   // a replan after the target passed answers it, as Decide counts it
   const replanned =
      !!plan && !!due && (plan.updated_at ?? 0) >= (dayStart(due) ?? 0) + DAY_MS / 1000;
   // a pace only means something when the range runs up to today
   const current = range.end >= dayOf(new Date());
   const finished = project?.state === 'closed' || (!!plan && !isUnderWay(plan.status));
   const forecast =
      live && !ongoing && !finished && current && flow
         ? // past a missed target, "after the target" goes without saying
           forecastOf(live, flow.window.days, missed ? null : target?.due_on ?? null)
         : null;
   const lastActivity = item?.lastActivity ?? null;
   const counted = PR_STAGES.filter(s => byStage.get(s)?.length);
   const counts = page?.counts;

   return (
      <>
         {/* who it is */}
         <div className="mb-5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
               <h2 className="m-0 text-lg font-semibold leading-snug">
                  {item?.name ?? project?.name ?? slug}
               </h2>
               {/* the plan says it when it's the same word */}
               {standing !== (plan ? PLAN_STATUS_WORD[plan.status] : null) && (
                  <span className="text-xs text-ink-3">{standing}</span>
               )}
               {people.length > 0 && (
                  <span className="flex items-center gap-3 text-xs text-ink-3 sm:ml-auto">
                     {devs.length > 0 && (
                        <span className="inline-flex items-center gap-1.5">
                           Developers <PeopleStack logins={devs} size={20} onPerson={onPerson} />
                        </span>
                     )}
                     {others.length > 0 && (
                        <span className="inline-flex items-center gap-1.5">
                           Non-developers{' '}
                           <PeopleStack logins={others} size={20} onPerson={onPerson} />
                        </span>
                     )}
                  </span>
               )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
               <span>{prefix + slug}</span>
               <ProjectFacts
                  g={{ slug }}
                  project={project}
                  prefix={prefix}
                  ongoing={ongoing}
                  links={{ navigate, nameOf, parts }}
                  onOngoing={markOngoing}
                  ongoingByLabel={byLabel}
                  inline
               />
            </div>
            {saveError && <p className="m-0 mt-1 text-xs text-warn">{saveError}</p>}
         </div>

         {/* what's owed on it, and where it stands */}
         <div className="mb-8 flex flex-col gap-4">
            {owed.length > 0 && (
               <dl className="m-0 grid grid-cols-[5.5rem_minmax(0,1fr)] items-start leading-5 sm:grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
                  {owed}
               </dl>
            )}
            {posting && plan && (
               <div className="relative rounded-xl border border-line bg-surface">
                  <button
                     type="button"
                     onClick={() => setPosting(false)}
                     className={`${linkClass} absolute right-3.5 top-2.5`}
                  >
                     Close
                  </button>
                  <UpdatesPanel item={plan} />
               </div>
            )}
            <dl className="m-0 grid grid-cols-[5.5rem_minmax(0,1fr)] items-start leading-5 sm:grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-[13px]">
               {update && (
                  <>
                     <dt className="text-xs leading-5 text-ink-3">Update</dt>
                     <dd className="m-0">
                        <span className="text-ink-2">
                           <button
                              type="button"
                              onClick={() => plan && navigate(openPlan(nav, plan.id))}
                              className={`${factClass} font-medium`}
                              title="Open its plan and every update on the roadmap"
                           >
                              {HEALTH_WORD[update.health]}
                           </button>
                           {' · '}
                           {when(update.at)} · {update.author}
                        </span>
                        {update.body && (
                           <p className="m-0 mt-1 whitespace-pre-line border-l-2 border-line pl-2.5 text-ink-2">
                              {update.body}
                           </p>
                        )}
                     </dd>
                  </>
               )}
               <dt className="text-xs leading-5 text-ink-3">Plan</dt>
               <dd className="m-0 text-ink-2">
                  {plan ? (
                     <button
                        type="button"
                        onClick={() => navigate(openPlan(nav, plan.id))}
                        className={factClass}
                        title="Open it on the roadmap"
                     >
                        {PLAN_STATUS_WORD[plan.status]}, {planWords(plan)}
                     </button>
                  ) : finished ? (
                     'Not on the roadmap'
                  ) : (
                     <>
                        Not on the roadmap{' · '}
                        <button
                           type="button"
                           // narrowed to it when the roadmap lists it (work in flight)
                           onClick={() =>
                              navigate({
                                 project: null,
                                 view: 'roadmap',
                                 item: null,
                                 find: live ? slug : '',
                              })
                           }
                           className={linkClass}
                        >
                           Plan it
                        </button>
                     </>
                  )}
               </dd>
               {/* when it's meant to finish, and when its pace says it will */}
               {(target || forecast) && (
                  <>
                     <dt className="text-xs leading-5 text-ink-3">Finish</dt>
                     <dd className="m-0 text-ink-2">
                        {target && (
                           <span
                              className={
                                 missed && !replanned && !decideSaid.length
                                    ? 'text-warn'
                                    : undefined
                              }
                           >
                              {upper(targetText(target, due, missed))}
                           </span>
                        )}
                        {target && forecast && ' · '}
                        {forecast && (
                           <span
                              // a late finish is amber only when Decide isn't asking already
                              className={
                                 forecast.late && !decideSaid.length ? 'text-warn' : undefined
                              }
                              title={forecast.title}
                           >
                              {target ? forecast.text : upper(forecast.text)}
                           </span>
                        )}
                     </dd>
                  </>
               )}
               <dt className="text-xs leading-5 text-ink-3">PRs</dt>
               <dd className="m-0 text-ink-2">
                  {page === undefined ? (
                     'Counting…'
                  ) : page === null ? (
                     'Couldn’t load them'
                  ) : (
                     <>
                        {/* where the open ones stand */}
                        <span className="block">
                           {openCount ? `${openCount} open: ` : 'None open'}
                           {counted.map((s, i) => (
                              <Fragment key={s}>
                                 {i > 0 && ' '}
                                 {/* its comma stays with it, so no line starts with one */}
                                 <span className="whitespace-nowrap">
                                    <CountList
                                       words={STAGE_WORDS[s].toLowerCase()}
                                       pulls={byStage.get(s) ?? []}
                                       opts={rowOpts}
                                    />
                                    {i < counted.length - 1 || unread > 0 ? ',' : ''}
                                 </span>
                              </Fragment>
                           ))}
                           {unread > 0 && ` ${unread} the board hasn’t read`}
                        </span>
                        {/* and how lately they moved */}
                        {mergedLately.length > 0 && (
                           // the dot stays with the count too
                           <span className="whitespace-nowrap">
                              <MergedList pulls={mergedLately} lastSeen={rowOpts.lastSeen} />
                              {lastActivity && ' ·'}
                           </span>
                        )}
                        {lastActivity && (
                           <>
                              {mergedLately.length > 0 ? ' last activity ' : 'Last activity '}
                              <a
                                 href={issueUrl(lastActivity.pr.repo, lastActivity.pr.number)}
                                 target="_blank"
                                 rel="noopener noreferrer"
                                 className="text-ink-2 hover:text-brand hover:underline"
                                 title={`#${lastActivity.pr.number} ${lastActivity.pr.title}`}
                              >
                                 {lastActivity.days === 0
                                    ? 'today'
                                    : `${n(lastActivity.days, 'day')} ago`}
                              </a>
                           </>
                        )}
                     </>
                  )}
               </dd>
               <dt className="text-xs leading-5 text-ink-3">Issues</dt>
               <dd className="m-0 text-ink-2">
                  {page === null ? (
                     'Couldn’t load them'
                  ) : !counts ? (
                     'Counting…'
                  ) : !counts.total ? (
                     'None yet'
                  ) : (
                     <>
                        <button
                           type="button"
                           onClick={() => jumpTo(null, 'project-issues')}
                           className={factClass}
                        >
                           {counts.open} of {n(counts.total, 'issue')} open
                        </button>
                        {counts.done > 0 && (
                           <>
                              {' · '}
                              <button
                                 type="button"
                                 onClick={() => jumpTo(`work:${slug}:done`, 'project-issues')}
                                 className={factClass}
                              >
                                 {counts.done} done
                              </button>
                           </>
                        )}
                        {counts.dropped > 0 && (
                           <>
                              {' · '}
                              <button
                                 type="button"
                                 onClick={() => jumpTo(`work:${slug}:dropped`, 'project-issues')}
                                 className={factClass}
                              >
                                 {counts.dropped} dropped
                              </button>
                           </>
                        )}
                     </>
                  )}
               </dd>
            </dl>
         </div>

         <ProjectWorkSections
            slug={slug}
            label={prefix + slug}
            plans={plans}
            page={page}
            pulls={pulls}
            opts={rowOpts}
            nameOf={s => nameOf(s) ?? s}
            navigate={navigate}
         />
         {w && (
            <section className="mb-7">
               <GroupHeader
                  title="In the date range"
                  // the picker names the range itself
                  sub={rangePicker ? undefined : rangeWords(range)}
                  headerExtra={rangePicker}
               />
               <StatsCard>
                  <WindowTiles w={w} prev={before} period={`${rangeDays(range)} days before`} />
               </StatsCard>
            </section>
         )}
         <section className="mb-7">
            <GroupHeader title="Is its backlog growing?" sub={rangeWords(chartWindow(range))} />
            <StatsCard>
               {flow === null ? (
                  <p className="m-0 text-[13px] text-ink-3">
                     Couldn’t load the chart. Try again in a minute.
                  </p>
               ) : (
                  <div className="flex flex-col gap-4">
                     <ChartSlot height={200}>
                        {flow && <OpenPrsChart days={flow.window.days} picked={range} />}
                     </ChartSlot>
                     <ChartSlot height={210}>
                        {flow && <FlowWeeksChart weeks={flow.window.weeks} picked={range} />}
                     </ChartSlot>
                  </div>
               )}
            </StatsCard>
         </section>
      </>
   );
}
