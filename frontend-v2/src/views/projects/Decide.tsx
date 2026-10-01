import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { n } from '../../../../shared/format';
import {
   compareRows,
   decideProjects,
   decideQueue,
   DECIDE_MIN_PRS,
   STALL_DAYS,
   type ClosedIssue,
   type DecideReason,
   type DecideRow,
} from '../../../../shared/model/decide';
import { firstOpenDay, type Today } from '../../../../shared/model/projects';
import { decideTurn, type DecideRotation } from '../../../../shared/model/settings';
import {
   addWeeks,
   HEALTH_WORD,
   isUnderWay,
   mondayOf,
   planEnd,
   weeksThrough,
   type RoadmapFields,
   type RoadmapItem,
   type RoadmapOrigin,
} from '../../../../shared/model/roadmap';
import {
   EmptyState,
   LoadFailed,
   PrimaryButton,
   QuietButton,
   Segmented,
   textInputClass,
} from '../../components/bits';
import { Icon } from '../../components/Icon';
import { GroupHeader, Rows, SubDoor, Truncated } from '../../components/Lane';
import { useRowKeys } from '../../components/useRowKeys';
import { mainTeam, type PortfolioItem } from '../../model/portfolio';
import { dayOf, dayWords } from '../../model/projectData';
import { commitEnds } from '../../model/roadmapTime';
import { saveDecideRotation, setOngoing } from '../../model/settingsData';
import { days, LAST_14_DAYS, NO_PLAN, pastEnd, PLAN_IT } from '../../model/words';
import type { WorkData } from '../../model/workData';
import {
   createRoadmapItem,
   dismissRoadmapProblem,
   loadRoadmap,
   readRoadmap,
   removeRoadmapItem,
   updateRoadmapItem,
   useRoadmap,
} from '../../model/roadmapData';
import { createMemoryStore } from '../../storage';
import { openPlan, ORIGIN_OPTIONS, PeopleStack, type Navigate, type ProjectsNav } from './parts';
import { PLAN_STATUS_WORD, when } from './roadmapHealth';

/** The decisions owed now, worst first, for this view, the tab's label and
 * the Overview's tile. */
export function decideRows(
   today: Today,
   items: readonly RoadmapItem[],
   closed: ReadonlyMap<string, ClosedIssue>,
   work: WorkData | null | undefined = null,
   ongoing: ReadonlySet<string> = new Set()
): DecideRow[] {
   return decideQueue({
      live: decideProjects(today),
      items,
      closed,
      planCounts: new Map(
         [...(work?.plans ?? [])].map(([id, w]) => [
            id,
            { openPulls: w.openPulls, afterEnd: w.afterEnd.length, afterDone: w.afterDone.length },
         ])
      ),
      issues: work?.projects,
      ongoing,
      today: dayOf(new Date()),
      now: Date.now() / 1000,
   });
}

/** What "It’s ongoing" is for, on the button and where No plan explains
 * itself. */
const ONGOING_HELP =
   'for upkeep with no finish line. Work that ends but can’t be sized: commit through a month, and Decide checks in when it ends.';

/** The queue's sections, worst first, as decide.ts ranks them: the reasons
 * each holds, its title, the line under it, and what that line opens to. A
 * row sits in the first section any of its reasons names. */
const SECTIONS: { kinds: DecideReason['kind'][]; title: string; sub: string; more: string[] }[] = [
   {
      kinds: ['reopened'],
      title: 'Done or dropped, but still being worked on',
      sub: 'A week after the call',
      more: [
         'Marked done or dropped, on the roadmap or by closing its issue, but a week later a PR is still open, or a new PR opened more than a week after it was marked.',
      ],
   },
   {
      kinds: ['issue_closed'],
      title: 'Issue closed, plan still open',
      sub: 'Closed after the plan last changed',
      more: [
         'Its issue was closed after the plan last changed, and the plan still says it’s going.',
      ],
   },
   {
      kinds: ['moving'],
      title: 'Parked, but still being worked on',
      sub: 'PRs moved after it was parked',
      more: [
         'Its PRs had activity after it was parked: a push, a person’s comment, stamp or review, opening or merging.',
      ],
   },
   {
      kinds: ['off_track'],
      title: 'Off track',
      sub: 'Its latest update says so',
      more: ['Its latest update says off track, and the plan hasn’t changed since.'],
   },
   {
      kinds: ['missed'],
      title: 'Missed its target',
      sub: 'PRs still open after the date',
      more: [
         'The target date on its issue passed with PRs still open, and the plan hasn’t changed since.',
      ],
   },
   {
      kinds: ['over', 'ended'],
      title: 'Past its end',
      sub: 'Still taking PRs first',
      more: [
         'The end date on its plan has passed. The ones still taking new PRs come first, then the longest overdue.',
      ],
   },
   {
      kinds: ['issues_done'],
      title: 'All its issues are closed',
      sub: 'Since the plan last changed',
      more: [
         'Every issue in the project is closed, and the plan hasn’t changed since the last one closed.',
      ],
   },
   {
      kinds: ['stalled'],
      title: 'Stalled',
      sub: `No PR activity for ${days(STALL_DAYS)}`,
      more: [
         `PRs still open, no PR activity for ${days(
            STALL_DAYS
         )} or more, and no call in that time. Activity is real work: a push, a person’s comment, stamp or review, opening or merging. The longest quiet come first.`,
      ],
   },
   {
      kinds: ['at_risk'],
      title: 'At risk',
      sub: 'Its latest update says so',
      more: ['Its latest update says at risk, and the plan hasn’t changed since.'],
   },
   {
      kinds: ['new'],
      title: NO_PLAN,
      sub: `${DECIDE_MIN_PRS} or more PRs, some open`,
      more: [
         `${DECIDE_MIN_PRS} or more PRs open or merged in the ${LAST_14_DAYS}, some still open, and no plan yet. Smaller work ships without one unless it stalls. The ones open longest come first.`,
         `It’s ongoing is ${ONGOING_HELP}`,
      ],
   },
];

const sectionOf = (row: DecideRow) =>
   SECTIONS.findIndex(s => row.reasons.some(r => s.kinds.includes(r.kind)));

/** The reason that put a row in its section: the one its question asks. */
const primaryOf = (row: DecideRow) =>
   row.reasons.find(r => SECTIONS[sectionOf(row)].kinds.includes(r.kind)) ?? row.reasons[0];

const rowKey = (row: DecideRow) => `${row.slug ?? ''}:${row.item?.id ?? ''}`;
const kindsOf = (row: DecideRow) => row.reasons.map(r => r.kind).join(',');
const nameOf = (row: DecideRow, project?: Pick<PortfolioItem, 'name'>) =>
   row.item?.name ?? project?.name ?? row.slug ?? 'A plan';

const closedAs = (as: 'done' | 'dropped') => (as === 'done' ? 'completed' : 'not planned');
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The calls a row can get. */
export type Call =
   | { kind: 'commit'; label: string; end: string }
   | { kind: 'park' }
   | { kind: 'done' }
   | { kind: 'drop' }
   | { kind: 'ongoing' };

/** The question a reason asks, and the call that answers yes. */
function askOf(reason: DecideReason): { question: string; call: Call['kind'] } {
   switch (reason.kind) {
      case 'new':
         return { question: `${PLAN_IT}?`, call: 'commit' };
      case 'stalled':
         return { question: 'Park it?', call: 'park' };
      case 'over':
      case 'missed':
      case 'off_track':
      case 'at_risk':
         return { question: 'New end?', call: 'commit' };
      case 'moving':
         return { question: 'Back on?', call: 'commit' };
      case 'ended':
         return { question: 'Done?', call: 'done' };
      case 'issue_closed':
         return reason.as === 'done'
            ? { question: 'Done?', call: 'done' }
            : { question: 'Drop it?', call: 'drop' };
      case 'reopened':
         return reason.as === 'done'
            ? { question: 'Still done?', call: 'done' }
            : { question: 'Still dropped?', call: 'drop' };
      case 'issues_done':
         return reason.done
            ? { question: 'Done?', call: 'done' }
            : { question: 'Drop it?', call: 'drop' };
   }
}

/**
 * The facts behind a reason, in words. `bare` leaves out what the reason's
 * section title already says, for a row under that title.
 */
function reasonFacts(reason: DecideReason, item: RoadmapItem | null, bare = false): string {
   switch (reason.kind) {
      case 'new': {
         const since = reason.since ? `PRs open since ${dayWords(reason.since)}` : 'PRs open';
         return bare ? since : `${since}, and no plan yet`;
      }
      case 'stalled':
         return `No PR activity for ${days(reason.days)}`;
      case 'over': {
         const after = reason.since ? `, and ${n(reason.since, 'PR')} opened after it ended` : '';
         return bare && item
            ? `Ended ${dayWords(planEnd(item))} with PRs still open${after}`
            : `PRs still open ${pastEnd(reason.weeks)}${after}`;
      }
      case 'ended': {
         const after = reason.since
            ? `, though ${n(reason.since, 'PR')} opened after it ended`
            : '';
         return bare && item
            ? `Ended ${dayWords(planEnd(item))} and no PRs are open${after}`
            : `${upperFirst(pastEnd(reason.weeks))}, and no PRs are open${after}`;
      }
      case 'missed':
         return bare
            ? `The target was ${dayWords(reason.due)}, with ${n(reason.open, 'PR')} still open`
            : `Missed its ${dayWords(reason.due)} target with ${n(reason.open, 'PR')} open`;
      case 'off_track':
      case 'at_risk': {
         const u = item?.update;
         const said = u?.body ? `: ${u.body.split('\n')[0]}` : '';
         if (!bare) return `${HEALTH_WORD[reason.kind]}, says ${u?.author ?? 'its lead'}${said}`;
         return u ? `Update from ${u.author}, ${when(u.at)}${said}` : 'Its latest update says so';
      }
      case 'issue_closed': {
         const plan = item ? PLAN_STATUS_WORD[item.status].toLowerCase() : 'going';
         const closed = `closed as ${closedAs(reason.as)} on ${dayWords(reason.on)}`;
         return bare
            ? `${upperFirst(closed)}, and the plan says ${plan}`
            : `Its issue was ${closed}, but the plan still says ${plan}`;
      }
      case 'reopened': {
         const still = [
            reason.open ? `${n(reason.open, 'PR is', 'PRs are')} still open` : null,
            reason.late ? `${n(reason.late, 'PR')} opened more than a week later` : null,
         ]
            .filter(Boolean)
            .join(' and ');
         if (reason.by === 'issue')
            return `Its issue was closed as ${closedAs(reason.as)}, but ${still}`;
         const on = item?.status_at ? ` ${when(item.status_at)}` : '';
         return `Marked ${reason.as} on the roadmap${on}, but ${still}`;
      }
      case 'moving': {
         const at = item?.status_at ?? item?.updated_at;
         return bare && at ? `Parked ${when(at)}` : 'Parked, but its PRs have had activity since';
      }
      case 'issues_done': {
         const tally = reason.done
            ? `${reason.done} done${reason.dropped ? `, ${reason.dropped} dropped` : ''}`
            : `all ${reason.dropped} dropped`;
         const open = reason.open ? `, but ${n(reason.open, 'PR is', 'PRs are')} still open` : '';
         return bare
            ? `${upperFirst(tally)}${open}`
            : `All its issues are closed (${tally})${open}`;
      }
   }
}

/** A sentence ended once: a reason that quotes an update ending in its own
 * stop keeps that one ("can land. New end?", never "land.. New end?"). */
const stop = (words: string) => (/[.!?…]$/.test(words) ? words : `${words}.`);

/** Why a row is here and the question it asks, in a sentence that stands
 * alone (a project's page, where there's no section title). */
export function reasonWords(reason: DecideReason, item: RoadmapItem | null): string {
   return `${stop(reasonFacts(reason, item))} ${askOf(reason).question}`;
}

/** A row under its section title, as plain text: the question its reason
 * asks, then the other reasons in full. */
function rowWords(row: DecideRow): string {
   const primary = primaryOf(row);
   return [
      `${stop(reasonFacts(primary, row.item, true))} ${askOf(primary).question}`,
      ...row.reasons.filter(r => r !== primary).map(r => stop(reasonFacts(r, row.item))),
   ].join(' ');
}

/** A reason the project page shows better than the roadmap: its issues,
 * or the PRs that opened after its end. */
const aboutTheWork = (reason: DecideReason) =>
   reason.kind === 'issues_done' ||
   (reason.kind === 'reopened' && reason.late > 0) ||
   ((reason.kind === 'over' || reason.kind === 'ended') && reason.since > 0);

/** Where a plan the row makes starts: its item's start, or else the week
 * its first open PR opened. */
function startOf(row: DecideRow, project: PortfolioItem | undefined, today: string): string {
   if (row.item) return row.item.start;
   return mondayOf((project?.group && firstOpenDay(project.group)) || today);
}

const STATUS = { park: 'parked', done: 'done', drop: 'dropped' } as const;

/**
 * What a call writes to the roadmap: a change to the row's plan, or, for
 * work with none, a new plan from its first open PR's week through this one,
 * unless it commits further.
 */
export function writeFor(
   call: Exclude<Call, { kind: 'ongoing' }>,
   row: DecideRow,
   project: PortfolioItem | undefined,
   today: string
):
   | { id: number; fields: Partial<RoadmapFields>; restate: boolean }
   | { id: null; fields: Partial<RoadmapFields> } {
   const start = startOf(row, project, today);
   const fields: Partial<RoadmapFields> =
      call.kind === 'commit'
         ? { status: 'active', start, weeks: weeksThrough(start, call.end) }
         : { status: STATUS[call.kind] };
   if (row.item) {
      // done or dropped on a plan already marked so says it again, which
      // accepts the PRs that came after it, until a new one comes
      const restate = fields.status === 'done' || fields.status === 'dropped';
      return { id: row.item.id, fields, restate };
   }
   return {
      id: null,
      fields: {
         name: nameOf(row, project),
         project: row.slug,
         // with no plan yet, its team is the one most of its developers are on
         team: project?.team ?? null,
         lead: project?.lead ?? null,
         start,
         weeks: weeksThrough(start, today),
         ...fields,
      },
   };
}

/**
 * What a call decided and what happens next, by decide.ts's rules: a plan
 * comes back when it runs past its end, parked work when its PRs move, and
 * finished or dropped work a week on (REOPEN_DAYS) if PRs are still open or
 * new ones open, unless the work never ends.
 */
export function callWords(
   call: Call,
   row: DecideRow,
   project: Pick<PortfolioItem, 'open' | 'ongoing'> | undefined,
   today: string
): string {
   switch (call.kind) {
      case 'commit':
         // "End of Q4" reads "the end of Q4"
         return `Committed through the ${call.label.replace(
            /^End/,
            'end'
         )}. Decide asks again if it runs past that.`;
      case 'park':
         return 'Parked, so it stops counting in the weeks ahead. Decide asks again if its PRs move.';
      case 'ongoing':
         return 'Marked ongoing, so Decide stops asking it for a plan or an end.';
      case 'done':
      case 'drop': {
         const did = call.kind === 'done' ? 'Marked done' : 'Dropped';
         if (!row.slug || project?.ongoing) return `${did}.`;
         const week = dayWords(addWeeks(today, 1));
         return project && project.open > 0
            ? `${did}. Decide asks again if a PR is still open on ${week}, or a new one opens after.`
            : `${did}. Decide asks again if a PR opens after ${week}.`;
      }
   }
}

/** A call made on a row this visit, kept so the row stays in its place
 * saying what was decided, here and on the project's page. */
export interface Made {
   /** the row as it stood when the call was made */
   row: DecideRow;
   call: Call;
   /** what was decided and what happens next */
   words: string;
   /** made (saved, or saving), failed to save, or taken back with Undo */
   state: 'made' | 'failed' | 'undone';
   /** why the save, a later Undo, or where it came from didn't save */
   why?: string;
   /** where the work came from, said after the call */
   origin: RoadmapOrigin | null;
   /** tells this call from a later one on the same row */
   token: number;
}

// the calls made since the page loaded, so a trip to a project's page and
// back still shows them
const calls = createMemoryStore<{ made: ReadonlyMap<string, Made> }>({ made: new Map() });

function setMade(key: string, made: Made | null): void {
   const next = new Map(calls.get().made);
   if (made) next.set(key, made);
   else next.delete(key);
   calls.set({ made: next });
}

/** Change a row's call, if it's still the one `token` made and in `state`. */
function patchMade(key: string, token: number, state: Made['state'], patch: Partial<Made>): void {
   const made = calls.get().made.get(key);
   if (made?.token === token && made.state === state) setMade(key, { ...made, ...patch });
}

/**
 * The queue with this visit's calls kept in place: a row called here stays,
 * among `all` but not `owed`, until it comes back for a new reason. A row
 * taken back with Undo is owed again, even where the undo itself counted as
 * a change to the plan.
 */
export function keepCalls(
   queue: readonly DecideRow[],
   made: ReadonlyMap<string, Made>
): { owed: DecideRow[]; all: DecideRow[]; settled: ReadonlyMap<string, Made> } {
   const byKey = new Map(queue.map(row => [rowKey(row), row]));
   const settled = new Map<string, Made>();
   const back: DecideRow[] = [];
   for (const [key, m] of made) {
      const again = byKey.get(key);
      if (m.state !== 'made') {
         if (!again) back.push(m.row);
      } else if (!again || kindsOf(again) === kindsOf(m.row)) {
         settled.set(key, m);
      }
   }
   const owed = [...queue.filter(row => !settled.has(rowKey(row))), ...back].sort(compareRows);
   const all = [...owed, ...[...settled.values()].map(m => m.row)].sort(compareRows);
   return { owed, all, settled };
}

/** keepCalls on this visit's calls, for a view that lists Decide's rows. */
export function useKeptCalls(queue: readonly DecideRow[]) {
   return keepCalls(queue, calls.useValue().made);
}

// each row's writes run one after another, so an Undo or a "where it came
// from" waits for the call it follows instead of racing it
const chains = new Map<string, Promise<unknown>>();
function afterRow(key: string, write: () => Promise<unknown>): void {
   const next = (chains.get(key) ?? Promise.resolve()).then(write);
   chains.set(
      key,
      next.catch(() => undefined)
   );
}

// the calls whose save landed, by token, with the plan they wrote: what
// Undo takes back
const landed = new Map<number, { id: number | null }>();
let tokens = 0;

/** Why a save didn't land, after "Didn’t save.": the server's reason, or
 * how to sign in again, or nothing for a plain failure. */
export function whyNot(problem: string | null): string {
   if (!problem) return '';
   const said = /^Couldn’t [^:.]+: (.+)$/.exec(problem);
   if (said) return ` ${upperFirst(said[1])}`;
   return problem.startsWith('Couldn’t') ? '' : ` ${problem}`;
}

/** The roadmap's words for the save that just failed, taken off the page
 * header: the row says it, where the click was. */
function takeProblem(): string {
   const { problem } = readRoadmap();
   dismissRoadmapProblem();
   return whyNot(problem);
}

function makeCall(row: DecideRow, call: Call, project: PortfolioItem | undefined): void {
   const key = rowKey(row);
   const token = ++tokens;
   const today = dayOf(new Date());
   // shown as made at once, so nothing moves while it saves
   setMade(key, {
      row,
      call,
      words: callWords(call, row, project, today),
      state: 'made',
      origin: row.item?.origin ?? null,
      token,
   });
   afterRow(key, async () => {
      let id: number | null = null;
      let why: string | null = null;
      if (call.kind === 'ongoing') {
         const saved = await setOngoing(row.slug as string, true);
         if ('error' in saved) why = whyNot(saved.error);
      } else {
         const write = writeFor(call, row, project, today);
         if (write.id != null) {
            const ok = await updateRoadmapItem(write.id, write.fields, { restate: write.restate });
            if (ok) id = write.id;
            else why = takeProblem();
         } else {
            id = (await createRoadmapItem(write.fields))?.id ?? null;
            if (id == null) why = takeProblem();
         }
      }
      if (why == null) landed.set(token, { id });
      else patchMade(key, token, 'made', { state: 'failed', why });
   });
}

/** Take a call back: the plan as it was, the new plan gone, or the project
 * no longer ongoing. */
function undoCall(key: string): void {
   const made = calls.get().made.get(key);
   if (!made) return;
   setMade(key, { ...made, state: 'undone', why: undefined });
   afterRow(key, async () => {
      const saved = landed.get(made.token);
      // a call that never saved has nothing to take back
      if (!saved) return;
      let why: string | null = null;
      const was = made.row.item;
      if (made.call.kind === 'ongoing') {
         const r = await setOngoing(made.row.slug as string, false);
         if ('error' in r) why = whyNot(r.error);
      } else if (was) {
         const fields = {
            status: was.status,
            start: was.start,
            weeks: was.weeks,
            origin: was.origin,
         };
         // with the times the call replaced, so the plan reads as never
         // decided and Decide asks again after a reload too
         const undo =
            was.updated_at != null
               ? { updated_at: was.updated_at, status_at: was.status_at ?? null }
               : undefined;
         if (!(await updateRoadmapItem(was.id, fields, { undo }))) why = takeProblem();
      } else if (saved.id != null && !(await removeRoadmapItem(saved.id))) {
         why = takeProblem();
      }
      if (why == null) landed.delete(made.token);
      else patchMade(key, made.token, 'undone', { state: 'made', why: `Undo didn’t save.${why}` });
   });
}

/** Say where a decided plan's work came from. */
function sayOrigin(key: string, origin: RoadmapOrigin | null): void {
   const made = calls.get().made.get(key);
   if (!made || made.state !== 'made') return;
   setMade(key, { ...made, origin, why: undefined });
   afterRow(key, async () => {
      const id = landed.get(made.token)?.id;
      if (id == null || calls.get().made.get(key)?.state !== 'made') return;
      if (!(await updateRoadmapItem(id, { origin }))) {
         const why = `Where it came from didn’t save.${takeProblem()}`;
         patchMade(key, made.token, 'made', { origin: made.origin, why });
      }
   });
}

/** a call or a fact that does something, as plain words */
const textButton =
   'hit pressable rounded border-0 bg-transparent p-0 text-left text-xs text-ink-2 hover:text-brand hover:underline';
/** the way on after a call: Undo, Try again */
const linkButton =
   'hit pressable rounded border-0 bg-transparent p-0 text-xs font-medium text-brand hover:underline';

/** Words or controls in a line, a dot between each, the dot trailing its
 * word so a wrapped line never starts with one. */
function Dotted({ children }: { children: ReactNode[] }) {
   const shown = children.filter(Boolean);
   return (
      <>
         {shown.map((child, i) => (
            <span key={i} className="inline-flex items-center gap-x-2">
               {child}
               {i < shown.length - 1 && (
                  <span aria-hidden className="text-xs text-ink-3">
                     ·
                  </span>
               )}
            </span>
         ))}
      </>
   );
}

/**
 * The calls a row can get, one click each, and once one is made, what was
 * decided and what happens next, with Undo. The question the row's reason
 * asks has one answer, the outlined button; the other calls are words. Works
 * wherever a Decide row shows: this view, and a project's own page.
 */
export function DecideCall({
   row,
   project,
   describedBy,
}: {
   row: DecideRow;
   /** its project, for a new plan's start, team and lead, and for what
    * happens next */
   project?: PortfolioItem;
   /** the element that says why the row is here, read with its answer */
   describedBy?: string;
}) {
   const made = calls.useValue().made.get(rowKey(row));
   // a call made on the row as it stood; a row back for a new reason is asked afresh
   const mine = made && kindsOf(made.row) === kindsOf(row) ? made : undefined;
   const shown = mine?.state === 'made' || mine?.state === 'failed' ? mine : undefined;
   const name = nameOf(row, project);
   const rootRef = useRef<HTMLDivElement>(null);
   const refocus = useRef(false);
   const view = shown?.state ?? 'ask';
   const before = useRef(view);
   // after a click here, focus lands on what replaced the button: Undo,
   // Try again, or the row's answer; a save that fails later takes the
   // focus only from the Undo it removed
   useEffect(() => {
      if (before.current === view) return;
      before.current = view;
      const lost = document.activeElement === document.body && view === 'failed';
      if (!refocus.current && !lost) return;
      refocus.current = false;
      rootRef.current?.querySelector<HTMLElement>('[data-decide-focus]')?.focus();
   }, [view]);
   const act = (fn: () => void) => () => {
      refocus.current = true;
      fn();
   };
   const said = !mine
      ? ''
      : mine.state === 'made'
      ? `${mine.words}${mine.why ? ` ${mine.why}` : ''}`
      : mine.state === 'failed'
      ? `Didn’t save the call on ${name}.${mine.why ?? ''}`
      : `Took back the call on ${name}.`;
   return (
      <div ref={rootRef} className="mt-1.5">
         {/* the receipt as a screen reader hears it, said as it changes; the
             words on screen are hidden from it, so it's read once */}
         <span className="sr-only" aria-live="polite">
            {said}
         </span>
         {shown?.state === 'failed' ? (
            <p className="m-0 flex min-h-[30px] flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-2">
               <span aria-hidden>Didn’t save.{shown.why}</span>
               <Dotted>
                  {[
                     <button
                        key="again"
                        type="button"
                        data-decide-focus
                        onClick={act(() => makeCall(shown.row, shown.call, project))}
                        aria-label={`Try the call on ${name} again`}
                        className={linkButton}
                     >
                        Try again
                     </button>,
                     <button
                        key="cancel"
                        type="button"
                        onClick={act(() => setMade(rowKey(row), null))}
                        aria-label={`Cancel the call on ${name}`}
                        className={textButton}
                     >
                        Cancel
                     </button>,
                  ]}
               </Dotted>
            </p>
         ) : shown ? (
            <div className="flex min-h-[30px] flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
               <span className="inline-flex items-baseline gap-1.5">
                  <Icon icon={Check} size={14} className="flex-none self-center" />
                  <span aria-hidden>
                     {shown.words}
                     {shown.why && ` ${shown.why}`}
                  </span>
               </span>
               <button
                  type="button"
                  data-decide-focus
                  onClick={act(() => undoCall(rowKey(row)))}
                  aria-label={`Undo the call on ${name}`}
                  className={linkButton}
               >
                  Undo
               </button>
               {shown.call.kind !== 'ongoing' && (
                  // optional, after the call: saying it alone never clears a row
                  <span className="inline-flex flex-wrap items-center gap-2 text-xs text-ink-3">
                     Where it came from
                     <Segmented
                        ariaLabel={`Where ${name} came from`}
                        value={shown.origin ?? 'unsaid'}
                        options={ORIGIN_OPTIONS}
                        onChange={o => sayOrigin(rowKey(row), o === 'unsaid' ? null : o)}
                     />
                  </span>
               )}
            </div>
         ) : (
            <CallStrip
               row={row}
               name={name}
               describedBy={describedBy}
               onCall={call => act(() => makeCall(row, call, project))()}
            />
         )}
      </div>
   );
}

/** The calls, before one is made: the row's answer outlined, the rest as
 * words, the dates together. */
function CallStrip({
   row,
   name,
   describedBy,
   onCall,
}: {
   row: DecideRow;
   name: string;
   describedBy?: string;
   onCall: (call: Call) => void;
}) {
   const answer = askOf(primaryOf(row)).call;
   const ends = commitEnds(dayOf(new Date()));
   // ongoing answers new work, and finished work that keeps going
   const ongoing =
      !!row.slug &&
      row.reasons.some(r => r.kind === 'new' || (r.kind === 'reopened' && r.by === 'roadmap'));
   const button = (call: Call, label: string, ariaLabel: string, isAnswer: boolean) =>
      isAnswer ? (
         <QuietButton
            key={label}
            data-decide-focus
            onClick={() => onCall(call)}
            aria-label={ariaLabel}
            aria-describedby={describedBy}
         >
            {label}
         </QuietButton>
      ) : (
         <button
            key={label}
            type="button"
            onClick={() => onCall(call)}
            aria-label={ariaLabel}
            className={textButton}
         >
            {label}
         </button>
      );
   return (
      <div className="flex min-h-[30px] flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-3">
         <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            Commit through
            <Dotted>
               {ends.map((c, i) =>
                  button(
                     { kind: 'commit', ...c },
                     c.label,
                     `Commit ${name} through the ${c.label.replace(/^End/, 'end')}`,
                     answer === 'commit' && i === 0
                  )
               )}
            </Dotted>
         </span>
         <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <Dotted>
               {[
                  button({ kind: 'park' }, 'Park', `Park ${name}`, answer === 'park'),
                  button({ kind: 'done' }, 'Mark done', `Mark ${name} done`, answer === 'done'),
                  button({ kind: 'drop' }, 'Drop', `Drop ${name}`, answer === 'drop'),
                  ongoing && (
                     <button
                        key="ongoing"
                        type="button"
                        onClick={() => onCall({ kind: 'ongoing' })}
                        aria-label={`Mark ${name} ongoing`}
                        title={upperFirst(ONGOING_HELP)}
                        className={textButton}
                     >
                        It’s ongoing
                     </button>
                  ),
               ]}
            </Dotted>
         </span>
      </div>
   );
}

/** Its facts, in words a decision turns on: lead, team, people and size,
 * target. Each does what it names when clicked. */
function RowFacts({
   row,
   project,
   team,
   onTeam,
   onPerson,
   onProject,
}: {
   row: DecideRow;
   project: PortfolioItem | undefined;
   team: string | null;
   onTeam: (team: string) => void;
   onPerson?: (login: string) => void;
   onProject: () => void;
}) {
   const lead = row.item?.lead ?? project?.lead ?? null;
   const people = project ? [...project.developers, ...project.nonDevelopers] : [];
   const size = project
      ? [
           project.open ? n(project.open, 'open PR') : null,
           project.merged ? `${project.merged} merged in the ${LAST_14_DAYS}` : null,
        ]
           .filter(Boolean)
           .join(', ')
      : '';
   const due = project?.target?.due_on?.slice(0, 10);
   // a missed target is the row's reason already
   const target = due && !row.reasons.some(r => r.kind === 'missed') ? due : null;
   return (
      <Dotted>
         {[
            lead &&
               (onPerson ? (
                  <button
                     key="lead"
                     type="button"
                     onClick={() => onPerson(lead)}
                     title={`See ${lead} on People`}
                     className={textButton}
                  >
                     {lead}
                  </button>
               ) : (
                  <span key="lead" className="text-xs text-ink-2">
                     {lead}
                  </span>
               )),
            team && (
               <button
                  key="team"
                  type="button"
                  onClick={() => onTeam(team)}
                  aria-label={`Show only ${team}’s decisions`}
                  className={textButton}
               >
                  {team}
               </button>
            ),
            (people.length > 0 || size) && (
               <span key="size" className="inline-flex items-center gap-1.5 text-xs text-ink-3">
                  {people.length > 0 && <PeopleStack logins={people} onPerson={onPerson} />}
                  {size}
               </span>
            ),
            target && (
               <button
                  key="target"
                  type="button"
                  onClick={onProject}
                  title="Open the project"
                  className={textButton}
               >
                  {target < dayOf(new Date())
                     ? `target was ${dayWords(target)}`
                     : `target ${dayWords(target)}`}
               </button>
            ),
         ]}
      </Dotted>
   );
}

function DecideRowView({
   row,
   decided,
   project,
   team,
   nav,
   navigate,
   onPerson,
}: {
   row: DecideRow;
   /** a call was made on it here */
   decided: boolean;
   project: PortfolioItem | undefined;
   team: string | null;
   nav: ProjectsNav;
   navigate: Navigate;
   onPerson?: (login: string) => void;
}) {
   const nameId = useId();
   const whyId = useId();
   const { item } = row;
   const primary = primaryOf(row);
   const openProject = () =>
      row.slug ? navigate({ project: row.slug }) : item && navigate(openPlan(nav, item.id));
   // a reason about the plan opens the plan, where its bar shows it; one
   // about its issues or the PRs after its end opens the project page,
   // which lists them
   const reason = (r: DecideReason, bare: boolean) => {
      const words = stop(reasonFacts(r, item, bare));
      if (!item) return words;
      const work = !!row.slug && aboutTheWork(r);
      return (
         <button
            type="button"
            onClick={() =>
               work ? navigate({ project: row.slug as string }) : navigate(openPlan(nav, item.id))
            }
            className="pressable rounded border-0 bg-transparent p-0 text-left text-[13px] text-ink-2 hover:underline"
            title={
               work ? 'Open the project: its issues and their PRs' : 'Open its plan on the roadmap'
            }
         >
            {words}
         </button>
      );
   };
   return (
      // a decided row keeps every line it had, so the rows below never slide
      // under the pointer between two clicks
      <div
         role="group"
         aria-labelledby={nameId}
         data-decide-row
         className="scroll-mt-36 scroll-mb-4 border-t border-secondary px-3.5 py-2.5 first:border-t-0"
      >
         <div className={decided ? 'opacity-60' : ''}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
               <button
                  id={nameId}
                  type="button"
                  onClick={openProject}
                  className="hit pressable rounded border-0 bg-transparent p-0 text-left text-[13px] font-medium text-ink hover:text-brand"
                  title={row.slug ? 'Open the project and its PRs' : 'Open its plan on the roadmap'}
               >
                  {nameOf(row, project)}
               </button>
               <RowFacts
                  row={row}
                  project={project}
                  team={team}
                  onTeam={t => navigate({ team: t })}
                  onPerson={onPerson}
                  onProject={openProject}
               />
            </div>
            <p id={whyId} className="m-0 mt-0.5 text-[13px] text-ink-2">
               {reason(primary, true)} {/* the one thing owed on the row, until it's answered */}
               <span className={decided ? '' : 'text-warn'}>{askOf(primary).question}</span>
               {primary.kind === 'issues_done' && primary.open > 0 && row.slug && !decided && (
                  <>
                     {' '}
                     <button
                        type="button"
                        onClick={() => navigate({ project: row.slug as string })}
                        className={linkButton}
                     >
                        Or add issues for those PRs
                     </button>
                  </>
               )}
            </p>
            {row.reasons
               .filter(r => r !== primary)
               .map(r => (
                  <p key={r.kind} className="m-0 text-[13px] text-ink-2">
                     {reason(r, false)}
                  </p>
               ))}
         </div>
         <DecideCall row={row} project={project} describedBy={whyId} />
      </div>
   );
}

/** One piece of a team's work in flight. */
export interface InFlight {
   name: string;
   slug: string | null;
   /** its plan, when the roadmap has it */
   id: number | null;
}

/**
 * A team's work in flight now, in priority order, the way the roadmap's
 * capacity line counts it: its plans under way by the roadmap's order (one
 * per project), then its projects with PRs open and no plan, the
 * longest-running first. Past the team's developers, the rest have nobody
 * left to staff them.
 */
export function teamLoad(
   team: string,
   plans: readonly RoadmapItem[],
   items: readonly Pick<PortfolioItem, 'slug' | 'name' | 'team' | 'open' | 'openSince'>[],
   today: string
): InFlight[] {
   const open = new Map(items.map(i => [i.slug, i.open]));
   const counted = new Set<string>();
   const planned: InFlight[] = [];
   for (const p of [...plans].sort((a, b) => a.priority - b.priority || a.id - b.id)) {
      if (p.team !== team || !isUnderWay(p.status)) continue;
      const going = p.project
         ? (open.get(p.project) ?? 0) > 0 && !counted.has(p.project)
         : p.status === 'active' && p.start <= today && planEnd(p) >= today;
      if (!going) continue;
      if (p.project) counted.add(p.project);
      planned.push({ name: p.name, slug: p.project, id: p.id });
   }
   // a dropped plan is no plan: its project is in flight without one
   const kept = new Set(
      plans.flatMap(p => (p.project && p.status !== 'dropped' ? [p.project] : []))
   );
   const loose = items
      .filter(i => i.team === team && i.open > 0 && !kept.has(i.slug))
      .sort(
         (a, b) =>
            (a.openSince ?? today).localeCompare(b.openSince ?? today) ||
            a.name.localeCompare(b.name)
      )
      .map(i => ({ name: i.name, slug: i.slug, id: null }));
   return [...planned, ...loose];
}

/** A team's work in flight against its developers, in the roadmap's words,
 * naming what nobody is left to staff. */
function TeamLoad({
   team,
   developers,
   load,
   onOpen,
}: {
   team: string;
   developers: number;
   load: InFlight[];
   onOpen: (work: InFlight) => void;
}) {
   if (!developers) return null;
   const over = load.length - developers;
   const said = `${team} has ${load.length} in progress for ${n(developers, 'developer')}`;
   if (over <= 0) return <p className="m-0 mt-2 text-xs text-ink-2">{said}.</p>;
   // the lowest in the order are the ones to park first
   const lowest = load.slice(-Math.min(3, over));
   return (
      <p className="m-0 mt-2 text-xs text-ink-2">
         {said}: <span className="text-warn">more than they can staff</span>. Lowest in priority
         order:{' '}
         {lowest.map((work, i) => (
            <Fragment key={`${work.slug}:${work.id}`}>
               {i > 0 && (i === lowest.length - 1 ? ' and ' : ', ')}
               <button type="button" onClick={() => onOpen(work)} className={textButton}>
                  {work.name}
               </button>
            </Fragment>
         ))}
         . {over === 1 ? 'Park it' : 'Park one'}, or finish something.
      </p>
   );
}

/**
 * Who runs Decide this week: with no product manager, the list needs a name
 * on it, so people take turns a week each. Changing the turns starts them
 * over from the first name this week.
 */
function RunsDecide({
   rotation,
   day,
   people,
   onPerson,
}: {
   rotation: DecideRotation | null;
   day: string;
   /** everyone on a team, to pick from */
   people: string[];
   onPerson?: (login: string) => void;
}) {
   const [draft, setDraft] = useState<string | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [saving, setSaving] = useState(false);
   const now = decideTurn(rotation, day);
   const next = decideTurn(rotation, addWeeks(day, 1));
   const close = () => {
      setDraft(null);
      setError(null);
   };
   const chosen = (draft ?? '').split(/[\s,]+/).filter(Boolean);
   const save = async () => {
      setSaving(true);
      const saved = await saveDecideRotation(chosen.length ? chosen : null);
      setSaving(false);
      if ('error' in saved) setError(saved.error);
      else close();
   };
   const person = (login: string) =>
      onPerson ? (
         <button
            type="button"
            onClick={() => onPerson(login)}
            title={`See ${login} on People`}
            className="hit pressable rounded border-0 bg-transparent p-0 text-[13px] font-medium text-ink hover:text-brand"
         >
            {login}
         </button>
      ) : (
         <span className="font-medium text-ink">{login}</span>
      );
   if (draft == null) {
      return (
         <p className="m-0 mt-2 text-[13px] text-ink-2">
            {now ? (
               <>
                  {person(now)} runs Decide this week
                  {next && next !== now && <>, {person(next)} next week</>}.
               </>
            ) : (
               'Nobody runs Decide yet.'
            )}{' '}
            <button
               type="button"
               onClick={() => setDraft(rotation?.logins.join(', ') ?? '')}
               className={linkButton}
            >
               {now ? 'Change the turns' : 'Name who takes turns'}
            </button>
         </p>
      );
   }
   const left = people.filter(login => !chosen.includes(login));
   return (
      <form
         className="mt-2 flex flex-wrap items-end gap-2"
         onSubmit={e => {
            e.preventDefault();
            void save();
         }}
         onKeyDown={e => {
            if (e.key === 'Escape') close();
         }}
      >
         <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-xs text-ink-3">
            Who takes turns running Decide, a week each, the first one this week
            <input
               autoFocus
               className={`px-2.5 ${textInputClass}`}
               value={draft}
               onChange={e => setDraft(e.target.value)}
               placeholder="GitHub logins, separated by commas or spaces"
            />
         </label>
         <span className="flex items-center gap-3">
            <PrimaryButton disabled={saving} aria-label="Save the turns">
               Save
            </PrimaryButton>
            <button
               type="button"
               onClick={close}
               aria-label="Cancel changing the turns"
               className={textButton}
            >
               Cancel
            </button>
         </span>
         {left.length > 0 && (
            <p className="m-0 flex basis-full flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
               Add
               {left.map(login => (
                  <button
                     key={login}
                     type="button"
                     onClick={() => setDraft([...chosen, login].join(', '))}
                     aria-label={`Add ${login} to the turns`}
                     className={textButton}
                  >
                     {login}
                  </button>
               ))}
            </p>
         )}
         {error && (
            <span role="alert" className="basis-full text-xs text-ink-2">
               {error}
            </span>
         )}
      </form>
   );
}

/**
 * Decide: the weekly triage a product manager would run, as a queue that
 * empties. Every row is a project or plan that needs a call, says why, with
 * the facts the call turns on, and asks one question. Each call (commit it
 * through a month or quarter, park, mark done, drop) is one click that
 * writes the roadmap; the row stays in place saying what was decided and
 * what happens next, with Undo, so nothing vanishes unexplained. Worst
 * first; a team's lead can take just theirs.
 */
export function Decide({
   today,
   items,
   closed,
   teamOf,
   teamMembers,
   rotation,
   work,
   ongoing,
   nav,
   navigate,
   onPerson,
}: {
   /** Today from every PR, not the filter bar's */
   today: Today;
   /** the portfolio from the same, for names, leads, sizes and teams */
   items: PortfolioItem[];
   closed: ReadonlyMap<string, ClosedIssue>;
   teamOf: (login: string) => string | null;
   teamMembers: Record<string, string[]>;
   /** who takes turns running this list; null for nobody */
   rotation: DecideRotation | null;
   /** each plan's PRs by the dates, and each project's issues (model/workData.ts) */
   work: WorkData | null | undefined;
   /** every project with no end, and the ones marked so on the board */
   ongoing: ReadonlySet<string>;
   nav: ProjectsNav;
   navigate: Navigate;
   /** open a person on People */
   onPerson?: (login: string) => void;
}) {
   const { items: plans, loadFailed } = useRoadmap();
   const { made } = calls.useValue();
   const [copied, setCopied] = useState<string | null>(null);
   // j and k land on each row's answer, or its Undo once decided
   useRowKeys('[data-decide-row]', '[data-decide-focus]');
   if (!plans) {
      return loadFailed ? (
         <LoadFailed what="the roadmap" onRetry={() => void loadRoadmap()} />
      ) : (
         <p className="m-0 text-[13px] text-ink-3">Loading the roadmap…</p>
      );
   }
   const day = dayOf(new Date());
   const bySlug = new Map(items.map(i => [i.slug, i]));
   const projectOf = (row: DecideRow) => (row.slug ? bySlug.get(row.slug) : undefined);
   // the team a row belongs to: its plan's, or the team most of its
   // developers are on, as the roadmap's lanes split them
   const teamOfRow = (row: DecideRow): string | null => {
      const project = projectOf(row);
      return row.item?.team ?? (project ? mainTeam(project, teamOf) : null);
   };
   const kept = keepCalls(decideRows(today, plans, closed, work, ongoing), made);
   const inTeam = (row: DecideRow) => !nav.team || (teamOfRow(row) ?? '(none)') === nav.team;
   const owed = kept.owed.filter(inTeam);
   const shown = kept.all.filter(inTeam);
   const decidedHere = [...kept.settled.values()].filter(m => inTeam(m.row));
   const whose = !nav.team ? '' : nav.team === '(none)' ? ' with no team' : ` for ${nav.team}`;
   const heading = owed.length
      ? `${n(owed.length, 'decision')} to make`
      : decidedHere.length
      ? 'Nothing left to decide'
      : 'Nothing to decide';

   // the list as plain text, for the weekly meeting's notes or a chat post:
   // what's left, and the calls made here
   const copy = () => {
      const left = SECTIONS.flatMap((section, index) => {
         const inSection = owed.filter(row => sectionOf(row) === index);
         if (!inSection.length) return [];
         return [
            section.title,
            ...inSection.map(row => {
               const lead = row.item?.lead ?? projectOf(row)?.lead;
               return `- ${nameOf(row, projectOf(row))}${lead ? ` (${lead})` : ''}: ${rowWords(
                  row
               )}`;
            }),
         ];
      });
      const decided = decidedHere.length
         ? ['Decided', ...decidedHere.map(m => `- ${nameOf(m.row, projectOf(m.row))}: ${m.words}`)]
         : [];
      const runner = decideTurn(rotation, day);
      const text = [
         `${heading}${whose}, ${dayWords(day)}`,
         ...(runner ? [`${runner} runs Decide this week`] : []),
         ...left,
         ...decided,
      ].join('\n');
      const say = (words: string) => {
         setCopied(words);
         window.setTimeout(() => setCopied(null), 2000);
      };
      if (!navigator.clipboard) return say('Couldn’t copy');
      navigator.clipboard.writeText(text).then(
         () => say('Copied'),
         () => say('Couldn’t copy')
      );
   };

   // each team's decisions still owed, for the team switch: "Store · 2",
   // never a zero
   const teams = Object.keys(teamMembers).sort();
   const owedBy = (team: string) =>
      kept.owed.filter(row => (teamOfRow(row) ?? '(none)') === team).length;
   const counted = (label: string, count: number) => (count ? `${label} · ${count}` : label);
   const people = [...new Set(Object.values(teamMembers).flat())].sort();
   return (
      <section className="mb-7">
         <div className="mb-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
               <h2 className="m-0 text-lg font-semibold leading-snug">
                  {heading}
                  {whose}
               </h2>
               {(owed.length > 0 || decidedHere.length > 0) && (
                  <button
                     type="button"
                     onClick={copy}
                     className={`${textButton} ml-auto`}
                     title="Copy what’s left and the calls made here as plain text, for the meeting’s notes or a chat post"
                  >
                     {copied ?? 'Copy as text'}
                  </button>
               )}
               <span role="status" className="sr-only">
                  {copied ?? ''}
               </span>
            </div>
            {owed.length > 0 && (
               <p className="m-0 mt-1 text-[13px] text-ink-2">
                  Worst first. Each call saves to the roadmap when you click it.
               </p>
            )}
            <RunsDecide rotation={rotation} day={day} people={people} onPerson={onPerson} />
            {teams.length > 0 && (
               <div className="mt-3">
                  <Segmented
                     ariaLabel="team"
                     value={nav.team ?? ''}
                     options={[
                        ['', counted('All teams', kept.owed.length)],
                        ...teams.map((t): [string, string] => [t, counted(t, owedBy(t))]),
                        ['(none)', counted('No team', owedBy('(none)'))],
                     ]}
                     onChange={t => navigate({ team: t || null })}
                  />
                  {nav.team && nav.team !== '(none)' && (
                     <TeamLoad
                        team={nav.team}
                        developers={teamMembers[nav.team]?.length ?? 0}
                        load={teamLoad(nav.team, plans, items, day)}
                        onOpen={w =>
                           w.slug
                              ? navigate({ project: w.slug })
                              : w.id != null && navigate(openPlan(nav, w.id))
                        }
                     />
                  )}
               </div>
            )}
         </div>
         {!shown.length && (
            <>
               <EmptyState
                  title={
                     !nav.team
                        ? 'Every project has its call'
                        : nav.team === '(none)'
                        ? 'Every project with no team has its call'
                        : `Every ${nav.team} project has its call`
                  }
                  sub={
                     nav.team && kept.owed.length
                        ? 'The other teams have calls waiting.'
                        : 'Rows show up here when work needs a plan or stalls, runs past its end or target, or its records disagree.'
                  }
               />
               {nav.team && kept.owed.length > 0 && (
                  <p className="m-0 text-center">
                     <button
                        type="button"
                        onClick={() => navigate({ team: null })}
                        className={linkButton}
                     >
                        Show all teams
                     </button>
                  </p>
               )}
            </>
         )}
         {SECTIONS.map((section, index) => {
            const here = shown.filter(row => sectionOf(row) === index);
            if (!here.length) return null;
            return (
               <div key={section.kinds[0]} className="mb-6">
                  <GroupHeader
                     level={3}
                     title={section.title}
                     sub={
                        <SubDoor label={`What lands in ${section.title}`} text={section.sub}>
                           {section.more.map(words => (
                              <p key={words} className="m-0">
                                 {words}
                              </p>
                           ))}
                        </SubDoor>
                     }
                     count={here.filter(row => !kept.settled.has(rowKey(row))).length}
                  />
                  <Rows>
                     <Truncated cap={10} id={`decide:${section.kinds[0]}`}>
                        {here.map(row => (
                           <DecideRowView
                              key={rowKey(row)}
                              row={row}
                              decided={kept.settled.has(rowKey(row))}
                              project={projectOf(row)}
                              team={teamOfRow(row)}
                              nav={nav}
                              navigate={navigate}
                              onPerson={onPerson}
                           />
                        ))}
                     </Truncated>
                  </Rows>
               </div>
            );
         })}
      </section>
   );
}
