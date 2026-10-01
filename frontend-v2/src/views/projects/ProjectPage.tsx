import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { n } from '../../../../shared/format';
import { closedIssues, RANK, type DecideRow } from '../../../../shared/model/decide';
import {
   projectOf,
   targetOf,
   type ProjectGroup,
   type ProjectWindow,
   type Today,
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
import { EmptyState, FactLink, LoadFailed, TextButton } from '../../components/bits';
import { foldDomId, openFold, SubDoor } from '../../components/Lane';
import type { RowOptions } from '../../components/Row';
import { dayOf, dayWords, type ProjectsData, type Range } from '../../model/projectData';
import { stageWord, type PortfolioItem } from '../../model/portfolio';
import { reloadProjectWork, useProjectWork } from '../../model/projectWork';
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
import {
   BEING_WORKED_ON,
   days,
   LAST_14_DAYS,
   NO_PLAN,
   NO_UPDATE_YET,
   PLAN_IT,
   UPDATE_DUE,
} from '../../model/words';
import { DecideCall, reasonParts } from './Decide';
import { BacklogSection } from './BacklogSection';
import {
   flagText,
   openPlan,
   PeopleStack,
   ProjectFacts,
   targetWords,
   type Navigate,
   type ProjectsNav,
} from './parts';
import { PLAN_STATUS_WORD, planWords, UpdatesPanel, when } from './roadmapHealth';
import { ProjectWorkSections, showPulls, type PullLookup } from './Work';

/** words that start a line, with a capital */
const upper = (s: string) => s[0].toUpperCase() + s.slice(1);

/** a day that never breaks across two lines ("Sep 26", not "Sep" then "26") */
const unbroken = (s: string) => s.replace(/ /g, '\u00a0');

/** the order a project's open PRs are counted in: nearest to shipping first */
const PR_STAGES: readonly PrStage[] = ['ready', 'hold', 'review', 'work'];

/** the latest update's health word, where the focus lands after posting one */
const HEALTH_ID = 'project-update-health';

/** Something someone owes on this project, as a row of the summary: the
 * word in amber, then the why, and the way to do it right after it; what
 * the way opens (a form) goes under the row, full width. */
function Owed({
   word,
   children,
   action,
   after,
}: {
   word: string;
   children: ReactNode;
   action?: ReactNode;
   /** a form the action opens: under the row, the whole width */
   after?: ReactNode;
}) {
   return (
      <>
         <dt className="font-medium text-warn">{word}</dt>
         <dd className="m-0 max-w-[70ch] text-ink-2">
            {children}
            {action && <> {action}</>}
         </dd>
         {after && <dd className="col-span-2 m-0">{after}</dd>}
      </>
   );
}

/** Counts in a line, a dot after each but the last, kept with its count so
 * a narrow line never wraps to a lone dot. */
function Counts({ children }: { children: ReactNode[] }) {
   const shown = children.filter(Boolean);
   return (
      <>
         {shown.map((child, i) => (
            <Fragment key={i}>
               <span className="whitespace-nowrap">
                  {child}
                  {i < shown.length - 1 && ' ·'}
               </span>
               {i < shown.length - 1 && ' '}
            </Fragment>
         ))}
      </>
   );
}

/** A target in the plan's words: its name when it has one, and its day. */
function targetText(
   target: NonNullable<ReturnType<typeof targetOf>>,
   due: string | null,
   missed: boolean
): string {
   if (!due) return `target ${targetWords(target)}`;
   const day = unbroken(dayWords(due));
   const name = target.title && target.title !== dayWords(due) ? target.title : null;
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
   // a posted update is the plan's new latest one: the form's job is done
   const latestAt = (plans ? planFor(slug, plans) : null)?.update?.at ?? null;
   const formFrom = useRef(latestAt);
   const posted = useRef(false);
   useEffect(() => {
      if (posting && latestAt !== formFrom.current) {
         setPosting(false);
         posted.current = true;
         setSaid('Update posted.');
      } else if (!posting && posted.current) {
         // the form went from under the focus: it lands on the update just
         // posted, once its row is back, and a screen reader hears it went
         posted.current = false;
         document.getElementById(HEALTH_ID)?.focus();
      }
      formFrom.current = latestAt;
   }, [latestAt, posting]);
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
   // where it stands, said once, in the head, in the list's words: "In
   // progress" is only ever a plan's, so PRs moving lately are "being
   // worked on"
   const standing = item
      ? stageWord(item)
      : live
      ? upper(BEING_WORKED_ON)
      : project?.state === 'closed'
      ? project.state_reason === 'not_planned'
         ? 'Dropped'
         : 'Done'
      : 'Quiet';
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
   // one way to say it's ongoing on the page at a time: Decide's own call
   // while its strip offers it, or its receipt stands (Decide.tsx CallStrip
   // offers it to new work and to finished work that goes on), else the
   // head's box
   const decideOffersOngoing = calls.some(
      row =>
         !!row.slug &&
         row.reasons.some(r => r.kind === 'new' || (r.kind === 'reopened' && r.by === 'roadmap'))
   );
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
   /** Bring PRs into view below, flashing them, and say how many. */
   const show = (keys: string[]) => {
      if (!page) return;
      showPulls(slug, page, pulls.live, new Set(keys));
      setSaid(`${n(keys.length, 'PR')} shown below.`);
   };
   /** A count of PRs that brings them into view below. */
   const pullCount = (keys: string[], words: string) => (
      <FactLink onClick={() => show(keys)} className="tabular-nums">
         {keys.length} {words}
      </FactLink>
   );
   // what's owed on it: Decide's question, an update its lead owes, and the
   // flags the board raises, each in amber with the way to answer it
   const planHealth = plan && isUnderWay(plan.status) ? healthStanding(plan) : null;
   const update =
      planHealth?.kind === 'current' || planHealth?.kind === 'stale' ? planHealth.update : null;
   // a reason that quotes the latest update leaves the quote to the Update
   // row below, which shows it whole
   const quoteless = (row: DecideRow) =>
      row.item?.update && update && row.item.update.at === update.at
         ? { ...row.item, update: { ...row.item.update, body: '' } }
         : row.item;
   // each row asks one question, its worst reason's (the one its strip
   // outlines the answer to), after the facts of all of them
   const asked = asks.map(row => {
      const primary = row.reasons.reduce((a, r) => (RANK[r.kind] < RANK[a.kind] ? r : a));
      const sentences = [primary, ...row.reasons.filter(r => r !== primary)].map(r =>
         reasonParts(r, quoteless(row))
      );
      return {
         key: `${row.slug ?? ''}:${row.item?.id ?? ''}`,
         name: asks.length > 1 && row.item ? `${row.item.name}: ` : '',
         facts: sentences.map(s => s.facts).join(' '),
         question: sentences[0].question,
      };
   });
   // at risk or off track asks the planner for a call: amber while the plan
   // hasn't answered it, unless "Decide asks" says it already (one call,
   // one mark)
   const healthOwed =
      !!update &&
      update.health !== 'on_track' &&
      update.at > (plan?.updated_at ?? 0) &&
      !asks.some(row => row.reasons.some(r => r.kind === update.health));
   const decideCalls = calls.map(row => (
      <DecideCall
         key={`${row.slug ?? ''}:${row.item?.id ?? ''}`}
         row={row}
         project={item}
         describedBy="project-decide-why"
      />
   ));
   const owed: ReactNode[] = [];
   // Decide's call, made right here with Decide's own strip: the label is
   // ink and the question its one amber mark, as on Decide; once made, the
   // call stays as a receipt with Undo, on the label's line, level with it
   // (a receipt sits in a strip's height). The strip keeps its place in the
   // list either way, so the focus a call moves to Undo stays there.
   if (calls.length) {
      owed.push(
         <Fragment key="decide">
            <dt
               className={`font-medium text-ink-2 ${
                  asked.length ? '' : 'mt-1.5 flex min-h-[30px] items-center'
               }`}
            >
               {asked.length ? 'Decide asks' : 'Decided'}
            </dt>
            {asked.length > 0 && (
               <dd key="why" id="project-decide-why" className="m-0 max-w-[70ch] text-ink-2">
                  {asked.map(({ key, name, facts, question }, i) => (
                     <Fragment key={key}>
                        {i > 0 && ' '}
                        {name}
                        {facts} <span className="whitespace-nowrap text-warn">{question}</span>
                     </Fragment>
                  ))}
               </dd>
            )}
            <dd key="calls" className="col-start-2 m-0 flex flex-col gap-2">
               {decideCalls}
            </dd>
         </Fragment>
      );
   }
   if (plan && (planHealth?.kind === 'missing' || planHealth?.kind === 'stale')) {
      owed.push(
         <Owed
            key="update"
            word={planHealth.kind === 'missing' ? NO_UPDATE_YET : UPDATE_DUE}
            action={
               <TextButton
                  tone={posting ? 'quiet' : 'action'}
                  onClick={() => setPosting(!posting)}
                  aria-expanded={posting}
               >
                  {posting ? 'Close' : 'Post an update'}
               </TextButton>
            }
            // the form opens under the line that asks for it; its toggle
            // above is the way to close it
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
      const [word] = flagText(flag, group as ProjectGroup);
      const lone = group?.people[0];
      // the counts behind each flag, never its threshold
      owed.push(
         flag === 'one_person' && group && lone ? (
            <Owed
               key={flag}
               word={upper(word)}
               action={<TextButton onClick={() => onPerson(lone)}>See {lone} in People</TextButton>}
            >
               Its {group.open.length + group.merged.length} PRs open or merged in the{' '}
               {LAST_14_DAYS} are all by {lone}.
            </Owed>
         ) : (
            <Owed key={flag} word={upper(word)}>
               {group &&
                  pullCount(
                     group.open.map(p => issueKey(p.data)),
                     group.open.length === 1 ? 'open PR' : 'open PRs'
                  )}
            </Owed>
         )
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
   // the open ones that do none of its issues sit apart, under "PRs with no
   // issue here" (with no issues at all, every PR is "its PRs": none apart)
   const onIssue = new Set(page?.issues.flatMap(i => i.prs.map(issueKey)) ?? []);
   const loose = page?.issues.length
      ? [...[...byStage.values()].flat(), ...unread].filter(k => !onIssue.has(k))
      : [];
   const activityWords =
      lastActivity && (lastActivity.days === 0 ? 'today' : `${days(lastActivity.days)} ago`);
   const activityKey = lastActivity && issueKey(lastActivity.pr);

   return (
      <>
         <p role="status" aria-live="polite" className="sr-only">
            {said}
         </p>
         {/* who it is */}
         <div className="mb-5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
               <h2 className="m-0 text-lg font-semibold leading-snug">{name}</h2>
               <span className="text-xs text-ink-3">{standing}</span>
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
                  onOngoing={decideOffersOngoing ? undefined : markOngoing}
                  ongoingByLabel={byLabel}
                  inline
               />
            </div>
            {saveError && (
               // ink: a failed save is nobody's debt
               <p className="m-0 mt-1 text-xs text-ink-2">
                  {saveError.error}{' '}
                  <TextButton onClick={() => markOngoing(saveError.on)}>Try again</TextButton>
               </p>
            )}
         </div>

         {/* what's owed on it, then where it stands, in one list whose
             labels line up: the column grows to fit a long amber word */}
         <dl className="m-0 mb-8 grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2.5 text-[13px] leading-5 sm:grid-cols-[minmax(7rem,max-content)_minmax(0,1fr)]">
            {owed}
            {/* while the form is open, its list of updates shows this one first */}
            {update && !posting && (
               <>
                  <dt className="text-xs leading-5 text-ink-3">Update</dt>
                  <dd className="m-0 text-ink-2">
                     <FactLink
                        id={HEALTH_ID}
                        onClick={() => plan && navigate(openPlan(nav, plan.id))}
                        className="font-medium"
                        title="Open its plan and every update on the roadmap"
                     >
                        <span className={healthOwed ? 'text-warn' : undefined}>
                           {HEALTH_WORD[update.health]}
                        </span>
                     </FactLink>
                     {' · '}
                     {when(update.at)} · {update.author}
                     {/* drawn as the updates panel draws its history */}
                     {update.body && (
                        <p className="m-0 mt-0.5 max-w-[70ch] whitespace-pre-line">{update.body}</p>
                     )}
                  </dd>
               </>
            )}
            <dt className="text-xs leading-5 text-ink-3">Plan</dt>
            <dd className="m-0 text-ink-2">
               {plan ? (
                  <FactLink
                     onClick={() => navigate(openPlan(nav, plan.id))}
                     title="Open it on the roadmap"
                  >
                     {/* the head says its status when it's the same word */}
                     {PLAN_STATUS_WORD[plan.status] === standing
                        ? upper(planWords(plan))
                        : `${PLAN_STATUS_WORD[plan.status]}, ${planWords(plan)}`}
                  </FactLink>
               ) : (
                  <>
                     {NO_PLAN}
                     {/* while Decide asks, its call is the way to plan it */}
                     {!finished && !asked.length && (
                        <>
                           {' · '}
                           <TextButton
                              // narrowed to it when the roadmap lists it (work in flight)
                              onClick={() =>
                                 navigate({
                                    project: null,
                                    view: 'roadmap',
                                    item: null,
                                    find: live ? slug : '',
                                 })
                              }
                           >
                              {PLAN_IT}
                           </TextButton>
                        </>
                     )}
                  </>
               )}
            </dd>
            {/* when it's meant to finish, and when its issues say it will;
                facts, so ink, whatever they say. How the forecast is worked
                out is behind its words, as a sub-line's story is. */}
            {(target || forecast) && (
               <>
                  <dt className="text-xs leading-5 text-ink-3">Finish</dt>
                  <dd className="m-0 text-ink-2">
                     {target && upper(targetText(target, due, missed))}
                     {target && forecast && ' · '}
                     {forecast && (
                        <SubDoor
                           label="How the finish is worked out"
                           text={target ? forecast.text : upper(forecast.text)}
                        >
                           <p className="m-0">{forecast.how}</p>
                        </SubDoor>
                     )}
                  </dd>
               </>
            )}
            <dt className="text-xs leading-5 text-ink-3">PRs</dt>
            <dd className="m-0 text-ink-2">
               {page === undefined ? (
                  'Counting…'
               ) : page === null ? (
                  <LoadFailed what="its PRs" onRetry={reloadProjectWork} />
               ) : (
                  <>
                     {/* where the open ones stand, each count a way to them */}
                     <span className="block">
                        {openCount ? `${openCount} open: ` : 'None open'}
                        <Counts>
                           {stageCounts.map(([words, keys]) => (
                              <Fragment key={words}>{pullCount(keys, words)}</Fragment>
                           ))}
                        </Counts>
                     </span>
                     {/* the open ones that do none of its issues, apart below */}
                     {loose.length > 0 && (
                        <span className="block">
                           {pullCount(
                              loose,
                              `of them ${loose.length === 1 ? 'has' : 'have'} no issue here`
                           )}
                        </span>
                     )}
                     {/* and how lately they moved */}
                     {(mergedLately.length > 0 || lastActivity) && (
                        <span className="block">
                           <Counts>
                              {[
                                 mergedLately.length > 0 && (
                                    <Fragment key="merged">
                                       {pullCount(mergedLately, `merged in the ${LAST_14_DAYS}`)}
                                    </Fragment>
                                 ),
                                 lastActivity && (
                                    <Fragment key="activity">
                                       {mergedLately.length > 0
                                          ? 'last activity '
                                          : 'Last activity '}
                                       {activityKey && onPage.has(activityKey) ? (
                                          // to its PR below, like the counts
                                          <FactLink
                                             onClick={() => show([activityKey])}
                                             aria-label={`${activityWords}, on PR #${lastActivity.pr.number} ${lastActivity.pr.title}`}
                                          >
                                             {activityWords}
                                          </FactLink>
                                       ) : (
                                          activityWords
                                       )}
                                    </Fragment>
                                 ),
                              ]}
                           </Counts>
                        </span>
                     )}
                  </>
               )}
            </dd>
            <dt className="text-xs leading-5 text-ink-3">Issues</dt>
            <dd className="m-0 text-ink-2">
               {page === null ? (
                  <LoadFailed what="its issues" onRetry={reloadProjectWork} />
               ) : !counts ? (
                  'Counting…'
               ) : !counts.total ? (
                  'None yet'
               ) : (
                  <Counts>
                     {[
                        <FactLink
                           key="open"
                           onClick={() => jumpTo(null, 'project-issues')}
                           className="tabular-nums"
                        >
                           {counts.open ? `${counts.open} open` : 'None open'}
                        </FactLink>,
                        counts.done > 0 && (
                           <FactLink
                              key="done"
                              onClick={() => jumpTo(`work:${slug}:done`, 'project-issues')}
                              className="tabular-nums"
                           >
                              {counts.done} done
                           </FactLink>
                        ),
                        counts.dropped > 0 && (
                           <FactLink
                              key="dropped"
                              onClick={() => jumpTo(`work:${slug}:dropped`, 'project-issues')}
                              className="tabular-nums"
                           >
                              {counts.dropped} dropped
                           </FactLink>
                        ),
                        // scope that grew along the way; each one's line says when
                        added > 0 && (
                           <span key="added" className="tabular-nums">
                              {added} added since it was planned
                           </span>
                        ),
                     ]}
                  </Counts>
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
         <div className="mb-7">
            {/* the same section Look back shows, scoped to this project; the
                range sets the pale days before it and the sentence under it */}
            <BacklogSection
               range={range}
               slug={slug}
               title="Is its backlog growing?"
               headerExtra={rangePicker}
            />
         </div>
      </>
   );
}
