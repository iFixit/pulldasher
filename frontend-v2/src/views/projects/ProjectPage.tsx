import { Check } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { issueUrl, n } from '../../../../shared/format';
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
   mondayOf,
   planFor,
   planEnd,
   UPDATE_DUE_DAYS,
   type RoadmapItem,
   type RoadmapStatus,
} from '../../../../shared/model/roadmap';
import { issueKey } from '../../../../shared/model/work';
import type { PullData } from '../../../../shared/types';
import {
   EmptyState,
   FactLink,
   LoadFailed,
   QuietButton,
   Segmented,
   textInputClass,
} from '../../components/bits';
import { Icon } from '../../components/Icon';
import { foldDomId, openFold, SubDoor } from '../../components/Lane';
import type { RowOptions } from '../../components/Row';
import { usePageKey } from '../../hooks';
import { dayOf, dayWords, type ProjectsData, type Range } from '../../model/projectData';
import { stageWord, type PortfolioItem } from '../../model/portfolio';
import { reloadProjectWork, useProjectWork } from '../../model/projectWork';
import { updateRoadmapItem } from '../../model/roadmapData';
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
   DONE_WHEN,
   END_MEANS,
   END_WORD,
   LAST_14_DAYS,
   NO_UPDATE_YET,
   UPDATE_DUE,
} from '../../model/words';
import { answerWords, planRow, reasonParts, usePlanCalls, type Call } from './Decide';
import { BacklogSection } from './BacklogSection';
import {
   flagText,
   openPlan,
   PeopleStack,
   ProjectFacts,
   takeLanding,
   targetWords,
   type Navigate,
   type ProjectsNav,
} from './parts';
import { UpdatesPanel, vouchRule, vouchWords, when } from './roadmapHealth';
import { ProjectWorkSections, showPulls, type PullLookup } from './Work';
import { IssuesBar, PlanTimeline } from './projectMarks';

/** words that start a line, with a capital */
const upper = (s: string) => s[0].toUpperCase() + s.slice(1);

/** a day that never breaks across two lines ("Sep 26", not "Sep" then "26") */
const unbroken = (s: string) => s.replace(/ /g, '\u00a0');

/** the order a project's open PRs are counted in: nearest to shipping first */
const PR_STAGES: readonly PrStage[] = ['ready', 'hold', 'review', 'work'];

/** the latest update's health word, where the focus lands after posting one */
const HEALTH_ID = 'project-update-health';
/** the way to post one, where the focus lands after taking one back */
const POST_ID = 'project-post-update';
/** a label in the page's two lists, and the lists themselves */
const LABEL = 'mt-2 text-xs leading-5 text-ink-3 first:mt-0 sm:mt-0';
const LIST =
   'm-0 grid grid-cols-1 items-start gap-x-4 text-[13px] leading-5 sm:grid-cols-[7.5rem_minmax(0,1fr)]';
/** a dot after every item of a run but its last, so a wrapped line ends on
 * a dot and never starts with one */
const DOTTED =
   "[&>*:not(:last-child)]:after:ml-3 [&>*:not(:last-child)]:after:text-ink-3 [&>*:not(:last-child)]:after:content-['·']";

/** A box that can be changed here: every editable value wears it, and
 * nothing else on the page does. */
const FIELD = `${textInputClass} text-ink hover:border-brand focus:border-brand`;

/** Status, picked from its plan's four: the value is the control. */
const STATUS_OPTIONS: [RoadmapStatus, string][] = [
   ['active', 'In progress'],
   ['parked', 'Parked'],
   ['done', 'Done'],
   ['dropped', 'Dropped'],
];

/**
 * Its plan as fields: Status and End, each the plan's own value as a control,
 * and Decide's question on the field its answer changes, with that one
 * answer suggested. Every change is one of Decide's calls, so Decide's row
 * clears and the receipt, with Undo, lands under the field that made it.
 */
function PlanFields({
   row,
   plan,
   project,
   ask,
   ongoingByLabel,
   openRoadmap,
   showDates,
}: {
   row: DecideRow;
   plan: RoadmapItem | null;
   project: PortfolioItem | undefined;
   /** Decide's question, when it asks one */
   ask: { facts: string; question: string } | null;
   ongoingByLabel: boolean;
   openRoadmap: () => void;
   /** its dates in words, where no timeline under Progress shows them */
   showDates: boolean;
}) {
   const { answer, ends, receipt, make, retry, undo, clear } = usePlanCalls(row, project);
   // a date of one's own, past the presets: the browser's own calendar
   const [picking, setPicking] = useState(false);
   const pickRef = useRef<HTMLInputElement>(null);
   useEffect(() => {
      // straight to the calendar, where the browser has one
      try {
         if (picking) pickRef.current?.showPicker();
      } catch {
         // no picker without a click (Safari): the box is focused
      }
   }, [picking]);
   const host = (c: Call | null | undefined) =>
      c?.kind === 'commit' || c?.kind === 'ongoing' ? 'end' : 'status';
   const ongoing = plan?.end_kind === 'ongoing';
   const question = ask && (
      <div className="mt-1.5 max-w-[60ch]">
         {/* with a suggested answer, its button is the question answered, so
             the question is only that button's hover */}
         <p className="m-0 text-ink-2">
            {ask.facts} {!answer && <span className="text-warn">{ask.question}</span>}
         </p>
         {answer && (
            // a quiet fill, never an outline: outlines are the boxes'
            <button
               type="button"
               onClick={() => make(answer)}
               title={`${ask.question} Decide suggests this.`}
               className="hit pressable mt-1.5 inline-flex h-7 items-center rounded-lg border-0 bg-brand-50 px-2.5 text-[13px] font-medium text-brand hover:bg-brand-100"
            >
               {answerWords(answer, plan)}
               <span className="ml-1.5 text-[11px] font-normal opacity-80">Suggested</span>
            </button>
         )}
      </div>
   );
   const said = receipt && (
      <p className="m-0 mt-1.5 text-ink-2" role="status">
         {receipt.state === 'failed' ? (
            <>
               Didn’t save.{receipt.why} <QuietButton onClick={retry}>Try again</QuietButton>{' '}
               <QuietButton onClick={clear}>Cancel</QuietButton>
            </>
         ) : (
            <>
               <Icon icon={Check} size={14} className="mr-1 inline-block align-[-2px]" />
               {receipt.words}
               {receipt.why && ` ${receipt.why}`} <QuietButton onClick={undo}>Undo</QuietButton>
            </>
         )}
      </p>
   );
   const under = (field: 'status' | 'end') => (
      <>{receipt ? host(receipt.call) === field && said : host(answer) === field && question}</>
   );
   const commitTo = (end: string) => {
      const c = ends.find(e => e.end === end);
      if (c) make({ kind: 'commit', ...c });
   };
   /** Any day picked: plans move in whole weeks, so it finishes that week's
    * Sunday, and the words say so. */
   const commitToDay = (day: string) => {
      const end = planEnd({ start: mondayOf(day), weeks: 1 });
      make({ kind: 'commit', label: dayWords(end), end, through: dayWords(end) });
   };
   const label = `${LABEL} sm:leading-8`;
   return (
      <>
         <dt className={label}>Status</dt>
         <dd className="m-0">
            {plan ? (
               <Segmented
                  ariaLabel="Status"
                  value={plan.status === 'planned' ? 'active' : plan.status}
                  options={STATUS_OPTIONS.map(([v, w]) => [
                     v,
                     v === 'active' && plan.status === 'planned' ? 'Planned' : w,
                  ])}
                  onChange={v => {
                     if (v === 'parked') make({ kind: 'park' });
                     else if (v === 'done') make({ kind: 'done' });
                     else if (v === 'dropped') make({ kind: 'drop' });
                     else {
                        // back under way needs an end: the suggested one, or the nearest
                        const end = answer?.kind === 'commit' ? answer : ends[0];
                        if (end) make({ ...end, kind: 'commit' });
                     }
                  }}
               />
            ) : (
               <span className="leading-8 text-ink-2">No plan</span>
            )}
            {under('status')}
         </dd>
         <dt className={label}>End</dt>
         <dd className="m-0">
            {ongoingByLabel && !plan ? (
               <span className="leading-8 text-ink-2">
                  No end date: its GitHub label says ongoing
               </span>
            ) : (
               <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <select
                     aria-label="When it ends"
                     value=""
                     onChange={e => {
                        const v = e.target.value;
                        if (v === 'ongoing') make({ kind: 'ongoing' });
                        else if (v === 'pick') setPicking(true);
                        else if (v) commitTo(v);
                     }}
                     className={`${FIELD} cursor-pointer pr-7 pl-2.5`}
                  >
                     <option value="" disabled>
                        {!plan
                           ? 'Promise to finish by…'
                           : ongoing
                           ? 'No end'
                           : dayWords(planEnd(plan))}
                     </option>
                     {ends.map(e => (
                        <option key={e.end} value={e.end}>
                           {e.label}
                        </option>
                     ))}
                     <option value="pick">Pick a date…</option>
                     {!ongoing && <option value="ongoing">No end date (ongoing)</option>}
                  </select>
                  {picking && (
                     <input
                        type="date"
                        aria-label="Finish by"
                        min={dayOf(new Date())}
                        autoFocus
                        ref={pickRef}
                        onChange={e => {
                           if (!e.target.value) return;
                           setPicking(false);
                           commitToDay(e.target.value);
                        }}
                        onBlur={() => setPicking(false)}
                        className={`${FIELD} px-2.5`}
                     />
                  )}
                  {plan && !ongoing && (
                     <span title={`${END_MEANS.hard} ${END_MEANS.soft}`}>
                        <Segmented
                           ariaLabel="Kind of end"
                           value={plan.end_kind}
                           options={[
                              ['hard', END_WORD.hard],
                              ['soft', END_WORD.soft],
                           ]}
                           onChange={v => void updateRoadmapItem(plan.id, { end_kind: v })}
                        />
                     </span>
                  )}
                  {plan && showDates && (
                     <FactLink
                        onClick={openRoadmap}
                        title="Move its dates on the roadmap"
                        className="text-ink-3"
                     >
                        from {dayWords(plan.start)}, {plan.weeks}{' '}
                        {plan.weeks === 1 ? 'week' : 'weeks'}
                     </FactLink>
                  )}
               </span>
            )}
            {under('end')}
         </dd>
      </>
   );
}

/** "Done when" as its own box: Enter or leaving it saves; the receipt
 * beside it takes it back. */
function DoneWhenField({ plan }: { plan: RoadmapItem }) {
   const saved = plan.done_when ?? '';
   const [text, setText] = useState(saved);
   const [was, setWas] = useState<string | null>(null);
   const [state, setState] = useState<'idle' | 'saved' | 'failed'>('idle');
   useEffect(() => setText(plan.done_when ?? ''), [plan.done_when]);
   const save = async (value: string, before: string) => {
      if (value.trim() === before.trim()) return;
      const ok = await updateRoadmapItem(plan.id, { done_when: value.trim() });
      setState(ok ? 'saved' : 'failed');
      setWas(ok ? before : null);
   };
   return (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
         <input
            aria-label={`${DONE_WHEN}, for ${plan.name}`}
            className={`w-full max-w-[60ch] px-2.5 ${FIELD}`}
            value={text}
            maxLength={200}
            placeholder="What has to be true to call it done"
            onChange={e => {
               setText(e.target.value);
               setState('idle');
            }}
            onKeyDown={e => {
               if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            onBlur={() => void save(text, saved)}
         />
         <span role="status" className="text-xs text-ink-3">
            {state === 'saved' && was !== null ? (
               <>
                  Saved.{' '}
                  <QuietButton
                     onClick={() => {
                        setText(was);
                        void save(was, text);
                        setState('idle');
                     }}
                  >
                     Undo
                  </QuietButton>
               </>
            ) : state === 'failed' ? (
               'Didn’t save. Try again.'
            ) : (
               ''
            )}
         </span>
      </span>
   );
}

/** The update box: a real box, two lines, that grows into the composer
 * (drafted from the numbers) once it's used; "u" opens it too. */
function UpdateBox({ plan }: { plan: RoadmapItem }) {
   const [open, setOpen] = useState(false);
   if (!open) {
      return (
         <textarea
            id={POST_ID}
            rows={1}
            readOnly
            aria-label={`Write the next update on ${plan.name}`}
            aria-keyshortcuts="u"
            placeholder="Write the next update…"
            onFocus={() => setOpen(true)}
            className={`mt-2 block w-full max-w-[60ch] resize-none px-2.5 py-1.5 ${FIELD} h-auto`}
         />
      );
   }
   return (
      <div id={POST_ID} className="mt-2 max-w-[60ch] overflow-hidden rounded-lg border border-line">
         <UpdatesPanel
            item={plan}
            bare
            history={false}
            autoFocus
            onClose={() => setOpen(false)}
            actions={<QuietButton onClick={() => setOpen(false)}>Cancel</QuietButton>}
         />
      </div>
   );
}

/** Bring the update box into view and open it. */
function openComposer() {
   const el = document.getElementById(POST_ID);
   el?.scrollIntoView({ block: 'center' });
   el?.focus({ preventScroll: true });
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
   if (missed) return `after the ${day} target`;
   return name ? `${name} target date, ${day}` : `target date ${day}`;
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
   // what the page just did, for a screen reader
   const [said, setSaid] = useState('');
   // "u" goes to the update box in "Change this project" from anywhere on
   // the page, clear of the app's header
   usePageKey('u', () => {
      if (!plans || !planFor(slug, plans)) return setSaid('It has no plan to post an update on.');
      openComposer();
   });
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
   // a trip here for one section (Decide's "Or add issues") lands on it,
   // once its issues are in, so it lands where they end up
   const landing = useRef<string | null>();
   useEffect(() => {
      if (landing.current === undefined) landing.current = takeLanding();
      if (!landing.current || work === undefined) return;
      jumpTo(null, landing.current);
      landing.current = null;
   }, [work]);
   // a closed project isn't on Today, so read its recent merges straight off
   // the closed pulls (the server keeps 14 days of them)
   const merged =
      group?.merged ??
      closed.filter(
         p => p.merged_at && projectOf(p.labels, prefix, data?.pull_links?.[issueKey(p)]) === slug
      );
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
   const ongoing = byLabel || ongoingSaved.includes(slug);
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
   // with no developer teams yet nobody is a developer, so the faces go
   // unsplit rather than all under "Non-developers"
   const split = !!data && Object.keys(data.teams).length > 0;
   const devs = split ? people.filter(login => teamOf(login) != null) : [];
   const others = split ? people.filter(login => teamOf(login) == null) : [];
   // when its issue says it's finished, for the PRs that opened after
   const closedIssue = closedIssues(project ? [project] : []).get(slug) ?? null;

   // its PRs by where they stand, from the same list the page shows, each
   // by the key that finds it below
   // a PR that does one of its issues but counts in another project isn't
   // this project's, so the counts leave it out as the Overview does
   const onPage = new Map(
      [
         ...(page?.issues.flatMap(i => i.prs.filter(pr => !pr.outside)) ?? []),
         ...(page?.unlinked ?? []),
      ].map(pr => [issueKey(pr), pr])
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
   // its numbers vouch for it: no update owed, and the Update row says why
   const vouch =
      planHealth?.kind === 'quiet' || planHealth?.kind === 'current' ? planHealth.vouch : undefined;
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
         // the page's Status already says there's no plan
         reasonParts(r, quoteless(row), r.kind === 'new')
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
   // Decide's rows here, asked or decided; a call made under the plan, where
   // Decide asked nothing, keeps its receipt there
   const decideRows = calls.filter(row => row.reasons.length);
   // the row the Plan fields answer: Decide's, while it asks, else the plan's
   const fieldRow = decideRows[0] ?? planRow(slug, plan, calls);
   const org = project?.repo.split('/')[0] ?? 'iFixit';
   const labelSearch = `https://github.com/search?type=pullrequests&q=${encodeURIComponent(
      `org:${org} label:"${prefix}${slug}"`
   )}`;
   const owes = !!plan && (planHealth?.kind === 'missing' || planHealth?.kind === 'stale');
   // the board's flags, said first on the PRs row, their word the one amber
   // one that covers every open PR (they all stand at one stage) joins the
   // open count's line instead of saying the same thing on a line of its own
   const allOneStage =
      [...byStage.values()].filter(l => l.length).length + (unread.length ? 1 : 0) <= 1;
   const merged1 = allOneStage ? (group?.flags ?? []).find(f => f !== 'one_person') : undefined;
   const warnings: ReactNode[] = (group?.flags ?? [])
      .filter(f => f !== merged1)
      .map(flag => {
         const [word] = flagText(flag, group as ProjectGroup);
         const lone = group?.people[0];
         return (
            <span key={flag} className="block">
               <span className="font-medium text-warn">{upper(word)}</span>
               {': '}
               {flag === 'one_person' && group && lone ? (
                  <>
                     <FactLink onClick={() => onPerson(lone)}>{lone}</FactLink> ·{' '}
                     {group.open.length + group.merged.length} PRs in the {LAST_14_DAYS}
                  </>
               ) : (
                  group &&
                  pullCount(
                     group.open.map(p => issueKey(p.data)),
                     group.open.length === 1 ? 'open PR' : 'open PRs'
                  )
               )}
            </span>
         );
      });

   const openCount = [...byStage.values()].reduce((sum, l) => sum + l.length, 0) + unread.length;
   const target = targetOf(project);
   const due = target?.due_on?.slice(0, 10) ?? null;
   const missed = !!due && due < dayOf(new Date()) && openCount > 0;
   const finished = project?.state === 'closed' || (!!plan && !isUnderWay(plan.status));
   // a rough finish from its issues closed and added lately; with no issues
   // there's nothing honest to run a pace on, so the target stands alone.
   // Past a missed target, "after the target" goes without saying.
   const forecast =
      !ongoing && plan?.end_kind !== 'ongoing' && !finished && page?.issues.length
         ? issueForecast(page.issues, missed ? null : due)
         : null;
   // its plan as a line under Progress, while there's a plan with an end
   // still to come or run past (parked shows too, in grey)
   const timeline =
      !!plan && plan.status !== 'done' && plan.status !== 'dropped' && plan.end_kind !== 'ongoing';
   const lastActivity = item?.lastActivity ?? null;
   const counts = page?.counts;
   const added = page ? page.issues.filter(i => addedLater(i, planned)).length : 0;
   const stageCounts: [string, string[]][] = [
      ...PR_STAGES.filter(s => byStage.get(s)?.length).map((s): [string, string[]] => [
         STAGE_WORDS[s].toLowerCase(),
         byStage.get(s) ?? [],
      ]),
      ...(unread.length ? [['not on the board yet', unread] as [string, string[]]] : []),
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
         {/* who it is: the name, then GitHub's facts in one quiet line */}
         <div className="mb-6">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
               <h2 className="m-0 text-xl font-semibold leading-7">{name}</h2>
               {/* with a plan, its Status says where it stands */}
               {!plan && <span className="text-[13px] text-ink-3">{standing}</span>}
               <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3 sm:ml-auto">
                  {/* its label and where to edit it: out to GitHub, by who works on it */}
                  <a
                     href={labelSearch}
                     target="_blank"
                     rel="noopener noreferrer"
                     className="text-ink-3 underline decoration-line underline-offset-2 hover:text-brand"
                     title="Everything on GitHub with this project's label"
                  >
                     {prefix + slug} ↗
                  </a>
                  {project && (
                     <a
                        href={issueUrl(project.repo, project.number)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-ink-3 underline decoration-line underline-offset-2 hover:text-brand"
                        title="The name, lead, target and parents are set on its GitHub issue"
                     >
                        Edit on GitHub ↗
                     </a>
                  )}
                  {people.length > 0 && (
                     <span className="flex items-center gap-3 text-xs text-ink-3">
                        {devs.length > 0 && others.length > 0 ? (
                           <>
                              <span className="inline-flex items-center gap-1.5">
                                 Developers{' '}
                                 <PeopleStack
                                    logins={devs}
                                    size={20}
                                    onPerson={onPerson}
                                    me={opts.me}
                                 />
                              </span>
                              <span className="inline-flex items-center gap-1.5">
                                 Non-developers{' '}
                                 <PeopleStack
                                    logins={others}
                                    size={20}
                                    onPerson={onPerson}
                                    me={opts.me}
                                 />
                              </span>
                           </>
                        ) : (
                           <PeopleStack
                              logins={people}
                              size={20}
                              onPerson={onPerson}
                              me={opts.me}
                           />
                        )}
                     </span>
                  )}
               </span>
            </div>
            <div
               className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-3 ${DOTTED}`}
            >
               <ProjectFacts
                  g={{ slug }}
                  project={project}
                  prefix={prefix}
                  ongoing={ongoing}
                  lead={item}
                  links={{ navigate, nameOf, parts: [], projectsRepo: data?.projects_repo }}
                  ongoingByLabel={byLabel}
                  issueLink={false}
                  inline
               />
            </div>
         </div>

         {/* the plan: every white box can be changed right here, and
             nothing else on the page wears one */}
         <section aria-labelledby="project-plan-title" className="mb-8">
            <h3 id="project-plan-title" className="m-0 mb-3 text-[13px] font-semibold text-ink">
               Plan
            </h3>
            <dl className={`${LIST} gap-y-1 sm:gap-y-3`}>
               {plans && (
                  <PlanFields
                     row={fieldRow}
                     plan={plan}
                     project={item}
                     ask={asked[0] ? { facts: asked[0].facts, question: asked[0].question } : null}
                     ongoingByLabel={byLabel}
                     openRoadmap={() => plan && navigate(openPlan(nav, plan.id))}
                     showDates={!timeline}
                  />
               )}
               {plan && (
                  <>
                     <dt className={`${LABEL} sm:leading-8`}>{DONE_WHEN}</dt>
                     <dd className="m-0">
                        <DoneWhenField plan={plan} />
                     </dd>
                     <dt className={`${LABEL} sm:leading-8`}>Update</dt>
                     <dd className="m-0 text-ink-2 sm:pt-1.5">
                        {owes && (
                           <p className="m-0">
                              <span className="font-medium text-warn">
                                 {planHealth?.kind === 'missing' ? NO_UPDATE_YET : UPDATE_DUE}.
                              </span>{' '}
                              {planHealth?.kind === 'stale'
                                 ? `The last one was ${days(
                                      planHealth.days
                                   )} ago; one is due every ${days(UPDATE_DUE_DAYS)}.`
                                 : `None since it started; one is due every ${days(
                                      UPDATE_DUE_DAYS
                                   )}.`}
                           </p>
                        )}
                        {update && (
                           <div className={owes ? 'mt-1' : ''}>
                              <span
                                 id={HEALTH_ID}
                                 className={`font-medium ${healthOwed ? 'text-warn' : 'text-ink'}`}
                              >
                                 {HEALTH_WORD[update.health]}
                              </span>
                              <span className="text-ink-3">
                                 {' · '}
                                 {when(update.at)} · {update.author}
                              </span>
                              {update.body && (
                                 <p className="m-0 mt-0.5 max-w-[70ch] whitespace-pre-line">
                                    {update.body}
                                 </p>
                              )}
                           </div>
                        )}
                        {vouch && !owes && (
                           <p className="m-0 mt-0.5 text-ink-3" title={vouchRule(vouch)}>
                              {vouchWords(vouch)}
                           </p>
                        )}
                        <UpdateBox plan={plan} />
                     </dd>
                  </>
               )}
            </dl>
         </section>

         {/* what the board works out: facts, never boxes; a fixed column of
             small marks beside the words on a wide screen, the words alone
             on a phone, where they say every fact the marks do */}
         <section aria-labelledby="project-progress" className="mb-10">
            <h3 id="project-progress" className="m-0 mb-3 text-[13px] font-semibold text-ink">
               Progress
            </h3>
            <dl className="m-0 grid grid-cols-1 items-start gap-x-4 gap-y-1 text-[13px] leading-5 sm:grid-cols-[7.5rem_240px_minmax(0,1fr)] sm:gap-y-2.5">
               {parts.length > 0 && (
                  // a navigation fact, so it sits with the work it splits into
                  <>
                     <dt className={LABEL}>Projects in it</dt>
                     <dd className="m-0 text-ink-2 sm:col-span-2">
                        <Counts>
                           {parts.map(p => (
                              <FactLink
                                 key={p.slug}
                                 onClick={() => navigate({ project: p.slug })}
                                 title={`Open ${p.name}`}
                              >
                                 {p.name}
                              </FactLink>
                           ))}
                        </Counts>
                     </dd>
                  </>
               )}
               {(target || forecast || timeline) && plan !== undefined && (
                  <>
                     <dt className={LABEL}>Finish</dt>
                     {timeline && plan && (
                        <div className="hidden sm:block">
                           {
                              <PlanTimeline
                                 start={plan.start}
                                 end={planEnd(plan)}
                                 promised={plan.end_kind === 'hard'}
                                 today={dayOf(new Date())}
                                 target={due}
                                 forecast={forecast?.eta ?? null}
                                 parked={plan.status === 'parked'}
                                 onOpen={() => navigate(openPlan(nav, plan.id))}
                              />
                           }
                        </div>
                     )}
                     <dd className={`m-0 text-ink-2 ${timeline ? '' : 'sm:col-span-2'}`}>
                        <Counts>
                           {[
                              forecast && (
                                 <Fragment key="forecast">
                                    {forecast.tally && forecast.short ? (
                                       <SubDoor
                                          label="How the finish is worked out"
                                          text={upper(forecast.short)}
                                          inLine
                                       >
                                          <p className="m-0">
                                             {upper(forecast.tally)}. {forecast.how}
                                          </p>
                                       </SubDoor>
                                    ) : (
                                       <SubDoor
                                          label="How the finish is worked out"
                                          text={upper(forecast.text)}
                                          inLine
                                       >
                                          <p className="m-0">{forecast.how}</p>
                                       </SubDoor>
                                    )}
                                 </Fragment>
                              ),
                              target && (
                                 <Fragment key="target">
                                    {forecast
                                       ? targetText(target, due, missed)
                                       : upper(targetText(target, due, missed))}
                                 </Fragment>
                              ),
                              !forecast && !target && plan && (
                                 <Fragment key="plan">
                                    {plan.end_kind === 'hard' ? 'Promised by' : 'Estimated for'}{' '}
                                    {dayWords(planEnd(plan))}
                                 </Fragment>
                              ),
                           ]}
                        </Counts>
                     </dd>
                  </>
               )}
               <dt className={LABEL}>PRs</dt>
               <dd className="m-0 text-ink-2 sm:col-span-2">
                  {page === undefined ? (
                     'Counting…'
                  ) : page === null ? (
                     <LoadFailed what="its PRs" onRetry={reloadProjectWork} />
                  ) : (
                     <>
                        {warnings}
                        {/* where the open ones stand, each count a way to them */}
                        <span className="block">
                           {merged1 && group ? (
                              <>
                                 {pullCount(
                                    group.open.map(p => issueKey(p.data)),
                                    'open'
                                 )}
                                 ,{' '}
                                 <span className="font-medium text-warn">
                                    {flagText(merged1, group)[0].toLowerCase()}
                                 </span>
                              </>
                           ) : (
                              <>
                                 {stageCounts.length === 1 ? (
                                    <>
                                       {pullCount(stageCounts[0][1], 'open')}, {stageCounts[0][0]}
                                    </>
                                 ) : (
                                    <>
                                       {openCount ? `${openCount} open: ` : 'None open'}
                                       <Counts>
                                          {stageCounts.map(([words, keys]) => (
                                             <Fragment key={words}>
                                                {pullCount(keys, words)}
                                             </Fragment>
                                          ))}
                                       </Counts>
                                    </>
                                 )}
                              </>
                           )}
                        </span>
                        {loose.length > 0 && (
                           <span className="block">{pullCount(loose, 'not tied to an issue')}</span>
                        )}
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
                                          {activityKey && onPage.has(activityKey) ? (
                                             <FactLink
                                                onClick={() => show([activityKey])}
                                                aria-label={`Last activity ${activityWords}, on PR #${lastActivity.pr.number} ${lastActivity.pr.title}`}
                                             >
                                                {mergedLately.length > 0 ? 'last' : 'Last'} activity{' '}
                                                {activityWords}
                                             </FactLink>
                                          ) : (
                                             `${
                                                mergedLately.length > 0 ? 'last' : 'Last'
                                             } activity ${activityWords}`
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
               <dt className={LABEL}>Issues</dt>
               {!!counts?.total && (
                  <div className="hidden sm:block">
                     {
                        <IssuesBar
                           done={counts.done}
                           dropped={counts.dropped}
                           open={counts.open}
                           onPart={part =>
                              jumpTo(
                                 part === 'open' ? null : `work:${slug}:${part}`,
                                 'project-issues'
                              )
                           }
                        />
                     }
                  </div>
               )}
               <dd className={`m-0 text-ink-2 ${counts?.total ? '' : 'sm:col-span-2'}`}>
                  {page === null ? (
                     <LoadFailed what="its issues" onRetry={reloadProjectWork} />
                  ) : !counts ? (
                     'Counting…'
                  ) : !counts.total ? (
                     'None yet'
                  ) : (
                     // in the bar's order: done, dropped, then open
                     <Counts>
                        {[
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
                           <FactLink
                              key="open"
                              onClick={() => jumpTo(null, 'project-issues')}
                              className="tabular-nums"
                           >
                              {counts.open ? `${counts.open} open` : 'none open'}
                           </FactLink>,
                           added > 0 && (
                              <span key="added" className="tabular-nums">
                                 {added} added after the plan started
                              </span>
                           ),
                        ]}
                     </Counts>
                  )}
               </dd>
            </dl>
         </section>

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
