import {
   useCallback,
   useEffect,
   useId,
   useMemo,
   useRef,
   useState,
} from 'react';
import { Check } from 'lucide-react';
import { epoch, issueUrl, n } from '../../../../shared/format';
import {
   compareRows,
   decideProjects,
   decideQueue,
   type ClosedIssue,
   type DecideReason,
   type DecideRow,
   type GrownProject,
} from '../../../../shared/model/decide';
import type { Initiative } from '../../../../shared/model/initiatives';
import { projectSlugs, type Today } from '../../../../shared/model/projects';
import { decideTurn, type DecideRotation } from '../../../../shared/model/settings';
import {
   addWeeks,
   healthStanding,
   isUnderWay,
   type RoadmapItem,
   type RoadmapOrigin,
   type Vouch,
} from '../../../../shared/model/roadmap';
import type { DerivedPull } from '../../../../shared/model/status';
import {
   issueKey,
   type IssueRef,
   type ProjectIssue,
   type ProjectWork,
} from '../../../../shared/model/work';
import type { PullData } from '../../../../shared/types';
import {
   ClosedBadge,
   EmptyState,
   FactLink,
   LoadFailed,
   PrimaryButton,
   QuietButton,
   Segmented,
   textInputClass,
} from '../../components/bits';
import { Icon } from '../../components/Icon';
import { ClosedRow } from '../../components/ClosedRow';
import { Fold, GroupHeader, Rows, SubDoor, Truncated } from '../../components/Lane';
import { Row, type RowOptions } from '../../components/Row';
import { useRowKeys } from '../../components/useRowKeys';
import { mainTeam, type PortfolioItem } from '../../model/portfolio';
import { teamLoad, type InFlight } from '../../model/teamLoad';
import { dayOf, dayWords } from '../../model/projectData';
import { changeProjectIssue, useProjectWork } from '../../model/projectWork';
import { saveDecideRotation, setOngoing } from '../../model/settingsData';
import {
   fileProject,
   readInitiatives,
   updateInitiative,
   type Home,
} from '../../model/initiativesData';
import { NO_PROJECT, UNSORTED } from '../../model/initiativeBoard';
import { homesOf } from '../../../../shared/model/initiatives';
import {
   ALL_ISSUES_CLOSED,
   andList,
   BEING_WORKED_ON,
   COMMIT_THROUGH,
   COPY_AS_TEXT,
   DONE_WHEN,
   GOAL,
   IN_PROGRESS,
   LAST_14_DAYS,
   ONGOING,
   PLAN_IT,
   targetOn,
   UNSORTED_WORD,
} from '../../model/words';
import type { WorkData } from '../../model/workData';
import {
   createRoadmapItem,
   dismissRoadmapProblem,
   loadRoadmap,
   readRoadmap,
   removeRoadmapItem,
   updateRoadmapItem,
   useRoadmap,
   storedStatus,
} from '../../model/roadmapData';
import { createMemoryStore, readSessionStorage, writeSessionStorage } from '../../storage';
import {
   ByPrs,
   openPageAt,
   openPlan,
   ORIGIN_OPTIONS,
   targetWords,
   type Navigate,
   type ProjectsNav,
} from './parts';
import { vouchWords } from './roadmapHealth';
import {
   answerOf,
   answerWords,
   arrowsAmong,
   askAll,
   askedInitiative,
   askOf,
   bulkWords,
   callWords,
   endsFor,
   filedWhere,
   isHomeCall,
   isHomeReason,
   kindsOf,
   midLine,
   nameOf,
   ongoingPlan,
   primaryOf,
   reasonFacts,
   rowKey,
   rowWords,
   sectionOf,
   SECTIONS,
   sharedAsk,
   stop,
   upperFirst,
   writeFor,
   type Call,
   type Filed,
   type HomeCall,
} from '../../model/decideCalls';
import {
   forgetHomePick,
   HomeChooser,
   HomeStrip,
   InitiativeSwitch,
   useChosenHomes,
   useHomeChooser,
} from './HomeCalls';

/** The decisions owed now, worst first, for this view, the tab's label and
 * the Overview's tile. `today` and `items` are the tracked ones; the
 * initiatives raise the questions about where projects belong, and `grown`
 * names the Not tracked projects that grew, which `today` leaves out. */
export function decideRows(
   today: Today,
   items: readonly RoadmapItem[],
   closed: ReadonlyMap<string, ClosedIssue>,
   work: WorkData | null | undefined = null,
   ongoing: ReadonlySet<string> = new Set(),
   {
      initiatives = [],
      grown = [],
   }: { initiatives?: readonly Initiative[]; grown?: readonly GrownProject[] } = {}
): DecideRow[] {
   return decideQueue({
      initiatives,
      grown,
      live: decideProjects(today),
      items,
      closed,
      planCounts: new Map(
         [...(work?.plans ?? [])].map(([id, w]) => [
            id,
            {
               openPulls: w.openPulls,
               afterEnd: w.afterEnd.length,
               afterDone: w.afterDone.length,
            },
         ])
      ),
      issues: work?.projects,
      ongoing,
      today: dayOf(new Date()),
      now: Date.now() / 1000,
   });
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
   /** made, or taken back, by its section's one click: Undo all takes it
    * back, and the section says what happened rather than each row */
   batch?: boolean;
   /** the filing that rode along with a plan call (the row's chooser) */
   filed?: Filed;
   /** that filing saved though the plan didn't: Try again leaves it be */
   filedBefore?: Home;
}

// the calls made since the page loaded, so a trip to a project's page and
// back still shows them
const calls = createMemoryStore<{ made: ReadonlyMap<string, Made> }>({
   made: new Map(),
});

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
 * a change to the plan, unless it was never asked: work parked from a team's
 * load.
 */
export function keepCalls(
   queue: readonly DecideRow[],
   made: ReadonlyMap<string, Made>
): { owed: DecideRow[]; all: DecideRow[]; settled: ReadonlyMap<string, Made> } {
   const byKey = new Map(queue.map(row => [rowKey(row), row]));
   const settled = new Map<string, Made>();
   // answered about its home, still asked about its plan: owed, so every
   // other view keeps the plan in sight, while this row keeps its receipt
   const pending = new Set<string>();
   const back: DecideRow[] = [];
   for (const [key, m] of made) {
      const again = byKey.get(key);
      if (m.state !== 'made') {
         if (!again && m.row.reasons.length) back.push(m.row);
      } else if (!again || kindsOf(again) === kindsOf(m.row)) {
         settled.set(key, m);
      } else if (answeredHome(m, again)) {
         settled.set(key, m);
         pending.add(key);
      }
   }
   const owed = [
      ...queue.filter(row => !settled.has(rowKey(row)) || pending.has(rowKey(row))),
      ...back,
   ].sort(compareRows);
   const all = [
      ...owed.filter(row => !settled.has(rowKey(row))),
      ...[...settled.values()].map(m => m.row),
   ].sort(compareRows);
   return { owed, all, settled };
}

/** A filing or status call on a row that also asked about its plan: the
 * row comes back with only the plan's reasons, which it asks on the next
 * visit, so this one keeps the receipt and its Undo. */
const answeredHome = (m: Made, again: DecideRow) =>
   isHomeCall(m.call) &&
   kindsOf(again) === kindsOf({ ...m.row, reasons: m.row.reasons.filter(r => !isHomeReason(r)) });

/** keepCalls on this visit's calls, for a view that lists Decide's rows. */
export function useKeptCalls(queue: readonly DecideRow[]) {
   const { made } = calls.useValue();
   return useMemo(() => keepCalls(queue, made), [queue, made]);
}

/**
 * keepCalls on the calls still owed (`owed`, Decide's queue with this
 * visit's calls kept) and the ones made since this view opened: a view that
 * answers in place keeps a row it answered there, with its receipt (`all`,
 * `settled`), while a call made elsewhere before it opened is simply done.
 */
export function useCallsMadeHere(owed: readonly DecideRow[]) {
   const { made } = calls.useValue();
   const [since] = useState(() => tokens);
   return useMemo(
      () => keepCalls(owed, new Map([...made].filter(([, m]) => m.token > since))),
      [owed, made, since]
   );
}

/**
 * The row a project's strip answers under its plan, where Decide asks
 * nothing of it: a call made there on this plan while it stands, so its
 * receipt and Undo stay where the click was, even once the call has made
 * the plan; else the plan, or, for work with no plan, the calls that start
 * one. `kept` is the project's rows with this visit's calls kept.
 */
export function planRow(
   slug: string,
   plan: RoadmapItem | null,
   kept: readonly DecideRow[]
): DecideRow {
   return (
      kept.find(row => !row.reasons.length && (!row.item || row.item.id === plan?.id)) ?? {
         slug,
         item: plan,
         reasons: [],
      }
   );
}

/**
 * A plan's calls for a page that edits the plan as fields (the project
 * page's Status and End): the call Decide suggests, the ends it offers, the
 * receipt of a call made here, and the ways to make, retry, undo or clear
 * one. The same calls and store as DecideCall, so Decide's row clears and
 * its Undo works from either place.
 */
export function usePlanCalls(row: DecideRow, project?: PortfolioItem) {
   const made = calls.useValue().made.get(rowKey(row));
   const mine = made && kindsOf(made.row) === kindsOf(row) ? made : undefined;
   const receipt = mine?.state === 'made' || mine?.state === 'failed' ? mine : undefined;
   const today = dayOf(new Date());
   return {
      answer: answerOf(row, project, today),
      ends: endsFor(row, project, today),
      receipt,
      make: (call: Call) => void makeCall(row, call, project),
      retry: () => receipt && void makeCall(receipt.row, receipt.call, project),
      undo: () => void undoCall(rowKey(row)),
      clear: () => setMade(rowKey(row), null),
   };
}

/** How many of a section's rows to draw before its "+ N more": enough for
 * `owed` rows still owed, so the rows decided here ride along without
 * taking the slots, and deciding never hides what's left. */
export function capOwed(
   rows: readonly DecideRow[],
   decided: (row: DecideRow) => boolean,
   owed: number
): number {
   let left = owed;
   const past = rows.findIndex(row => !decided(row) && --left < 0);
   return past < 0 ? rows.length : past;
}

// each row's writes run one after another, so an Undo or a "where it came
// from" waits for the call it follows instead of racing it; `after` holds
// a write back until another is done, so a section's calls go one by one.
// The promise it gives settles when the write is done, whatever happened.
const chains = new Map<string, Promise<unknown>>();
function afterRow(
   key: string,
   write: () => Promise<unknown>,
   after?: Promise<unknown>
): Promise<unknown> {
   const next = Promise.all([chains.get(key), after])
      .then(write)
      .catch(() => undefined);
   chains.set(key, next);
   return next;
}

// the calls whose save landed, by token, with what they wrote: the plan,
// the home a filing replaced, the initiative as a status change found it.
// What Undo takes back
interface Landed {
   id: number | null;
   home?: { project: string; before: Home };
   /** the plan a link gave a project */
   linked?: number;
   initiative?: {
      id: number;
      was: { status: Initiative['status']; updated_at: number | null; status_at: number | null };
   };
}
const landed = new Map<number, Landed>();

/** A project's home slug now, or null for none. */
const homeSlugOf = (slug: string | null) =>
   (slug && homesOf(readInitiatives().initiatives ?? []).get(slug)?.initiative.slug) ?? null;

/** Write a filing or an initiative's status: what a call on a row that asks
 * where a project belongs saves. Resolves to what Undo needs, or why not. */
async function homeWrite(
   row: DecideRow,
   call: HomeCall
): Promise<Omit<Landed, 'id'> | { why: string }> {
   const slug = row.slug;
   if (call.kind === 'link') {
      if (!row.item) return { why: '' };
      return (await updateRoadmapItem(row.item.id, { project: call.project }))
         ? { linked: row.item.id }
         : { why: takeProblem() };
   }
   if (call.kind === 'file' || call.kind === 'keep_untracked') {
      if (!slug) return { why: '' };
      const r = await fileProject(slug, call.to, { expect: homeSlugOf(slug) });
      return 'error' in r
         ? { why: whyNot(r.error) }
         : { home: { project: slug, before: r.before } };
   }
   const id = askedInitiative(row);
   if (id == null) return { why: '' };
   const r =
      call.kind === 'close'
         ? await updateInitiative(id, { status: call.as })
         : await updateInitiative(id, { status: 'open' }, { restate: call.kind === 'keep_open' });
   if ('error' in r) {
      const live = r.live?.length ? ` Still going in it: ${andList(r.live)}.` : '';
      return { why: `${whyNot(r.error)}${live}` };
   }
   return {
      initiative: {
         id,
         was: { status: r.was.status, updated_at: r.was.updated_at, status_at: r.was.status_at },
      },
   };
}
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

function makeCall(
   row: DecideRow,
   call: Call,
   project: PortfolioItem | undefined,
   batch?: { after: Promise<unknown> },
   filed?: Filed,
   filedBefore?: Home
): Promise<unknown> {
   const key = rowKey(row);
   const token = ++tokens;
   const today = dayOf(new Date());
   // shown as made at once, so nothing moves while it saves
   setMade(key, {
      row,
      call,
      words: callWords(call, row, project, today, filed),
      state: 'made',
      origin: row.item?.origin ?? null,
      token,
      batch: !!batch,
      filed,
   });
   // the pick is in the call now: no later answer carries it
   if (row.slug) forgetHomePick(row.slug);
   return afterRow(
      key,
      async () => {
         const done: Landed = { id: null };
         let why: string | null = null;
         // the filing goes first: if the plan then fails, the project stays
         // filed, which is harmless, and Try again doesn't file it twice
         if (filed && row.slug) {
            if (filedBefore) done.home = { project: row.slug, before: filedBefore };
            else {
               const r = await fileProject(row.slug, filed.to, { expect: filed.from });
               if ('error' in r) why = whyNot(r.error);
               else done.home = { project: row.slug, before: r.before };
            }
         }
         if (why != null) {
            // nothing saved
         } else if (isHomeCall(call)) {
            const r = await homeWrite(row, call);
            if ('why' in r) why = r.why;
            else Object.assign(done, r);
         } else if (call.kind === 'ongoing' && row.item && ongoingPlan(row)) {
            if (await updateRoadmapItem(row.item.id, { end_kind: 'ongoing' }))
               done.id = row.item.id;
            else why = takeProblem();
         } else if (call.kind === 'ongoing') {
            const saved = await setOngoing(row.slug as string, true);
            if ('error' in saved) why = whyNot(saved.error);
         } else {
            const write = writeFor(call, row, project, today);
            if (write.id != null) {
               const ok = await updateRoadmapItem(write.id, write.fields, {
                  restate: write.restate,
               });
               if (ok) done.id = write.id;
               else why = takeProblem();
            } else {
               done.id = (await createRoadmapItem(write.fields))?.id ?? null;
               if (done.id == null) why = takeProblem();
            }
         }
         if (why == null) landed.set(token, done);
         else
            patchMade(key, token, 'made', { state: 'failed', why, filedBefore: done.home?.before });
      },
      batch?.after
   );
}

/** Take a call back: the plan as it was (its end's kind too), the new plan
 * gone, or the project no longer ongoing; then the home a filing replaced,
 * or the initiative's status as it was. */
function undoCall(key: string, batch?: { after: Promise<unknown> }): Promise<unknown> {
   const made = calls.get().made.get(key);
   if (!made) return Promise.resolve();
   // the row's own Undo speaks for itself, and takes it out of Undo all
   setMade(key, { ...made, state: 'undone', why: undefined, batch: !!batch });
   return afterRow(
      key,
      async () => {
         const saved = landed.get(made.token);
         // a call that never saved has nothing to take back
         if (!saved) return;
         let why: string | null = null;
         const was = made.row.item;
         if (saved.linked != null) {
            // with the times the link replaced, as a plan call's Undo sends
            const undo =
               was?.updated_at != null
                  ? { updated_at: was.updated_at, status_at: was.status_at ?? null }
                  : undefined;
            if (!(await updateRoadmapItem(saved.linked, { project: null }, { undo })))
               why = takeProblem();
         } else if (isHomeCall(made.call)) {
            // a filing or a status: no plan to put back
         } else if (made.call.kind === 'ongoing' && !ongoingPlan(made.row)) {
            const r = await setOngoing(made.row.slug as string, false);
            if ('error' in r) why = whyNot(r.error);
         } else if (was) {
            const fields = {
               status: storedStatus(was),
               start: was.start,
               weeks: was.weeks,
               end_kind: was.end_kind,
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
         // then the home it had, with its time and count, so a Kept growth
         // row comes back rather than starting its count again
         if (why == null && saved.home) {
            const { project: slug, before } = saved.home;
            const r = await fileProject(slug, before.initiative, {
               set_at: before.set_at,
               baseline_prs: before.baseline_prs,
            });
            if ('error' in r) why = whyNot(r.error);
         }
         if (why == null && saved.initiative) {
            const { id, was: then } = saved.initiative;
            const r = await updateInitiative(
               id,
               { status: then.status },
               {
                  undo: {
                     updated_at: then.updated_at ?? Math.floor(Date.now() / 1000),
                     status_at: then.status_at,
                  },
               }
            );
            if ('error' in r) why = whyNot(r.error);
         }
         if (why == null) landed.delete(made.token);
         else
            patchMade(key, made.token, 'undone', {
               state: 'made',
               why: `Undo didn’t save.${why}`,
            });
      },
      batch?.after
   );
}

/** A section's calls, or their Undos, all shown at once and saved one after
 * another through the same path as a row's own click. */
function inTurn(each: ((after: Promise<unknown>) => Promise<unknown>)[]): void {
   each.reduce<Promise<unknown>>((after, write) => write(after), Promise.resolve());
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

/**
 * The calls a row can get, one click each, and once one is made, what was
 * decided and what happens next, with Undo. The question the row's reason
 * asks has one answer, the filled button marked Suggested. Works wherever a
 * Decide row shows: this view, an Overview row and the roadmap's plan
 * details. Where nothing is asked (a plan in an Overview row), the calls
 * rest behind Change, or Plan it, and open with nothing suggested: a
 * suggested answer there would be a call nobody asked for, one click away.
 */
export function DecideCall({
   row,
   project,
   describedBy,
   change = 'Change',
   opened = false,
   compact = false,
}: {
   row: DecideRow;
   /** its project, for a new plan's start, team and lead, and for what
    * happens next */
   project?: PortfolioItem;
   /** the element that says why the row is here, read with its answer */
   describedBy?: string;
   /** the words that open the calls on a plan nobody asked about: "Change
    * the plan" where they sit away from the plan's own words */
   change?: string;
   /** the calls open from the start, with no Cancel: a place someone opened
    * to change the plan (the roadmap's plan details), where they're the point */
   opened?: boolean;
   /** on a one-line row under a section that asks its question once: the
    * answer an outlined button at the line's end, since the section's one
    * click is the filled one */
   compact?: boolean;
}) {
   const made = calls.useValue().made.get(rowKey(row));
   // a call made on the row as it stood; a row back for a new reason is asked afresh
   const mine = made && kindsOf(made.row) === kindsOf(row) ? made : undefined;
   const shown = mine?.state === 'made' || mine?.state === 'failed' ? mine : undefined;
   const name = nameOf(row, project);
   const rootRef = useRef<HTMLDivElement>(null);
   const receiptRef = useRef<HTMLDivElement>(null);
   const refocus = useRef(false);
   // the receipt's height when its Undo was clicked here: the words "Put X
   // back as it was." hold that slot, and the answers come back below it,
   // so a second click on Undo lands on words, never on an answer
   const [undid, setUndid] = useState<number | null>(null);
   // the height the row had when a click here changed it, kept as the least
   // it has, so the rows below never slide under the pointer, a phone's
   // wrapped lines included
   const [held, setHeld] = useState<number>();
   // opened from Change; it stays open through a call and its Undo
   const [open, setOpen] = useState(opened);
   const view = shown?.state ?? (row.reasons.length || open ? 'ask' : 'rest');
   // where a new or unfiled project goes, filed with its plan call
   const chooser = useHomeChooser(row);
   const before = useRef(view);
   // after a click here, focus lands on what replaced the button: what was
   // decided, Try again, the row's answer, or Change again; a save or an
   // Undo that fails later takes the focus only when it removed the focused
   // control
   useEffect(() => {
      if (before.current === view) return;
      before.current = view;
      const lost = document.activeElement === document.body && view !== 'ask';
      if (!refocus.current && !lost) return;
      refocus.current = false;
      rootRef.current?.querySelector<HTMLElement>('[data-decide-focus]')?.focus();
   }, [view]);
   const act = (fn: () => void) => () => {
      refocus.current = true;
      setHeld(rootRef.current?.offsetHeight);
      fn();
   };
   // a call made here is read where the focus lands, so only what changes
   // later is said here: a failure, an Undo, a part that didn't save. A
   // section's one click says what it did for every row at once
   const said = !mine
      ? ''
      : mine.state === 'made'
      ? mine.why ?? ''
      : mine.batch
      ? ''
      : mine.state === 'failed'
      ? `Didn’t save the decision on ${name}.${mine.why ?? ''}`
      : // undone here, the focus lands on the same words in the row
      undid != null
      ? ''
      : `Put ${name} back as it was.`;
   const live = (
      <span className="sr-only" aria-live="polite">
         {said}
      </span>
   );
   if (view === 'rest') {
      // on the plan's own line, after its words
      return (
         <div ref={rootRef} className="inline">
            {live}{' '}
            <QuietButton
               data-decide-focus
               aria-label={row.item ? `Change the plan for ${name}` : `Plan ${name}`}
               onClick={act(() => setOpen(true))}
            >
               {row.item ? change : PLAN_IT}
            </QuietButton>
         </div>
      );
   }
   // taken back here: its words where the receipt was, the answers after
   const putBack = undid != null && mine?.state === 'undone' && !mine.batch && (
      <p
         data-decide-focus
         tabIndex={-1}
         className="m-0 flex items-center rounded text-[13px] text-ink-2"
         style={{ minHeight: undid }}
      >
         Put {name} back as it was.
      </p>
   );
   return (
      <div ref={rootRef} className={compact ? 'ml-auto' : 'mt-1.5'} style={{ minHeight: held }}>
         {live}
         {putBack}
         {shown?.state === 'failed' ? (
            <p className="m-0 flex min-h-[30px] flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
               <span aria-hidden>
                  {shown.filed && shown.filedBefore
                     ? `${
                          shown.filed.untracked ? 'Set not tracked' : `Filed in ${shown.filed.name}`
                       }; the plan didn’t save.`
                     : 'Didn’t save.'}
                  {shown.why}
               </span>
               <QuietButton
                  data-decide-focus
                  onClick={act(() =>
                     makeCall(
                        shown.row,
                        shown.call,
                        project,
                        undefined,
                        shown.filed,
                        shown.filedBefore
                     )
                  )}
                  aria-label={`Try the decision on ${name} again`}
               >
                  Try again
               </QuietButton>
               <QuietButton
                  onClick={act(() => setMade(rowKey(row), null))}
                  aria-label={`Cancel the decision on ${name}`}
               >
                  Cancel
               </QuietButton>
            </p>
         ) : shown ? (
            <div
               ref={receiptRef}
               className="flex min-h-[30px] flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2"
            >
               {/* one run of text, so Undo shares the words' last line and
                   the receipt is no taller than the calls it replaced */}
               <span>
                  <Icon icon={Check} size={14} className="mr-1.5 inline-block align-[-2px]" />
                  {/* the focus lands on what was decided, not on Undo, so an
                      extra Enter after a call, or j then Enter on a decided
                      row, never takes it back: Undo is the next Tab */}
                  <span data-decide-focus tabIndex={-1} className="rounded">
                     {shown.words}
                     {shown.why && ` ${shown.why}`}
                  </span>{' '}
                  <QuietButton
                     onClick={act(() => {
                        setUndid(receiptRef.current?.offsetHeight ?? 0);
                        undoCall(rowKey(row));
                     })}
                     aria-label={`Undo the decision on ${name}`}
                  >
                     Undo
                  </QuietButton>
               </span>
               {shown.call.kind !== 'ongoing' && !isHomeCall(shown.call) && (
                  // optional, after the call: saying it alone never clears a row
                  <OriginRun
                     name={name}
                     origin={shown.origin}
                     onChange={o => sayOrigin(rowKey(row), o)}
                  />
               )}
            </div>
         ) : row.reasons.length && isHomeReason(primaryOf(row)) ? (
            <HomeStrip
               row={row}
               name={name}
               describedBy={describedBy}
               onCall={call => act(() => makeCall(row, call, project))()}
            />
         ) : (
            <>
               {/* where it goes, then the answer that files it there */}
               {chooser.shown && <HomeChooser name={name} chooser={chooser} />}
               <CallStrip
                  row={row}
                  name={name}
                  project={project}
                  describedBy={describedBy}
                  waiting={chooser.shown && !chooser.chosen}
                  alsoFiles={chooser.filed && filedWhere(chooser.filed)}
                  onCall={call =>
                     act(() => makeCall(row, call, project, undefined, chooser.filed))()
                  }
                  onCancel={row.reasons.length || opened ? undefined : act(() => setOpen(false))}
                  full={opened}
                  quiet={compact}
               />
            </>
         )}
      </div>
   );
}

/** Where a decided plan's work came from: optional, after the call, the
 * same switch as the roadmap's editor. */
function OriginRun({
   name,
   origin,
   onChange,
}: {
   name: string;
   origin: RoadmapOrigin | null;
   onChange: (origin: RoadmapOrigin | null) => void;
}) {
   return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
         Where it came from
         <Segmented
            value={origin ?? 'unsaid'}
            options={ORIGIN_OPTIONS}
            onChange={o => onChange(o === 'unsaid' ? null : o)}
            ariaLabel={`Where ${name} came from`}
         />
      </span>
   );
}

/** One call a row can get, in words. */
interface Option {
   call: Call;
   label: string;
   /** what it does to which row, for a screen reader */
   ariaLabel: string;
}

/** The calls, before one is made, as real buttons in two labeled rows: the
 * ends it can promise, then what else becomes of it. The row's answer is
 * filled and says Suggested. With an answer, the strip starts as that one
 * button and Other answers, which opens the two rows in place. One Tab
 * stop, the answer or else the first call; the arrow keys reach the rest,
 * and Escape is Cancel where there's one. */
function CallStrip({
   row,
   name,
   project,
   describedBy,
   onCall,
   onCancel,
   full = false,
   quiet = false,
   waiting = false,
   alsoFiles,
}: {
   row: DecideRow;
   name: string;
   /** its project, for its target */
   project: PortfolioItem | undefined;
   /** the File it in chooser above has nothing picked: the answer waits
    * for it, outlined and unmarked, as the chooser's own File button does */
   waiting?: boolean;
   /** where the call files the project too ("in Release safety"), said to
    * a screen reader with each answer */
   alsoFiles?: string;
   describedBy?: string;
   onCall: (call: Call) => void;
   /** close it again, for calls opened from Change */
   onCancel?: () => void;
   /** every call shown from the start, where changing the plan is the point */
   full?: boolean;
   /** the answer outlined and unmarked: its section's header asks the
    * question and holds the filled button */
   quiet?: boolean;
}) {
   const [more, setMore] = useState(false);
   const stripRef = useRef<HTMLDivElement>(null);
   const day = dayOf(new Date());
   const answer = answerOf(row, project, day);
   // ongoing answers new work, finished work that keeps going, and any plan
   // under way that has an end: upkeep one click from its end
   const ongoing =
      (!!row.slug &&
         row.reasons.some(
            r => r.kind === 'new' || (r.kind === 'reopened' && r.by === 'roadmap')
         )) ||
      (ongoingPlan(row) && row.item?.end_kind !== 'ongoing');
   const dates: Option[] = endsFor(row, project, day).map(c => ({
      call: { kind: 'commit', ...c },
      label: c.label,
      ariaLabel: `Promise ${name} by ${c.through}`,
   }));
   const others: Option[] = [
      { call: { kind: 'park' }, label: 'Park', ariaLabel: `Park ${name}` },
      {
         call: { kind: 'done' },
         label: 'Mark done',
         ariaLabel: `Mark ${name} done`,
      },
      { call: { kind: 'drop' }, label: 'Drop', ariaLabel: `Drop ${name}` },
      ...(ongoing
         ? [
              {
                 call: { kind: 'ongoing' } as Call,
                 label: ONGOING,
                 ariaLabel: `Mark ${name} ongoing`,
              },
           ]
         : []),
   ];
   // a commit's answer is its target or the nearest end that doesn't cut
   // the plan short
   const first =
      answer &&
      (answer.kind === 'commit'
         ? dates.find(o => o.call.kind === 'commit' && o.call.end === answer.end)
         : others.find(o => o.call.kind === answer.kind));
   // the strip's one Tab stop
   const lead = first ?? dates[0] ?? others[0];
   // every call a button that looks like one, in two labeled rows: how
   // long it runs, or what else becomes of it. The suggested answer is
   // filled and says so; the rest are outlined, never bare words.
   // opened from Other answers, a quiet row's answer says Suggested again
   const marked = (!quiet || more || full) && !waiting;
   const button = (o: Option, words = o.label) => (
      <button
         key={o.label}
         type="button"
         tabIndex={o === lead ? 0 : -1}
         data-decide-focus={o === lead || undefined}
         aria-describedby={o === lead ? describedBy : undefined}
         aria-label={alsoFiles ? `${o.ariaLabel}, ${alsoFiles}` : o.ariaLabel}
         disabled={waiting && o === first}
         title={waiting && o === first ? 'Choose where it goes first' : undefined}
         onClick={() => onCall(o.call)}
         className={`hit pressable inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium disabled:opacity-60 ${
            o === first && marked
               ? 'border-brand bg-brand text-surface hover:opacity-90'
               : 'border-line bg-surface text-ink-2 hover:border-brand hover:text-brand'
         }`}
      >
         {words}
         {o === first && marked && (
            <span className="text-[11px] font-normal opacity-80">Suggested</span>
         )}
      </button>
   );
   // opened, the focus moves to the first of the answers it showed
   const showMore = () => {
      setMore(true);
      requestAnimationFrame(() =>
         stripRef.current?.querySelector<HTMLElement>('button:not([data-decide-focus])')?.focus()
      );
   };
   const group = (label: string, options: Option[]) =>
      options.length > 0 && (
         <div className="flex flex-wrap items-center gap-2">
            <span className="w-full text-xs text-ink-3 sm:w-32 sm:shrink-0">{label}</span>
            {options.map(o => button(o))}
         </div>
      );
   if (first && !full && !more) {
      return (
         <div
            role="toolbar"
            aria-label={`Decisions for ${name}`}
            onKeyDown={arrowsAmong}
            className="flex flex-wrap items-center gap-2"
         >
            {button(first, answerWords(first.call, row.item))}
            <button
               type="button"
               tabIndex={-1}
               aria-expanded={false}
               aria-label={`Other answers for ${name}`}
               onClick={showMore}
               className="hit pressable inline-flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-ink-2 hover:border-brand hover:text-brand"
            >
               Other answers
            </button>
         </div>
      );
   }
   return (
      <div
         ref={stripRef}
         role="toolbar"
         aria-label={`Decisions for ${name}`}
         onKeyDown={e => {
            if (e.key !== 'Escape' || !onCancel) return arrowsAmong(e);
            e.preventDefault();
            onCancel();
         }}
         className="flex flex-col gap-2"
      >
         {group(COMMIT_THROUGH, dates)}
         {group('Or instead', others)}
         {onCancel && (
            <div>
               <QuietButton tabIndex={-1} onClick={onCancel} aria-label={`Cancel changing ${name}`}>
                  Cancel
               </QuietButton>
            </div>
         )}
      </div>
   );
}

/** Its lead, the one fact a card shows beside its name; only the lead goes
 * anywhere (People), and the row's name opens the project. A lead guessed
 * from PRs is followed by the word guessed, unless its section says it once
 * for every row. */
function RowLead({
   row,
   project,
   onPerson,
   sayGuessed = true,
   noRepo = false,
}: {
   row: DecideRow;
   project: PortfolioItem | undefined;
   onPerson?: (login: string) => void;
   sayGuessed?: boolean;
   /** no projects repo, so no issue to assign */
   noRepo?: boolean;
}) {
   const lead = row.item?.lead ?? project?.lead ?? null;
   if (!lead) return null;
   const byPrs = sayGuessed && guessedLead(row, project);
   return (
      <>
         {onPerson ? (
            <FactLink
               tabIndex={-1}
               className="text-xs"
               onClick={() => onPerson(lead)}
               title={`See ${lead} on People`}
            >
               {lead}
            </FactLink>
         ) : (
            <span className="text-xs text-ink-2">{lead}</span>
         )}
         {byPrs && (
            <span className="text-xs">
               <ByPrs noRepo={noRepo} />
            </span>
         )}
      </>
   );
}

/** A lead nobody named: the plan names none, and the project's is the one
 * with the most PRs. */
const guessedLead = (row: DecideRow, project: PortfolioItem | undefined) =>
   !row.item?.lead && !!project?.lead && !!project.leadByPrs;

/** The rest of what a decision turns on, for the reason's hover: team,
 * people and size, target date. */
function factsTitle(
   row: DecideRow,
   project: PortfolioItem | undefined,
   team: string | null
): string {
   const people = project ? [...project.developers, ...project.nonDevelopers] : [];
   // a missed target is the row's reason already
   const target =
      project?.target && !row.reasons.some(r => r.kind === 'missed') ? project.target : null;
   return [
      team,
      people.length ? people.join(', ') : null,
      project?.open ? n(project.open, 'open PR') : null,
      project?.merged ? `${project.merged} merged in the ${LAST_14_DAYS}` : null,
      target && targetOn(targetWords(target)),
   ]
      .filter(Boolean)
      .join(' · ');
}

/** The row a trip to a project's page or a plan left from, kept for this
 * tab, so coming back lands on it rather than the top of the list. */
const BACK_TO = 'pd2.decide.backTo';

/** On coming back to the list, scroll to the row the trip left from and
 * put the focus on its answer. */
function useBackToRow(ready: boolean) {
   useEffect(() => {
      if (!ready || !readSessionStorage(BACK_TO)) return;
      // a frame later: the tab scrolls to the top on a change of view
      // (app.tsx), after this view's own effects
      const frame = requestAnimationFrame(() => {
         const key = readSessionStorage(BACK_TO);
         writeSessionStorage(BACK_TO, '');
         const row = [...document.querySelectorAll<HTMLElement>('[data-decide-row]')].find(
            r => r.dataset.decideRow === key
         );
         if (!row) return;
         row.scrollIntoView({ block: 'center' });
         row.querySelector<HTMLElement>('[data-decide-focus]')?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
   }, [ready]);
}

export function DecideRowView({
   row,
   decided,
   owner,
   project,
   team,
   nav,
   navigate,
   onPerson,
   asked = false,
   sayGuessed = true,
   noRepo = false,
}: {
   row: DecideRow;
   /** a call was made on it here */
   decided: boolean;
   /** the initiative the row is about, when it asks about one: it names
    * the owner, who takes the call */
   owner?: Initiative;
   /** its section asks the question once, so the row is one line: name,
    * lead, the one fact and its answer */
   asked?: boolean;
   /** its section says "Leads guessed" once instead */
   sayGuessed?: boolean;
   noRepo?: boolean;
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
   const key = rowKey(row);
   // a trip from the row remembers it, for the way back
   const go = (patch: Partial<ProjectsNav>) => {
      writeSessionStorage(BACK_TO, key);
      navigate(patch);
   };
   // a row about an initiative itself opens the initiative's page
   const asksInitiative = askedInitiative(row) != null && !row.slug;
   const openProject = () =>
      asksInitiative && owner
         ? go({ initiative: owner.slug, project: null })
         : row.slug
         ? go({ project: row.slug })
         : item && go(openPlan(nav, item.id));
   // plain words: the name is the row's one way out, to the project, whose
   // page links to the plan
   const reason = (r: DecideReason, bare: boolean) => stop(reasonFacts(r, item, bare));
   return (
      // a decided row keeps every line it had, so the rows below never slide
      // under the pointer between two clicks; it steps down to the quiet ink
      // and its question loses the amber, rather than fading below what
      // can be read
      <div
         role="group"
         aria-labelledby={nameId}
         data-decide-row={key}
         className={`scroll-mt-36 scroll-mb-4 border-t border-secondary px-3.5 py-2.5 first:border-t-0 ${
            decided ? 'text-ink-3' : 'text-ink-2'
         }`}
      >
         <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
               id={nameId}
               type="button"
               onClick={openProject}
               className={`hit pressable rounded border-0 bg-transparent p-0 text-left text-[13px] font-medium underline decoration-line underline-offset-2 hover:text-brand ${
                  decided ? 'text-ink-3' : 'text-ink'
               }`}
               title={
                  asksInitiative
                     ? 'Open the initiative and its projects'
                     : row.slug
                     ? 'Open the project and its PRs'
                     : 'Open its plan on the roadmap'
               }
            >
               {nameOf(row, project)}
            </button>
            {/* a question about an initiative is its owner's to take */}
            {owner?.owner && asksInitiative && (
               <FactLink
                  tabIndex={-1}
                  className="text-xs"
                  onClick={() => onPerson?.(owner.owner as string)}
                  title={`${owner.owner} owns ${owner.name}. See them on People`}
               >
                  {owner.owner}
               </FactLink>
            )}
            <RowLead
               row={row}
               project={project}
               onPerson={onPerson}
               sayGuessed={sayGuessed}
               noRepo={noRepo}
            />
            {asked && (
               <>
                  <span
                     id={whyId}
                     className="min-w-0 flex-1 text-[13px]"
                     title={factsTitle(row, project, team) || undefined}
                  >
                     <span aria-hidden>· </span>
                     {midLine(reasonFacts(primary, item, true))}
                     {/* the header asks it once; the row's answer is read with it */}
                     <span className="sr-only"> {askOf(primary).question}</span>
                  </span>
                  <DecideCall row={row} project={project} describedBy={whyId} compact />
               </>
            )}
         </div>
         {!asked && (
            <>
               <p
                  id={whyId}
                  className="m-0 mt-0.5 max-w-[70ch] text-[13px]"
                  title={factsTitle(row, project, team) || undefined}
               >
                  {reason(primary, true)} {/* the one thing owed on the row, until it's answered */}
                  <span className={decided ? '' : 'text-warn'}>{askOf(primary).question}</span>
                  {primary.kind === 'issues_done' && primary.open > 0 && row.slug && (
                     <>
                        {' '}
                        <FactLink
                           // the name opens the same page from the keyboard; decided,
                           // it keeps its place unseen, so no line moves
                           tabIndex={-1}
                           disabled={decided}
                           className={decided ? 'invisible' : ''}
                           // linked issues join by themselves now, so what's left
                           // is the page's PRs that do no issue there
                           onClick={() => openPageAt(go, row.slug as string, 'project-unlinked')}
                        >
                           Add issues for those PRs on its page
                        </FactLink>
                     </>
                  )}
                  {/* "Is it done?" checked against what the plan said done looks like */}
                  {item?.done_when && askOf(primary).call === 'done' && (
                     <span className="block">
                        <span className="text-ink-3">{DONE_WHEN}:</span> {item.done_when}
                     </span>
                  )}
                  {/* "Did it reach its goal?" beside the goal it asks about */}
                  {primary.kind === 'goal_reached' && owner?.goal && (
                     <span className="block">
                        <span className="text-ink-3">{GOAL}:</span> {owner.goal}
                     </span>
                  )}
               </p>
               {row.reasons
                  .filter(r => r !== primary)
                  .map(r => (
                     <p key={r.kind} className="m-0 max-w-[70ch] text-[13px]">
                        {reason(r, false)}
                     </p>
                  ))}
               <DecideCall row={row} project={project} describedBy={whyId} />
            </>
         )}
      </div>
   );
}

/**
 * One click for a whole section, in its header: every row still owed gets
 * the call its suggested answer makes, all shown at once and saved one after
 * another, each row keeping its own receipt and Undo (a failure stays in
 * its row with Try again). Then what it did, with Undo all. Only for two
 * rows or more, since a lone row's answer is the same click.
 */
export function SectionCalls({
   title,
   rows,
   owed,
   projectOf,
   main = false,
}: {
   title: string;
   /** the section's rows, decided here or not */
   rows: readonly DecideRow[];
   /** the ones still owed a call */
   owed: readonly DecideRow[];
   projectOf: (row: DecideRow) => PortfolioItem | undefined;
   /** the section's main action, filled: the header asks its question */
   main?: boolean;
}) {
   const { made } = calls.useValue();
   const rootRef = useRef<HTMLSpanElement>(null);
   const refocus = useRef(false);
   const [said, setSaid] = useState('');
   const day = dayOf(new Date());
   // its calls in a state, on the rows as they stood
   const batch = (state: Made['state']) =>
      rows.flatMap(row => {
         const m = made.get(rowKey(row));
         return m?.batch && m.state === state && kindsOf(m.row) === kindsOf(row) ? [m] : [];
      });
   const standing = batch('made');
   const failed = batch('failed').length;
   // a row with no answer to suggest waits for a person, as does one whose
   // File it in chooser is empty (its own answer is off until a pick); the
   // rest file where their chooser says, guess included, as their own
   // answer would
   const homeOf = useChosenHomes();
   let waiting = 0;
   const answers = owed.flatMap(row => {
      const call = answerOf(row, projectOf(row), day);
      if (!call) return [];
      const home = homeOf(row);
      if (home.waiting) waiting++;
      return home.waiting ? [] : [{ row, call, filed: home.filed }];
   });
   const view = standing.length ? 'did' : 'ask';
   const before = useRef(view);
   // after a click here, focus lands on what it did, so an extra Enter never
   // takes it all back; after Undo all, on the click again, or else on the
   // section's first answer. Saves that all fail later take the focus only
   // when they removed it, and give it to the click again
   useEffect(() => {
      if (before.current === view) return;
      before.current = view;
      if (!refocus.current && document.activeElement !== document.body) return;
      refocus.current = false;
      rootRef.current
         ?.closest('[data-decide-section]')
         ?.querySelector<HTMLElement>('[data-decide-focus]')
         ?.focus();
   }, [view]);
   const words = bulkWords(
      answers.map(a => a.call),
      'do',
      !waiting
   );
   const all = () => {
      refocus.current = true;
      setSaid('');
      inTurn(
         answers.map(
            a => after => makeCall(a.row, a.call, projectOf(a.row), { after }, a.filed)
         )
      );
   };
   const undoAll = () => {
      refocus.current = true;
      setSaid(`Put ${n(standing.length, 'decision')} under ${title} back as they were.`);
      inTurn(standing.map(m => after => undoCall(rowKey(m.row), { after })));
   };
   // the rows' failures, said once for all of them
   const news = failed
      ? `${n(failed, 'decision')} under ${title} didn’t save. Each row says why, with Try again.`
      : said;
   return (
      <span ref={rootRef} className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
         <span className="sr-only" aria-live="polite">
            {news}
         </span>
         {standing.length > 0 && (
            <span className="inline-flex flex-wrap items-center gap-x-2 text-xs text-ink-2">
               <span data-decide-focus tabIndex={-1} className="rounded">
                  <Icon icon={Check} size={14} className="mr-1 inline-block align-[-2px]" />
                  {bulkWords(
                     standing.map(m => m.call),
                     'did'
                  )}
                  .
               </span>
               <QuietButton
                  onClick={undoAll}
                  aria-label={`Undo all ${n(standing.length, 'decision')} under ${title}`}
               >
                  Undo all
               </QuietButton>
            </span>
         )}
         {answers.length > 1 &&
            (main ? (
               <button
                  type="button"
                  data-decide-focus
                  onClick={all}
                  aria-label={`${words}, under ${title}`}
                  className="hit pressable inline-flex h-8 items-center rounded-lg border border-brand bg-brand px-3 text-[13px] font-medium text-surface hover:opacity-90"
               >
                  {words}
               </button>
            ) : (
               <QuietButton data-decide-focus onClick={all} aria-label={`${words}, under ${title}`}>
                  {words}
               </QuietButton>
            ))}
      </span>
   );
}

/** A team's work in flight against its developers, in the roadmap's words.
 * Past what they can staff, it names the lowest in priority order, each
 * with its Park: the roadmap's capacity line sends a planner here to park
 * something, so here is where it's one click. */
function TeamLoad({
   team,
   developers,
   load,
   rowOf,
   projectOf,
   onOpen,
}: {
   team: string;
   developers: number;
   load: InFlight[];
   /** the work's row on this list, or a row to park it by */
   rowOf: (work: InFlight) => DecideRow;
   projectOf: (row: DecideRow) => PortfolioItem | undefined;
   onOpen: (work: InFlight) => void;
}) {
   // once one is parked the names hold still, so each keeps its place and
   // its Undo while the count above them moves
   const [held, setHeld] = useState<InFlight[] | null>(null);
   if (!developers) return null;
   const over = load.length - developers;
   // the lowest in the order are the ones to park first
   const lowest = held ?? (over > 0 ? load.slice(-Math.min(3, over)) : []);
   return (
      <div className="mt-2 max-w-[70ch] text-xs text-ink-2">
         <p className="m-0">
            {team} has {n(load.length, 'project')} {BEING_WORKED_ON} this week, for{' '}
            {n(developers, 'developer')}
            {over > 0 ? (
               <>
                  , {over} <span className="text-warn">more than they can staff</span>.
               </>
            ) : (
               '.'
            )}
            {lowest.length > 0 && ' The lowest in priority order, the first to park:'}
         </p>
         {lowest.length > 0 && (
            <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
               {lowest.map(work => {
                  const row = rowOf(work);
                  return (
                     <ParkLine
                        key={rowKey(row)}
                        name={work.name}
                        row={row}
                        project={projectOf(row)}
                        onOpen={() => onOpen(work)}
                        onPark={() => setHeld(lowest)}
                     />
                  );
               })}
            </ul>
         )}
      </div>
   );
}

/** One piece of a team's work with its Park, then what was decided and
 * Undo, in place; the same call its row below makes, if it has one. */
function ParkLine({
   name,
   row,
   project,
   onOpen,
   onPark,
}: {
   name: string;
   row: DecideRow;
   project: PortfolioItem | undefined;
   onOpen: () => void;
   onPark: () => void;
}) {
   const key = rowKey(row);
   const made = calls.useValue().made.get(key);
   const parked = made?.call.kind === 'park' ? made : undefined;
   const state = parked && parked.state !== 'undone' ? parked.state : 'ask';
   const rootRef = useRef<HTMLLIElement>(null);
   const refocus = useRef(false);
   const before = useRef(state);
   // after a click here, focus lands on what replaced the button, and a
   // save that fails later takes it only from the words it removed
   useEffect(() => {
      if (before.current === state) return;
      before.current = state;
      const lost = document.activeElement === document.body && state !== 'ask';
      if (!refocus.current && !lost) return;
      refocus.current = false;
      rootRef.current?.querySelector<HTMLElement>('[data-park-focus]')?.focus();
   }, [state]);
   const act = (fn: () => void) => () => {
      refocus.current = true;
      fn();
   };
   const park = act(() => {
      onPark();
      makeCall(row, { kind: 'park' }, project);
   });
   return (
      <li ref={rootRef} className="flex flex-wrap items-center gap-x-2">
         <FactLink onClick={onOpen} title="Open it">
            {name}
         </FactLink>
         <span aria-hidden>·</span>
         {state === 'made' ? (
            <>
               <span data-park-focus tabIndex={-1} className="rounded">
                  Parked.
               </span>
               <QuietButton onClick={act(() => undoCall(key))} aria-label={`Undo parking ${name}`}>
                  Undo
               </QuietButton>
            </>
         ) : state === 'failed' ? (
            <>
               <span aria-hidden>Didn’t save.{parked?.why}</span>
               <QuietButton data-park-focus onClick={park} aria-label={`Try parking ${name} again`}>
                  Try again
               </QuietButton>
            </>
         ) : (
            <QuietButton data-park-focus onClick={park} aria-label={`Park ${name}`}>
               Park
            </QuietButton>
         )}
         <span className="sr-only" aria-live="polite">
            {state === 'failed'
               ? `Didn’t park ${name}.${parked?.why ?? ''}`
               : parked?.state === 'undone'
               ? `Put ${name} back as it was.`
               : parked?.why ?? ''}
         </span>
      </li>
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
         <FactLink onClick={() => onPerson(login)} title={`See ${login} on People`}>
            {login}
         </FactLink>
      ) : (
         <span className="font-medium text-ink">{login}</span>
      );
   if (draft == null) {
      return (
         <p className="m-0 mt-1 text-xs text-ink-3">
            {now ? (
               <>
                  {person(now)} runs Decide this week
                  {next && next !== now && <>, {person(next)} next week</>}.
               </>
            ) : (
               'Nobody runs Decide yet.'
            )}{' '}
            <QuietButton onClick={() => setDraft(rotation?.logins.join(', ') ?? '')}>
               {now ? 'Change the turns' : 'Name who takes turns'}
            </QuietButton>
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
            <QuietButton onClick={close} aria-label="Cancel changing the turns">
               Cancel
            </QuietButton>
         </span>
         {left.length > 0 && (
            <p className="m-0 flex basis-full flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
               Add
               {left.map(login => (
                  <QuietButton
                     key={login}
                     onClick={() => setDraft([...chosen, login].join(', '))}
                     aria-label={`Add ${login} to the turns`}
                  >
                     {login}
                  </QuietButton>
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

const DAY = 86400;
/** how far back "this week" reaches, for what filled itself in */
const WEEK_DAYS = 7;

/** A plan as the board shows it, with `marked`: the status it was saved
 * with, where the board reads another off its PRs (marked Planned, read In
 * progress). roadmapData.ts shown is the place to set it; until it does,
 * no plan lists as In progress by its PRs. */
type ShownPlan = RoadmapItem & { marked?: RoadmapItem['status'] };

/** What filled itself in this week, kind by kind: each guess the board made
 * from PRs, labels, links and activity, for the list at the end of Decide. */
export interface FilledIn {
   /** issues that joined a project this week by a link from one of its PRs,
    * newest first */
   joined: { slug: string; issue: ProjectIssue }[];
   /** PRs opened this week, with no project label, that count in a project
    * by a link to one of its issues (that issue, when its page says),
    * newest first */
   linked: {
      slug: string;
      pull: DerivedPull | PullData;
      issue: IssueRef | null;
   }[];
   /** plans marked Planned that started this week and read In progress off
    * their PRs */
   started: ShownPlan[];
   /** plans in progress whose numbers vouch for them, so their leads owe no
    * update this week */
   vouched: { plan: RoadmapItem; vouch: Vouch }[];
}

export function filledIn({
   today,
   prefix,
   plans,
   pages,
   now,
}: {
   today: Pick<Today, 'live' | 'quiet'>;
   prefix: string;
   plans: readonly ShownPlan[];
   /** the pages of the projects that have issues, by slug */
   pages: ReadonlyMap<string, Pick<ProjectWork, 'issues'>>;
   /** epoch secs */
   now: number;
}): FilledIn {
   const since = now - WEEK_DAYS * DAY;
   const joined = [...pages]
      .flatMap(([slug, page]) =>
         page.issues
            // one a person added or labeled too is theirs, not a guess
            // by when it joined (joinedAt), not when the PR that brought it
            // opened, so a deploy week's first sync shows every join
            .filter(
               i =>
                  i.via.length === 1 &&
                  i.via[0] === 'link' &&
                  (i.joinedAt ?? i.attachedAt ?? 0) >= since
            )
            .map(issue => ({ slug, issue }))
      )
      .sort(
         (a, b) =>
            (b.issue.joinedAt ?? b.issue.attachedAt ?? 0) -
            (a.issue.joinedAt ?? a.issue.attachedAt ?? 0)
      );
   const byLink = (p: PullData, slug: string) =>
      epoch(p.created_at) >= since && !projectSlugs(p.labels, prefix).includes(slug);
   const issueOf = (slug: string, p: PullData) =>
      pages.get(slug)?.issues.find(i => i.prs.some(pr => issueKey(pr) === issueKey(p)))?.ref ??
      null;
   const linked = [...today.live, ...today.quiet]
      .flatMap(g => [
         ...g.open
            .filter(p => byLink(p.data, g.slug))
            .map(p => ({
               slug: g.slug,
               pull: p,
               issue: issueOf(g.slug, p.data),
            })),
         ...g.merged
            .filter(p => byLink(p, g.slug))
            .map(p => ({ slug: g.slug, pull: p, issue: issueOf(g.slug, p) })),
      ])
      .sort((a, b) => epoch(dataOf(b.pull).created_at) - epoch(dataOf(a.pull).created_at));
   const week = dayOf(new Date(since * 1000));
   const started = plans.filter(
      p => p.marked === 'planned' && p.status === 'active' && p.start >= week
   );
   const vouched = plans.flatMap(plan => {
      const s = isUnderWay(plan.status) ? healthStanding(plan, now) : null;
      const vouch = s?.kind === 'quiet' || s?.kind === 'current' ? s.vouch : undefined;
      return vouch ? [{ plan, vouch }] : [];
   });
   return { joined, linked, started, vouched };
}

/** A PR's own fields, open (as the board derives it) or closed. */
const dataOf = (p: DerivedPull | PullData): PullData => ('data' in p ? p.data : p);

/** One project's page, read for what filled itself in: the issues that
 * joined it, and which issue each of its PRs links. It draws nothing. */
function PageOf({
   slug,
   plans,
   onPage,
}: {
   slug: string;
   plans: readonly RoadmapItem[];
   onPage: (slug: string, page: ProjectWork) => void;
}) {
   const page = useProjectWork(slug, plans);
   useEffect(() => {
      if (page) onPage(slug, page);
   }, [page]);
   return null;
}

/** An issue that joined a project by a link, with its Remove, which takes it
 * off for good: then what was done, where Remove was, with Undo. */
function JoinedLine({
   slug,
   issue,
   name,
   onHold,
   navigate,
}: {
   slug: string;
   issue: ProjectIssue;
   /** its project's name */
   name: string;
   /** keep the line in place once it's off its project */
   onHold: () => void;
   navigate: Navigate;
}) {
   const [state, setState] = useState<'on' | 'removing' | 'off' | 'putting' | 'failed'>('on');
   const [error, setError] = useState<string | null>(null);
   const [said, setSaid] = useState('');
   const rootRef = useRef<HTMLLIElement>(null);
   const refocus = useRef(false);
   const number = `#${issue.ref.number}`;
   // once it's saved, the focus lands on what replaced the button: what was
   // done, or Remove again after an Undo
   const saving = state === 'removing' || state === 'putting';
   useEffect(() => {
      if (!refocus.current || saving) return;
      refocus.current = false;
      rootRef.current?.querySelector<HTMLElement>('[data-joined-focus]')?.focus();
   }, [state]);
   const change = (add: boolean) => {
      if (saving) return;
      refocus.current = true;
      setError(null);
      setState(add ? 'putting' : 'removing');
      if (!add) onHold();
      void changeProjectIssue(slug, issue.ref, add).then(r => {
         if ('error' in r) {
            setError(r.error);
            setState(add ? 'off' : 'failed');
            setSaid(r.error);
            return;
         }
         setState(add ? 'on' : 'off');
         setSaid(add ? `Put ${number} back on ${name}.` : `Removed ${number} from ${name}.`);
      });
   };
   const off = state === 'off' || state === 'putting';
   return (
      <li ref={rootRef} className="border-t border-secondary px-3.5 py-2 first:border-t-0">
         <span className="sr-only" aria-live="polite">
            {said}
         </span>
         <span className={`block max-w-[70ch] ${off ? 'text-ink-3' : 'text-ink-2'}`}>
            <a
               href={issueUrl(issue.ref.repo, issue.ref.number)}
               target="_blank"
               rel="noopener noreferrer"
               className="text-ink-2 underline decoration-line underline-offset-2 hover:text-brand"
            >
               {number} ↗
            </a>{' '}
            <span className="font-medium text-ink">{issue.title || number}</span> joined{' '}
            <FactLink onClick={() => openPageAt(navigate, slug, 'project-issues')}>{name}</FactLink>
            {issue.linkedBy && (
               <>
                  , linked by{' '}
                  <a
                     href={issueUrl(issue.linkedBy.repo, issue.linkedBy.number)}
                     target="_blank"
                     rel="noopener noreferrer"
                     className="text-ink-2 underline decoration-line underline-offset-2 hover:text-brand"
                  >
                     PR #{issue.linkedBy.number} ↗
                  </a>
               </>
            )}
            .{' '}
            {off ? (
               <>
                  <span data-joined-focus tabIndex={-1} className="rounded">
                     {error ?? 'Removed.'}
                  </span>{' '}
                  <QuietButton
                     onClick={() => change(true)}
                     aria-label={`Undo removing ${number} from ${name}`}
                  >
                     Undo
                  </QuietButton>
               </>
            ) : (
               <>
                  {state === 'failed' && <span>{error} </span>}
                  <QuietButton
                     data-joined-focus
                     onClick={() => change(false)}
                     aria-label={`Remove ${number} from ${name}`}
                  >
                     {state === 'failed' ? 'Try again' : 'Remove'}
                  </QuietButton>
               </>
            )}
         </span>
      </li>
   );
}

/**
 * What filled itself in this week, at the end of Decide: every guess the
 * board made from PRs, labels, links and activity, in one place, each line
 * a way to where it happened, so a person can check them all in half a
 * minute and take a joined issue back off. Nothing shows in a week with no
 * guesses.
 */
function FilledInSection({
   today,
   prefix,
   plans,
   work,
   items,
   opts,
   nav,
   navigate,
}: {
   today: Today;
   prefix: string;
   plans: readonly RoadmapItem[];
   work: WorkData | null | undefined;
   items: readonly PortfolioItem[];
   opts: RowOptions;
   nav: ProjectsNav;
   navigate: Navigate;
}) {
   const [pages, setPages] = useState<ReadonlyMap<string, ProjectWork>>(new Map());
   const onPage = useCallback(
      (slug: string, page: ProjectWork) => setPages(was => new Map(was).set(slug, page)),
      []
   );
   // a line taken off its project stays, with Undo, though its page no
   // longer lists it; put back, its page lists it again
   const [held, setHeld] = useState<ReadonlyMap<string, FilledIn['joined'][number]>>(new Map());
   // ponytail: one project page per project with issues, read when Decide
   // opens; a list of the week's joins on /work-data once that's dozens
   const withIssues = [...(work?.projects.keys() ?? [])];
   const found = filledIn({
      today,
      prefix,
      plans,
      pages,
      now: Date.now() / 1000,
   });
   const keyOf = (j: FilledIn['joined'][number]) => `${j.slug} ${issueKey(j.issue.ref)}`;
   const joined = [...found.joined];
   for (const j of held.values()) if (!joined.some(o => keyOf(o) === keyOf(j))) joined.push(j);
   const nameOf = (slug: string) => items.find(i => i.slug === slug)?.name ?? slug;
   const line = 'border-t border-secondary px-3.5 py-2 first:border-t-0';
   const total = joined.length + found.linked.length + found.started.length + found.vouched.length;
   return (
      <>
         {withIssues.map(slug => (
            <PageOf key={slug} slug={slug} plans={plans} onPage={onPage} />
         ))}
         {total > 0 && (
            <div className="mb-6">
               <GroupHeader
                  level={3}
                  compact
                  title="Guessed by the board, last 7 days"
                  count={total}
                  sub={
                     <SubDoor label="What the board guesses" text="Check these guesses">
                        <p className="m-0">
                           What the board read off PRs, labels, links and activity in the last{' '}
                           {WEEK_DAYS} days rather than asking anyone: issues that joined a project
                           because its PRs link them, PRs that count in a project because they link
                           one of its issues, plans that read In progress because their PRs moved,
                           and updates nobody owes because the numbers vouch.
                        </p>
                        <p className="m-0">
                           Each line opens where it happened. A joined issue that doesn’t belong
                           comes off with Remove, and no link brings it back.
                        </p>
                     </SubDoor>
                  }
               />
               <Rows>
                  <Fold
                     count={joined.length}
                     label="Issues added by a PR’s link"
                     gloss="Issues that joined a project on their own in the last 7 days, because one of its PRs links them"
                     id="decide:filled:joined"
                  >
                     <ul className="m-0 list-none p-0 text-[13px]">
                        {joined.map(j => (
                           <JoinedLine
                              key={keyOf(j)}
                              slug={j.slug}
                              issue={j.issue}
                              name={nameOf(j.slug)}
                              onHold={() => setHeld(was => new Map(was).set(keyOf(j), j))}
                              navigate={navigate}
                           />
                        ))}
                     </ul>
                  </Fold>
                  <Fold
                     count={found.linked.length}
                     label="PRs counted by an issue link"
                     gloss="PRs opened in the last 7 days with no project label that count in a project because they link one of its issues"
                     id="decide:filled:linked"
                  >
                     {found.linked.map(({ slug, pull, issue }) => {
                        const note = (
                           <>
                              Counts in{' '}
                              <FactLink onClick={() => navigate({ project: slug })}>
                                 {nameOf(slug)}
                              </FactLink>{' '}
                              by its link to {issue ? `#${issue.number}` : 'one of its issues'}, not
                              a label
                           </>
                        );
                        const data = dataOf(pull);
                        return (
                           <div
                              key={issueKey(data)}
                              className="border-t border-secondary first:border-t-0"
                           >
                              {'data' in pull ? (
                                 <Row pull={pull} opts={opts} footnote={note} />
                              ) : (
                                 <>
                                    <ClosedRow pull={pull} lastSeen={opts.lastSeen} />
                                    {/* under its title, as a row's footnote is, past
                                        stand-ins as wide as its badge and face */}
                                    <p className="m-0 -mt-1 flex gap-2.5 pb-1.5 pl-[11px] pr-3.5 text-xs text-ink-3">
                                       <span
                                          aria-hidden
                                          className="invisible flex flex-none gap-2.5"
                                       >
                                          <ClosedBadge merged={!!pull.merged_at} inline />
                                          <span className="w-[22px]" />
                                       </span>
                                       <span className="min-w-0">{note}</span>
                                    </p>
                                 </>
                              )}
                           </div>
                        );
                     })}
                  </Fold>
                  <Fold
                     count={found.started.length}
                     label="Started, going by its PRs"
                     gloss="Plans marked Planned that started in the last 7 days and show In progress because their PRs moved since"
                     id="decide:filled:started"
                  >
                     <ul className="m-0 list-none p-0 text-[13px] text-ink-2">
                        {found.started.map(plan => (
                           <li key={plan.id} className={line}>
                              <span className="block max-w-[70ch]">
                                 <FactLink onClick={() => navigate(openPlan(nav, plan.id))}>
                                    {plan.name}
                                 </FactLink>{' '}
                                 shows {IN_PROGRESS}: it was Planned to start {dayWords(plan.start)}
                                 , and its PRs have moved since.
                              </span>
                           </li>
                        ))}
                     </ul>
                  </Fold>
                  <Fold
                     count={found.vouched.length}
                     label="No update needed: PRs are merging"
                     gloss="Plans whose PRs merged lately with no pile of open PRs growing or aging behind them, inside their issues’ pace and any promised end date, so their leads owe no update this week"
                     id="decide:filled:vouched"
                  >
                     <ul className="m-0 list-none p-0 text-[13px] text-ink-2">
                        {found.vouched.map(({ plan, vouch }) => (
                           <li key={plan.id} className={line}>
                              <span className="block max-w-[70ch]">
                                 <FactLink
                                    onClick={() =>
                                       plan.project
                                          ? navigate({ project: plan.project })
                                          : navigate(openPlan(nav, plan.id))
                                    }
                                 >
                                    {plan.name}
                                 </FactLink>
                                 {' · '}
                                 {vouchWords(vouch)}
                              </span>
                           </li>
                        ))}
                     </ul>
                  </Fold>
               </Rows>
            </div>
         )}
      </>
   );
}

/** The teams the switch offers: the configured ones in their own order,
 * then any other a row names, by name; "No team" comes after these. */
export function teamOrder(configured: readonly string[], named: readonly (string | null)[]) {
   const others = named.filter((t): t is string => !!t && !configured.includes(t));
   return [...configured, ...[...new Set(others)].sort()];
}

/**
 * Decide: the weekly triage a product manager would run, as a queue that
 * empties. Every row is a project or plan that needs a call, says why, with
 * the facts the call turns on, and asks one question. Each call (promise it
 * by a month or quarter, park, mark done, drop) is one click that
 * writes the roadmap; the row stays in place saying what was decided and
 * what happens next, with Undo, so nothing vanishes unexplained. Worst
 * first; a team's lead can take just theirs.
 */
export function Decide({
   today,
   items,
   allItems = items,
   initiatives = null,
   grown = [],
   closed,
   teamOf,
   teamMembers,
   rotation,
   work,
   ongoing,
   prefix,
   opts,
   nav,
   navigate,
   onPerson,
   projectsRepo,
}: {
   /** Today from every PR, not the filter bar's */
   today: Today;
   /** the portfolio from the same, for names, leads, sizes and teams */
   items: PortfolioItem[];
   /** every project, Not tracked ones too: a row's one-slug lookups */
   allItems?: PortfolioItem[];
   /** the initiatives, which raise where-it-belongs questions; null while
    * they load */
   initiatives?: Initiative[] | null;
   /** the Not tracked projects that grew (initiativeBoard.ts grownProjects) */
   grown?: readonly GrownProject[];
   closed: ReadonlyMap<string, ClosedIssue>;
   teamOf: (login: string) => string | null;
   teamMembers: Record<string, string[]>;
   /** who takes turns running this list; null for nobody */
   rotation: DecideRotation | null;
   /** each plan's PRs by the dates, and each project's issues (model/workData.ts) */
   work: WorkData | null | undefined;
   /** every project with no end, and the ones marked so on the board */
   ongoing: ReadonlySet<string>;
   /** the project label prefix, to tell a PR's label from its links */
   prefix: string;
   /** how the board draws its PR rows */
   opts: RowOptions;
   nav: ProjectsNav;
   navigate: Navigate;
   /** open a person on People */
   onPerson?: (login: string) => void;
   /** the repo whose issues name projects; null when there's none */
   projectsRepo?: string | null;
}) {
   const { items: plans, loadFailed } = useRoadmap();
   const { made } = calls.useValue();
   const [copied, setCopied] = useState<string | null>(null);
   // j and k land on each row's answer, or on what was decided once it is
   useRowKeys('[data-decide-row]', '[data-decide-focus]');
   useBackToRow(!!plans);
   if (!plans) {
      return loadFailed ? (
         <LoadFailed what="the roadmap" onRetry={() => void loadRoadmap()} />
      ) : (
         <p className="m-0 text-[13px] text-ink-3">Loading the roadmap…</p>
      );
   }
   const day = dayOf(new Date());
   // one slug each: from every project, so a grown Not tracked project has
   // its name and team
   const bySlug = new Map(allItems.map(i => [i.slug, i]));
   const projectOf = (row: DecideRow) => (row.slug ? bySlug.get(row.slug) : undefined);
   // the initiative each row is about: the one it asks about, or its
   // project's home; for the owner it names and the Initiative switch
   const homes = homesOf(initiatives ?? []);
   const initiativeOfRow = (row: DecideRow) =>
      (initiatives ?? []).find(i => i.id === askedInitiative(row)) ??
      (row.slug ? homes.get(row.slug)?.initiative : undefined);
   // the team a row belongs to: its plan's, or the team most of its
   // developers are on, as the roadmap's lanes split them
   const teamOfRow = (row: DecideRow): string | null => {
      const project = projectOf(row);
      return row.item?.team ?? (project ? mainTeam(project, teamOf) : null);
   };
   const kept = keepCalls(
      decideRows(today, plans, closed, work, ongoing, { initiatives: initiatives ?? [], grown }),
      made
   );
   // the Initiative switch's key for a row: its initiative, Unsorted, or
   // for a plan with no project, the No project yet entry, as the Roadmap
   // lanes split them
   const withinOf = (row: DecideRow) =>
      initiativeOfRow(row)?.slug ?? (row.slug ? UNSORTED : NO_PROJECT);
   const inTeam = (row: DecideRow) =>
      (!nav.team || (teamOfRow(row) ?? '(none)') === nav.team) &&
      (!nav.within || withinOf(row) === nav.within);
   const owed = kept.owed.filter(inTeam);
   const shown = kept.all.filter(inTeam);
   const decidedHere = [...kept.settled.values()].filter(m => inTeam(m.row));
   const withinName = nav.within
      ? nav.within === UNSORTED
         ? `${UNSORTED_WORD} projects`
         : nav.within === NO_PROJECT
         ? 'plans with no project yet'
         : (initiatives ?? []).find(i => i.slug === nav.within)?.name ?? nav.within
      : null;
   // both when both narrow it: "for Store in Site speed"
   const teamWords = !nav.team
      ? ''
      : nav.team === '(none)'
      ? ' for work with no team'
      : ` for ${nav.team}`;
   const whose = withinName
      ? teamWords
         ? `${teamWords} in ${withinName}`
         : ` for ${withinName}`
      : teamWords;
   // as the sections count: a row answered about its home here keeps its
   // receipt, and its plan question waits for the next visit
   const toMake = owed.filter(row => !kept.settled.has(rowKey(row))).length;
   const heading = toMake
      ? `${n(toMake, 'decision')} to make`
      : decidedHere.length
      ? 'Nothing left to decide'
      : 'Nothing to decide';
   const leadOf = (row: DecideRow) => {
      const project = projectOf(row);
      const lead = row.item?.lead ?? project?.lead;
      if (!lead) return '';
      return !row.item?.lead && project?.leadByPrs ? ` (${lead}, guessed)` : ` (${lead})`;
   };

   // the list as plain text, for the weekly meeting's notes or a chat post:
   // what's left, and the decisions made here
   const copy = () => {
      const left = SECTIONS.flatMap((section, index) => {
         const inSection = owed.filter(row => sectionOf(row) === index);
         if (!inSection.length) return [];
         return [
            section.title,
            ...inSection.map(
               row => `- ${nameOf(row, projectOf(row))}${leadOf(row)}: ${rowWords(row)}`
            ),
         ];
      });
      const decided = decidedHere.length
         ? [
              'Decided',
              ...decidedHere.map(
                 m => `- ${nameOf(m.row, projectOf(m.row))}${leadOf(m.row)}: ${m.words}`
              ),
           ]
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
   const teams = teamOrder(Object.keys(teamMembers), kept.owed.map(teamOfRow));
   const owedBy = (team: string) =>
      kept.owed.filter(row => (teamOfRow(row) ?? '(none)') === team).length;
   const counted = (label: string, count: number) => (count ? `${label} · ${count}` : label);
   const people = [...new Set(Object.values(teamMembers).flat())].sort();
   // a team's load counts its work in flight; the row each one has here
   // makes its Park the same call
   const rowOf = (w: InFlight): DecideRow =>
      kept.all.find(row => rowKey(row) === `${w.slug ?? ''}:${w.id ?? ''}`) ?? {
         slug: w.slug,
         item: plans.find(p => p.id === w.id) ?? null,
         reasons: [],
      };
   return (
      <section className="mb-7">
         <div className="mb-4">
            <GroupHeader
               title={`${heading}${whose}`}
               sub={
                  owed.length > 0 && (
                     <SubDoor label="How Decide is ordered" text="Most urgent first, new work last">
                        <p className="m-0">
                           Each row is a decision the roadmap is owed. The sections run from what
                           costs most to leave alone to what costs least: work marked done, dropped
                           or parked that’s still being worked on, and plans their own issue
                           disagrees with; then plans that slipped past an update, a target date or
                           an end date; then plans whose issues are all closed; then stalled work,
                           and plans whose lead says at risk; then new work waiting for a plan.
                        </p>
                        <p className="m-0">
                           {ALL_ISSUES_CLOSED} comes before at risk: that plan is probably done, but
                           until someone says so it still counts in its team’s load, while at risk
                           only warns that a plan might slip.
                        </p>
                        <p className="m-0">
                           Each decision saves to the roadmap when you click it, and its row says
                           what happens next, with Undo. A section of two or more has one button
                           that gives every row its suggested answer, and then Undo all.
                        </p>
                        <p className="m-0">
                           From the keyboard, j and k move between the rows, the left and right
                           arrow keys between a row’s answers, and Enter makes the decision.
                        </p>
                     </SubDoor>
                  )
               }
               headerExtra={
                  (owed.length > 0 || decidedHere.length > 0) && (
                     <QuietButton
                        onClick={copy}
                        title="Copy what’s left and the decisions made here as plain text, for the meeting’s notes or a chat post"
                     >
                        {copied ?? COPY_AS_TEXT}
                     </QuietButton>
                  )
               }
            />
            <span role="status" className="sr-only">
               {copied ?? ''}
            </span>
            <RunsDecide rotation={rotation} day={day} people={people} onPerson={onPerson} />
            {(initiatives ?? []).length > 0 && (
               <InitiativeSwitch
                  initiatives={initiatives ?? []}
                  owedIn={slug => kept.owed.filter(row => withinOf(row) === slug).length}
                  value={nav.within}
                  onChange={within => navigate({ within })}
               />
            )}
            {teams.length > 0 && (
               <div className="mt-3">
                  <Segmented
                     ariaLabel="team"
                     value={nav.team ?? ''}
                     options={[
                        ['', counted('All teams', kept.owed.length)],
                        // a team with nothing owed has nothing to show
                        ...teams
                           .filter(t => owedBy(t) > 0 || nav.team === t)
                           .map((t): [string, string] => [t, counted(t, owedBy(t))]),
                        ...(owedBy('(none)') > 0 || nav.team === '(none)'
                           ? [['(none)', counted('No team', owedBy('(none)'))] as [string, string]]
                           : []),
                     ]}
                     onChange={t => navigate({ team: t || null })}
                  />
                  {nav.team && nav.team !== '(none)' && (
                     <TeamLoad
                        key={nav.team}
                        team={nav.team}
                        developers={teamMembers[nav.team]?.length ?? 0}
                        load={teamLoad(nav.team, plans, items, day)}
                        rowOf={rowOf}
                        projectOf={projectOf}
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
         {/* the check is earned by clearing the list too, above the calls
             that cleared it */}
         {!owed.length && (
            <>
               <EmptyState
                  title={
                     !nav.team
                        ? 'Nothing left to decide'
                        : nav.team === '(none)'
                        ? 'Nothing left to decide for work with no team'
                        : `Nothing left to decide for ${nav.team}`
                  }
                  sub={
                     nav.team && kept.owed.length
                        ? 'Other teams have decisions waiting.'
                        : decidedHere.length
                        ? `${n(
                             decidedHere.length,
                             'decision'
                          )} made here. Each says what happens next.`
                        : 'Rows show up here when work needs a plan, stalls, is overdue or misses its target date, or is marked done or parked but still worked on.'
                  }
               />
               {nav.team && kept.owed.length > 0 && (
                  <p className="m-0 mb-6 text-center text-[13px]">
                     <QuietButton onClick={() => navigate({ team: null })}>
                        Show all teams
                     </QuietButton>
                  </p>
               )}
            </>
         )}
         {SECTIONS.map((section, index) => {
            const here = shown.filter(row => sectionOf(row) === index);
            if (!here.length) return null;
            const decided = (row: DecideRow) => kept.settled.has(rowKey(row));
            const owedHere = here.filter(row => !decided(row));
            // asked once in the header when every row asks it alike
            const asked = sharedAsk(here, projectOf, day);
            const leads = here.filter(row => row.item?.lead ?? projectOf(row)?.lead);
            const guessed =
               leads.length > 0 && leads.every(row => guessedLead(row, projectOf(row)));
            return (
               <div key={section.kinds[0]} data-decide-section className="mb-6">
                  {/* no sub-line: the title says what lands here, its rule
                      is the header's hover and read before the rows */}
                  <div className="contents" title={section.more.join(' ')}>
                     <GroupHeader
                        level={3}
                        compact
                        title={section.title}
                        // the do-all button already says how many
                        count={asked ? undefined : owedHere.length}
                        sub={
                           (asked || guessed) && (
                              <>
                                 {asked && owedHere.length > 0 && (
                                    <span className="text-warn">{askAll(asked)} </span>
                                 )}
                                 {guessed && (
                                    <span className="text-ink-3">
                                       {leads.length > 1 ? 'Leads' : 'Lead'}{' '}
                                       <ByPrs noRepo={projectsRepo === null} />
                                    </span>
                                 )}
                              </>
                           )
                        }
                        headerExtra={
                           <SectionCalls
                              title={section.title}
                              rows={here}
                              owed={owedHere}
                              projectOf={projectOf}
                              main={!!asked}
                           />
                        }
                     />
                  </div>
                  <p className="sr-only">{section.more.join(' ')}</p>
                  <Rows>
                     <Truncated cap={capOwed(here, decided, 10)} id={`decide:${section.kinds[0]}`}>
                        {here.map(row => (
                           <DecideRowView
                              key={rowKey(row)}
                              row={row}
                              decided={decided(row)}
                              owner={initiativeOfRow(row)}
                              project={projectOf(row)}
                              team={teamOfRow(row)}
                              nav={nav}
                              navigate={navigate}
                              onPerson={onPerson}
                              asked={!!asked}
                              sayGuessed={!guessed}
                              noRepo={projectsRepo === null}
                           />
                        ))}
                     </Truncated>
                  </Rows>
               </div>
            );
         })}
         <FilledInSection
            today={today}
            prefix={prefix}
            plans={plans}
            work={work}
            items={items}
            opts={opts}
            nav={nav}
            navigate={navigate}
         />
      </section>
   );
}
