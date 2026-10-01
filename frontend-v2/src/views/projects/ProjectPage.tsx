import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { issueUrl } from '../../../../shared/format';
import { closedIssues, type DecideRow } from '../../../../shared/model/decide';
import {
   projectOf,
   targetOf,
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
import { issueKey } from '../../../../shared/model/work';
import type { PullData } from '../../../../shared/types';
import { EmptyState, LoadFailed } from '../../components/bits';
import { foldDomId, GroupHeader, openFold } from '../../components/Lane';
import type { RowOptions } from '../../components/Row';
import {
   chartWindow,
   dayOf,
   dayWords,
   rangeDays,
   rangeWords,
   refreshProjectsData,
   useProjectsData,
   type ProjectsData,
   type Range,
} from '../../model/projectData';
import { stageWord, type PortfolioItem } from '../../model/portfolio';
import { useProjectWork } from '../../model/projectWork';
import { setOngoing } from '../../model/settingsData';
import {
   addedLater,
   issueForecast,
   plannedAt,
   prStage,
   STAGE_WORDS,
   withBoardStates,
   type PrStage,
} from '../../model/stage';
import { days, LAST_14_DAYS, NO_PLAN, NO_UPDATE_YET, PLAN_IT, UPDATE_DUE } from '../../model/words';
import { StatsCard } from '../stats/parts';
import { DecideCall, reasonWords } from './Decide';
import { ChartSlot, FlowWeeksChart, OpenPrsChart } from './lazyCharts';
import {
   flagText,
   openPlan,
   PeopleStack,
   ProjectFacts,
   targetWords,
   versus,
   type Navigate,
   type ProjectsNav,
} from './parts';
import { PLAN_STATUS_WORD, planWords, UpdatesPanel, when } from './roadmapHealth';
import { ProjectWorkSections, showPulls, type PullLookup } from './Work';

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

/** the order a project's open PRs are counted in: nearest to shipping first */
const PR_STAGES: readonly PrStage[] = ['ready', 'hold', 'review', 'work'];

/** Something someone owes on this project, as a row of the summary: the
 * word in amber, then the why, and the way to do it right after it; what
 * the way opens (a form) goes under the row, full width. */
function Owed({
   word,
   children,
   action,
   after,
   settled = false,
   id,
   afterFull = false,
}: {
   word: string;
   children: ReactNode;
   action?: ReactNode;
   after?: ReactNode;
   /** answered this visit: the word goes ink, the receipt stays */
   settled?: boolean;
   /** for what reads the sentence with its answer */
   id?: string;
   /** `after` takes the whole width (a form), not just the words' column */
   afterFull?: boolean;
}) {
   return (
      <>
         <dt className={`font-medium ${settled ? 'text-ink-2' : 'text-warn'}`}>{word}</dt>
         <dd id={id} className="m-0 text-ink-2">
            {children}
            {action && <> {action}</>}
         </dd>
         {/* under its own words, not under the label, unless it's a form */}
         {after && <dd className={`m-0 ${afterFull ? 'col-span-2' : 'col-start-2'}`}>{after}</dd>}
      </>
   );
}

/** the way to do something: brand, like every action on the board */
const linkClass =
   'hit pressable rounded border-0 bg-transparent p-0 text-left text-[13px] font-medium text-brand hover:underline';
/** a fact that goes somewhere when clicked: ink, with a quiet underline so
 * it doesn't read as plain text */
const factBase =
   'hit pressable rounded border-0 bg-transparent p-0 text-left text-[13px] underline decoration-line underline-offset-2 hover:text-brand';
const factClass = `${factBase} text-ink-2`;

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

/** Open a fold below (or a section), bring it into view, and put focus on
 * its band, so the keyboard carries on from there. */
function jumpTo(foldId: string | null, sectionId: string) {
   if (foldId) openFold(foldId);
   // after the fold opens, so its height is in place
   requestAnimationFrame(() => {
      const el = document.getElementById(foldId ? foldDomId(foldId) : sectionId);
      el?.scrollIntoView({ block: 'start' });
      el?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
   });
}

/**
 * The range's numbers in a sentence under the chart, saying what the chart
 * can't: the same number of days before (once they've loaded), the PRs
 * closed without merging, and the medians. Tiles that couldn't open
 * anything, half of them restating the chart, used to say this.
 */
function rangeSentence(w: WindowCounts, prev: WindowCounts | undefined, range: Range): string {
   const count = (k: number, word: string) => `${k || 'none'} ${word}`;
   // the first comparison says against what; the second, only how far
   const first = prev
      ? ` (${versus(w.opened, prev.opened, `${rangeDays(range)} days before`) ?? ''})`
      : '';
   const d = prev ? w.merged - prev.merged : 0;
   const second = prev ? ` (${d > 0 ? `${d} more` : d < 0 ? `${-d} fewer` : 'the same'})` : '';
   const parts = [
      `${rangeWords(range)}: ${count(w.opened, 'opened')}${first}, ${count(
         w.merged,
         'merged'
      )}${second} and ${count(w.closed, 'closed without merging')}`,
   ];
   if (w.median_days_to_merge != null) {
      parts.push(`a merge took a median of ${days(w.median_days_to_merge)}`);
   }
   if (w.median_age_end_days != null) {
      parts.push(
         w.median_age_start_days != null
            ? `the open PRs’ median age went from ${w.median_age_start_days} to ${days(
                 w.median_age_end_days
              )}`
            : `the open PRs’ median age ended at ${days(w.median_age_end_days)}`
      );
   }
   return `${parts.join('; ')}.`;
}

/**
 * One project's page, read top to bottom: who it is, then what's owed on
 * it and where it stands (its latest update, its plan and finish, its PRs
 * by where they stand, its issues), then its issues by stage, its PRs that
 * do none of them, the issues its PRs link that aren't in it, and its
 * backlog chart with the date range's numbers. The issue holds the name,
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
   calls,
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
   /** open People with a person picked */
   onPerson: (login: string) => void;
   /** Decide's rows about this project */
   asks: DecideRow[];
   /** the same with this visit's calls kept, for Decide's strip and its
    * receipt and Undo */
   calls: DecideRow[];
   /** the date range's picker, beside the numbers it sets */
   rangePicker?: ReactNode;
}) {
   // the box flips at once; a failed save puts it back and says why
   const [want, setWant] = useState<boolean | null>(null);
   const [saveError, setSaveError] = useState<{ error: string; on: boolean } | null>(null);
   const [posting, setPosting] = useState(false);
   // what the page just did, for a screen reader
   const [said, setSaid] = useState('');
   const healthRef = useRef<HTMLButtonElement>(null);
   // a posted update is the plan's new latest one: the form's job is done
   const latestAt = (plans ? planFor(slug, plans) : null)?.update?.at ?? null;
   const formFrom = useRef(latestAt);
   useEffect(() => {
      if (posting && latestAt !== formFrom.current) {
         setPosting(false);
         // the form goes from under the focus: it lands on the update just
         // posted, and a screen reader hears it went
         healthRef.current?.focus();
         setSaid('Update posted.');
      }
      formFrom.current = latestAt;
   }, [latestAt, posting]);
   // the chart's days (fetched once, cached)
   const flow = useProjectsData(chartWindow(range), slug);
   // its issues and PRs, which the summary counts and the list shows
   const work = useProjectWork(slug, plans);
   // its rows are on this project's page, so their popover doesn't link here
   const rowOpts = useMemo(() => ({ ...opts, onProject: undefined }), [opts]);
   const live = today.live.find(g => g.slug === slug);
   const group = live ?? today.quiet.find(g => g.slug === slug);
   const project = group?.project ?? data?.projects.find(p => p.slug === slug) ?? null;
   const name = item?.name ?? project?.name ?? slug;
   // the browser's tab names the project while its page is open
   useEffect(() => {
      const was = document.title;
      document.title = `${name} · Pulldasher`;
      return () => {
         document.title = was;
      };
   }, [name]);
   // a closed project isn't on Today, so read its recent merges straight off
   // the closed pulls (the server keeps 14 days of them)
   const merged =
      group?.merged ?? closed.filter(p => p.merged_at && projectOf(p.labels, prefix) === slug);
   const w: ProjectWindow | undefined = data?.window.projects[slug];
   // the same days just before, once they load; none to compare with if
   // they couldn't
   const before = prev ? prev.window.projects[slug] ?? ZERO : undefined;
   if (!group && !project && !w && !merged.length) {
      return data === undefined ? (
         <p className="text-[13px] text-ink-3">Loading the project…</p>
      ) : (
         <EmptyState
            variant="search"
            title="No project by that name"
            sub={`No issue or PR (open, merged in the ${LAST_14_DAYS}, or in the date range) carries the ${prefix}${slug} label.`}
         />
      );
   }
   const plan = plans ? planFor(slug, plans) : null;
   // scope attached after this is scope added along the way
   const planned = plan ? plannedAt(plan) : null;
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
         setSaveError({ error: r.error, on });
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
   // when its issue says it's finished, for the PRs that opened after
   const closedIssue = closedIssues(project ? [project] : []).get(slug) ?? null;

   // its PRs by where they stand, from the same list the page shows, each
   // by the key that finds it below
   const onPage = new Map(
      [...(page?.issues.flatMap(i => i.prs) ?? []), ...(page?.unlinked ?? [])].map(pr => [
         issueKey(pr),
         pr,
      ])
   );
   const byStage = new Map<PrStage, string[]>(PR_STAGES.map(s => [s, []]));
   const unread: string[] = [];
   const mergedLately: string[] = [];
   for (const [key, pr] of onPage) {
      const p = pulls.live(pr);
      if (p) byStage.get(prStage(p))?.push(key);
      else if (pr.state === 'open') unread.push(key);
      else if (pulls.known(pr)?.merged_at) mergedLately.push(key);
   }
   // a PR that does an issue sits under it below; the rest sit apart, under
   // "PRs with no issue here" (with no issues at all, every one does)
   const onIssue = new Set(page?.issues.flatMap(i => i.prs.map(issueKey)) ?? []);
   const looseOf = (keys: string[]) =>
      page?.issues.length ? keys.filter(k => !onIssue.has(k)).length : 0;
   /** Where some PRs are, when that isn't under their issues. */
   const whereWords = (keys: string[]) => {
      const loose = looseOf(keys);
      return !loose
         ? ''
         : loose < keys.length
         ? `, ${loose} not linked to its issues`
         : keys.length === 1
         ? ', not linked to its issues'
         : ', none linked to its issues';
   };
   /** A count of PRs that brings them into view below, saying where they
    * are when the bands of issues don't hold them all. `where` false when
    * a line already said it for every count on it. */
   const pullCount = (keys: string[], words: string, where = true) => {
      return (
         <button
            type="button"
            onClick={() => page && showPulls(slug, page, pulls.live, new Set(keys))}
            className={`${factClass} tabular-nums`}
         >
            {keys.length} {words}
            {where && whereWords(keys)}
         </button>
      );
   };
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
   // at risk or off track asks the planner for a call: amber while the plan
   // hasn't answered it, unless "Decide asks" says it already (one call,
   // one mark)
   const healthOwed =
      !!update &&
      update.health !== 'on_track' &&
      update.at > (plan?.updated_at ?? 0) &&
      !asks.some(row => row.reasons.some(r => r.kind === update.health));
   const owed: ReactNode[] = [];
   // Decide's call, made right here with Decide's own strip; once made it
   // stays as a receipt with Undo, in ink, until it's asked again
   if (calls.length) {
      owed.push(
         <Owed
            key="decide"
            id="project-decide-why"
            word={decideSaid.length ? 'Decide asks' : 'Decided'}
            settled={!decideSaid.length}
            after={
               <div className="flex flex-col gap-2">
                  {calls.map(row => (
                     <DecideCall
                        key={`${row.slug ?? ''}:${row.item?.id ?? ''}`}
                        row={row}
                        project={item}
                        describedBy="project-decide-why"
                     />
                  ))}
               </div>
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
            word={planHealth.kind === 'missing' ? NO_UPDATE_YET : UPDATE_DUE}
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
            // the form opens under the line that asks for it; its toggle
            // above is the way to close it
            afterFull
            after={
               posting && (
                  <div className="overflow-hidden rounded-xl border border-line bg-surface">
                     <UpdatesPanel item={plan} bare autoFocus />
                  </div>
               )
            }
         >
            {planHealth.kind === 'stale'
               ? `The last one was ${days(planHealth.days)} ago; one is due every ${days(
                    UPDATE_DUE_DAYS
                 )}.`
               : `None since it started; one is due every ${days(UPDATE_DUE_DAYS)}.`}
         </Owed>
      );
   }
   for (const flag of group?.flags ?? []) {
      const [word, why] = flagText(flag, group as ProjectGroup);
      const lone = group?.people[0];
      const action =
         flag === 'one_person' && lone ? (
            <button type="button" onClick={() => onPerson(lone)} className={linkClass}>
               See {lone} in People
            </button>
         ) : flag === 'waiting_on_review' ? (
            pullCount(byStage.get('review') ?? [], 'waiting on review')
         ) : undefined;
      owed.push(
         <Owed key={flag} word={upper(word)} action={action}>
            {why}
         </Owed>
      );
   }

   const openCount = [...byStage.values()].reduce((sum, l) => sum + l.length, 0) + unread.length;
   const target = targetOf(project);
   const due = target?.due_on?.slice(0, 10) ?? null;
   const missed = !!due && due < dayOf(new Date()) && openCount > 0;
   const finished = project?.state === 'closed' || (!!plan && !isUnderWay(plan.status));
   // a rough finish from its issues closed and added lately; with no issues
   // there's nothing honest to run a pace on, so the target stands alone.
   // Past a missed target, "after the target" goes without saying.
   const forecast =
      !ongoing && !finished && page?.issues.length
         ? issueForecast(page.issues, missed ? null : due)
         : null;
   const lastActivity = item?.lastActivity ?? null;
   const counts = page?.counts;
   const added = page ? page.issues.filter(i => addedLater(i, planned)).length : 0;
   const stageCounts: [string, string[]][] = [
      ...PR_STAGES.filter(s => byStage.get(s)?.length).map((s): [string, string[]] => [
         STAGE_WORDS[s].toLowerCase(),
         byStage.get(s) ?? [],
      ]),
      ...(unread.length ? [['the board hasn’t read', unread] as [string, string[]]] : []),
   ];
   // when none of the open ones is under an issue, the line says so once
   const openKeys = stageCounts.flatMap(([, keys]) => keys);
   const allLoose = openKeys.length > 0 && looseOf(openKeys) === openKeys.length;
   const activityWords =
      lastActivity && (lastActivity.days === 0 ? 'today' : `${days(lastActivity.days)} ago`);

   return (
      <>
         <p role="status" aria-live="polite" className="sr-only">
            {said}
         </p>
         {/* who it is */}
         <div className="mb-5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
               <h2 className="m-0 text-lg font-semibold leading-snug">{name}</h2>
               {/* the plan says it when it's the same word */}
               {standing !== (plan ? PLAN_STATUS_WORD[plan.status] : null) && (
                  <span className="text-xs text-ink-3">{standing}</span>
               )}
               {people.length > 0 && (
                  <span className="flex items-center gap-3 text-xs text-ink-3 sm:ml-auto">
                     {devs.length > 0 && (
                        <span className="inline-flex items-center gap-1.5">
                           Developers{' '}
                           <PeopleStack logins={devs} size={20} onPerson={onPerson} me={opts.me} />
                        </span>
                     )}
                     {others.length > 0 && (
                        <span className="inline-flex items-center gap-1.5">
                           Non-developers{' '}
                           <PeopleStack
                              logins={others}
                              size={20}
                              onPerson={onPerson}
                              me={opts.me}
                           />
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
            {saveError && (
               // ink: a failed save is nobody's debt
               <p className="m-0 mt-1 text-xs text-ink-2">
                  {saveError.error}{' '}
                  <button
                     type="button"
                     onClick={() => markOngoing(saveError.on)}
                     className="hit pressable rounded border-0 bg-transparent p-0 text-xs font-medium text-brand hover:underline"
                  >
                     Try again
                  </button>
               </p>
            )}
         </div>

         {/* what's owed on it, then where it stands, in one list whose
             labels line up: the column grows to fit a long amber word */}
         <dl className="m-0 mb-8 grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2.5 text-[13px] leading-5 sm:grid-cols-[minmax(7rem,max-content)_minmax(0,1fr)]">
            {owed}
            {update && (
               <>
                  <dt className="text-xs leading-5 text-ink-3">Update</dt>
                  <dd className="m-0 text-ink-2">
                     <button
                        ref={healthRef}
                        type="button"
                        onClick={() => plan && navigate(openPlan(nav, plan.id))}
                        className={`${factBase} font-medium ${
                           healthOwed ? 'text-warn' : 'text-ink-2'
                        }`}
                        title="Open its plan and every update on the roadmap"
                     >
                        {HEALTH_WORD[update.health]}
                     </button>
                     {' · '}
                     {when(update.at)} · {update.author}
                     {/* drawn as the updates panel draws its history */}
                     {update.body && (
                        <p className="m-0 mt-0.5 whitespace-pre-line">{update.body}</p>
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
               ) : (
                  <>
                     {NO_PLAN}
                     {/* while Decide asks, its call is the way to plan it */}
                     {!finished && !decideSaid.length && (
                        <>
                           {' · '}
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
                              {PLAN_IT}
                           </button>
                        </>
                     )}
                  </>
               )}
            </dd>
            {/* when it's meant to finish, and when its issues say it will;
                facts, so ink, whatever they say */}
            {(target || forecast) && (
               <>
                  <dt className="text-xs leading-5 text-ink-3">Finish</dt>
                  <dd className="m-0 text-ink-2">
                     {target && upper(targetText(target, due, missed))}
                     {target && forecast && ' · '}
                     {forecast && (
                        <span title={forecast.title}>
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
                     {/* where the open ones stand, each count a way to them */}
                     <span className="block">
                        {openCount
                           ? `${openCount} open${allLoose ? whereWords(openKeys) : ''}: `
                           : 'None open'}
                        {stageCounts.map(([words, keys], i) => (
                           <Fragment key={words}>
                              {i > 0 && ' · '}
                              {pullCount(keys, words, !allLoose)}
                           </Fragment>
                        ))}
                     </span>
                     {/* and how lately they moved */}
                     {(mergedLately.length > 0 || lastActivity) && (
                        <span className="block">
                           {mergedLately.length > 0 &&
                              pullCount(mergedLately, `merged in the ${LAST_14_DAYS}`)}
                           {mergedLately.length > 0 && lastActivity && ' · '}
                           {lastActivity && (
                              <>
                                 {mergedLately.length > 0 ? 'last activity ' : 'Last activity '}
                                 <a
                                    href={issueUrl(lastActivity.pr.repo, lastActivity.pr.number)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-ink-2 underline decoration-line underline-offset-2 hover:text-brand"
                                    // what it opens, not only when
                                    aria-label={`${activityWords}, on PR #${lastActivity.pr.number} ${lastActivity.pr.title}`}
                                    title={`#${lastActivity.pr.number} ${lastActivity.pr.title}`}
                                 >
                                    {activityWords}
                                 </a>
                              </>
                           )}
                        </span>
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
                        className={`${factClass} tabular-nums`}
                     >
                        {counts.open ? `${counts.open} open` : 'None open'}
                     </button>
                     {counts.done > 0 && (
                        <>
                           {' · '}
                           <button
                              type="button"
                              onClick={() => jumpTo(`work:${slug}:done`, 'project-issues')}
                              className={`${factClass} tabular-nums`}
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
                              className={`${factClass} tabular-nums`}
                           >
                              {counts.dropped} dropped
                           </button>
                        </>
                     )}
                     {/* scope that grew along the way; each one's line says when */}
                     {added > 0 && (
                        <span className="tabular-nums"> · {added} added since it was planned</span>
                     )}
                  </>
               )}
            </dd>
         </dl>

         <ProjectWorkSections
            slug={slug}
            label={prefix + slug}
            plans={plans}
            planned={planned}
            closed={closedIssue}
            page={page}
            pulls={pulls}
            opts={rowOpts}
            nameOf={s => nameOf(s) ?? s}
            navigate={navigate}
         />
         <section className="mb-7">
            <GroupHeader
               level={3}
               title="Is its backlog growing?"
               sub={rangeWords(chartWindow(range))}
               // the range sets the pale days before it and the sentence under it
               headerExtra={rangePicker}
            />
            <StatsCard>
               {flow === null ? (
                  <LoadFailed what="the chart" onRetry={refreshProjectsData} />
               ) : (
                  <div className="flex flex-col gap-4">
                     <ChartSlot height={200}>
                        {flow && <OpenPrsChart days={flow.window.days} picked={range} />}
                     </ChartSlot>
                     <ChartSlot height={210}>
                        {flow && (
                           <FlowWeeksChart
                              weeks={flow.window.weeks}
                              picked={range}
                              shown={flow.window}
                           />
                        )}
                     </ChartSlot>
                     {w && (
                        <p className="m-0 text-[13px] text-ink-2">
                           {rangeSentence(w, before, range)}
                        </p>
                     )}
                  </div>
               )}
            </StatsCard>
         </section>
      </>
   );
}
