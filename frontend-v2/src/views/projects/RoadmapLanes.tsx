/**
 * The Roadmap's initiative lanes, out of Roadmap.tsx: the lane fold, the
 * receipt line every Roadmap row uses, and the lanes by initiative with their
 * drag to file and rank.
 */
import type { Dispatch, DragEvent, MutableRefObject, ReactNode, SetStateAction } from 'react';
import { Check, GripVertical } from 'lucide-react';
import type { DecideRow } from '../../../../shared/model/decide';
import type { Initiative } from '../../../../shared/model/initiatives';
import { isUnderWay, type RoadmapItem } from '../../../../shared/model/roadmap';
import { FactLink, QuietButton } from '../../components/bits';
import { Icon } from '../../components/Icon';
import { Fold, openFold, useFoldState } from '../../components/Lane';
import { askedInitiative, askOf } from '../../model/decideCalls';
import { bandGloss as initiativeGloss, spanWords, UNSORTED } from '../../model/initiativeBoard';
import { byRank, fileProject, moveInitiative, readInitiatives } from '../../model/initiativesData';
import type { PortfolioItem } from '../../model/portfolio';
import { NO_PROJECT_YET, UNSORTED_WORD } from '../../model/words';
import { DecideCall } from './Decide';
import type { Navigate } from './parts';
import { inInk, SaidWords, type Said } from './roadmapHealth';

/** The initiatives as the board has them, just after a write. */
const readInitiativesNow = () => readInitiatives().initiatives ?? [];

/** the lane, by initiative, of plans with no project */
export const NO_PROJECT_LANE = '(no-project)';

/** The quiet line under a row that says what a click just saved, with the
 * way back (Decide's receipt): where the click was, not far away. */
export interface Receipt {
   /** the row it sits under: `plan:<id>`, `project:<slug>`, or `added` */
   key: string;
   words: string;
   failed?: boolean;
   undo?: () => void;
   /** a plan it made, to open */
   open?: number;
   /** the project it planned, kept in its place in the list of no plan */
   project?: PortfolioItem;
   /** the plan it removed, kept in its place in the list of plans */
   gone?: RoadmapItem;
   /** the lane the planned or parked project was in, where it stays */
   lane?: Standing;
}

/** Where a project with no plan sits: Decide asks it for a plan, asks it
 * another call (most often whether to park it), or asks nothing. */
export type Standing = 'plan' | 'call' | 'none';

export function ReceiptLine({ receipt, onOpen }: { receipt: Receipt; onOpen: (id: number) => void }) {
   const open = receipt.open;
   return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-secondary bg-muted/40 px-3.5 py-1.5 text-xs text-ink-3">
         <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-2">
            {!receipt.failed && <Icon icon={Check} size={14} />}
            {receipt.words.replace(/\.$/, '')}.
         </span>
         {open != null && <FactLink onClick={() => onOpen(open)}>Open its plan</FactLink>}
         {/* a failed Undo keeps its button, to try again */}
         {receipt.undo && (
            <QuietButton
               onClick={receipt.undo}
               aria-label={receipt.failed ? 'Try the Undo again' : `Undo: ${receipt.words}`}
            >
               {receipt.failed ? 'Try again' : 'Undo'}
            </QuietButton>
         )}
      </div>
   );
}

/**
 * A lane of the timeline, the board's own fold: its name and how many rows
 * it holds, and for a team, its load in words in the band. One call owed,
 * one amber mark: while the lane's open and shows where its people run
 * out, that line says it, so the band's words stay ink.
 */
export function TimelineLane({
   id,
   label,
   count,
   gloss,
   load,
   lined,
   defaultOpen = true,
   showCount = true,
   phrase,
   gutter,
   keepEmpty = false,
   children,
}: {
   /** drawn even with no rows (an open initiative, or one Decide asks about) */
   keepEmpty?: boolean;
   /** an initiative's dates and counts, in ink (initiativeBoard.ts spanWords) */
   phrase?: string;
   /** the grip that ranks an initiative, outside the band's click target */
   gutter?: ReactNode;
   id: string;
   label: string;
   count: number;
   /** false when the label says its count in words */
   showCount?: boolean;
   gloss: string;
   /** a team's load in words; null for none */
   load: Said | null;
   /** its capacity line is drawn in it */
   lined: boolean;
   /** closed until someone opens it: a ledger of what needs nothing */
   defaultOpen?: boolean;
   children: ReactNode;
}) {
   const [open] = useFoldState(id, defaultOpen);
   const words = load && lined && open ? inInk(load) : load;
   return (
      <Fold
         id={id}
         defaultOpen={defaultOpen}
         label={label}
         count={count}
         showCount={showCount}
         gloss={gloss}
         gutter={gutter}
         keepEmpty={keepEmpty}
         detail={
            words ? (
               <span className="text-[11px]" title={words.title}>
                  <SaidWords said={words} />
               </span>
            ) : (
               phrase && <span className="text-[11px] tabular-nums">{phrase}</span>
            )
         }
      >
         {children}
      </Fold>
   );
}

/** What the initiative lanes read of the Roadmap: its state, its plans and
 * projects as shown, and the ways it says, fails, opens and drags. */
export interface LaneContext {
   asksPlan: ReadonlySet<string>;
   bySlug: ReadonlyMap<string, PortfolioItem>;
   callsHere: { all: readonly DecideRow[] };
   counted: (list: readonly RoadmapItem[]) => number;
   dragging: number | null;
   draggingLane: number | null;
   everyPlan: readonly RoadmapItem[] | null;
   everything: boolean;
   fail: (key: string, keep?: Pick<Receipt, 'gone' | 'undo'>) => void;
   gone: RoadmapItem | null;
   homeOf: (slug: string | null) => Initiative | undefined;
   inFlightRows: (list: PortfolioItem[]) => ReactNode;
   initiatives: readonly Initiative[] | null;
   laneId: (key: string) => string;
   laneKey: (slug: string | null) => string;
   narrowed: boolean;
   navigate: Navigate;
   openFromReceipt: (id: number) => void;
   ordered: readonly RoadmapItem[];
   overLane: string | null;
   person: (login: string) => void;
   planCalls: ReadonlyMap<number, unknown>;
   planRows: (
      list: RoadmapItem[],
      visible?: RoadmapItem[],
      options?: { ranked?: boolean; placed?: boolean }
   ) => ReactNode;
   projectCalls: ReadonlyMap<string, unknown>;
   q: string;
   receipt: Receipt | null;
   refocus: MutableRefObject<string[] | null>;
   run: MutableRefObject<unknown>;
   say: (next: Receipt | null, words?: string) => void;
   setAnnounced: Dispatch<SetStateAction<string>>;
   setDragging: Dispatch<SetStateAction<number | null>>;
   setDraggingLane: Dispatch<SetStateAction<number | null>>;
   setDropTarget: Dispatch<SetStateAction<number | null>>;
   setOverLane: Dispatch<SetStateAction<string | null>>;
   shownPlans: RoadmapItem[];
   shownUnplanned: PortfolioItem[];
}

/**
 * The Roadmap grouped by initiative: one lane per initiative in its rank,
 * then Unsorted and No project yet, each band with its grip (drag or the
 * arrow keys rank it) and its drop (a plan dropped there files its project
 * there). fileByDrag also serves a plan dropped on a row of another lane.
 */
export function initiativeLanes(c: LaneContext) {
   const {
      asksPlan,
      bySlug,
      callsHere,
      counted,
      dragging,
      draggingLane,
      everyPlan,
      everything,
      fail,
      gone,
      homeOf,
      inFlightRows,
      initiatives,
      laneId,
      laneKey,
      narrowed,
      navigate,
      openFromReceipt,
      ordered,
      overLane,
      person,
      planCalls,
      planRows,
      projectCalls,
      q,
      receipt,
      refocus,
      run,
      say,
      setAnnounced,
      setDragging,
      setDraggingLane,
      setDropTarget,
      setOverLane,
      shownPlans,
      shownUnplanned,
   } = c;
   // a plan dropped in another initiative's lane: its project filed there,
   // its priority left alone, the lane it went to opened on its receipt
   const fileByDrag = (item: RoadmapItem, to: string) => {
      const key = `plan:${item.id}`;
      const slug = item.project;
      if (!slug) {
         return setAnnounced(
            `${item.name} has no project yet, so it can’t be filed. Link it to its project in Edit details first.`
         );
      }
      if (to === NO_PROJECT_LANE) return;
      const from = homeOf(slug)?.slug ?? null;
      const target = to === UNSORTED ? null : to;
      const toName = target
         ? byRank(initiatives ?? []).find(i => i.slug === target)?.name ?? target
         : UNSORTED_WORD;
      run.current = null;
      void fileProject(slug, target, { expect: from }).then(r => {
         if ('error' in r) return say({ key, words: r.error.replace(/\.$/, ''), failed: true });
         openFold(laneId(to));
         refocus.current = [`roadmap-grip-${item.id}`];
         say({
            key,
            words: `Moved ${item.name} to ${toName}`,
            undo: () => {
               refocus.current = [`roadmap-grip-${item.id}`];
               void fileProject(slug, r.before.initiative, {
                  set_at: r.before.set_at,
                  baseline_prs: r.before.baseline_prs,
               }).then(back => {
                  if ('error' in back) return fail(key);
                  openFold(laneId(r.before.initiative ?? UNSORTED));
                  say(null, `Put ${item.name} back`);
               });
            },
         });
      });
   };
   // an initiative moved just above `before` (null: the bottom), with Undo
   // back to the one it sat above
   const rankMove = (moving: Initiative, before: number | null) => {
      const all = byRank(initiatives ?? []);
      const was = all[all.findIndex(i => i.id === moving.id) + 1]?.id ?? null;
      const wasAt = rankOf(moving);
      if (was === before) return;
      const key = `initiative:${moving.id}`;
      run.current = null;
      refocus.current = [`roadmap-lane-grip-${moving.id}`];
      void moveInitiative(moving.id, before).then(r => {
         if (r !== true) return say({ key, words: r.error.replace(/\.$/, ''), failed: true });
         const ranked = byRank(readInitiativesNow()).filter(
            i => i.status === 'open' && i.kind !== 'untracked'
         );
         const at = ranked.findIndex(i => i.id === moving.id) + 1;
         say({
            key,
            words: `Moved ${moving.name} to priority ${at}`,
            undo: () => {
               refocus.current = [`roadmap-lane-grip-${moving.id}`];
               void moveInitiative(moving.id, was).then(back =>
                  back === true
                     ? say(null, `Put ${moving.name} back at priority ${wasAt}`)
                     : fail(key)
               );
            },
         });
      });
   };
   // ----- by initiative: one lane per initiative, in its own rank -----
   // A lane holds its plans under way and its live projects with no plan;
   // its finished, dropped and parked plans live on its page, unless Decide
   // asks about one, which always shows (DESIGN.md, the lanes amendment).
   const allRanked = byRank(initiatives ?? []);
   const laneInitiatives = allRanked.filter(i => i.kind !== 'untracked');
   const rankOf = (i: Initiative) =>
      laneInitiatives.filter(x => x.status === 'open').findIndex(x => x.id === i.id) + 1;
   const heldPlan = (i: RoadmapItem) => i === gone || isUnderWay(i.status) || planCalls.has(i.id);
   // the call Decide asks about an initiative itself, with its strip
   const initiativeRowOf = (id: number) =>
      callsHere.all.find(r => !r.slug && askedInitiative(r) === id);
   const laneDrop = (key: string, initiative?: Initiative) => ({
      'data-lane-id': laneId(key),
      onDragOver: (e: DragEvent) => {
         if (dragging == null && draggingLane == null) return;
         if (draggingLane != null && !initiative) return;
         // a plan files through its project, never into the no-project lane
         if (key === NO_PROJECT_LANE) return;
         e.preventDefault();
         setOverLane(key);
      },
      onDragLeave: () => setOverLane(o => (o === key ? null : o)),
      onDrop: (e: DragEvent) => {
         e.preventDefault();
         setOverLane(null);
         if (draggingLane != null) {
            const moving = allRanked.find(i => i.id === draggingLane);
            setDraggingLane(null);
            if (moving && initiative && moving.id !== initiative.id)
               rankMove(moving, initiative.id);
            return;
         }
         const dropped = ordered.find(i => i.id === dragging);
         setDragging(null);
         setDropTarget(null);
         if (dropped && laneKey(dropped.project) !== key) fileByDrag(dropped, key);
      },
   });
   // the grip left of an initiative's band: drag it onto another band, or
   // press the up and down arrows, to change its rank
   const laneGrip = (i: Initiative, ranked: Initiative[]) => {
      const at = ranked.findIndex(x => x.id === i.id);
      return (
         <span
            id={`roadmap-lane-grip-${i.id}`}
            role="button"
            tabIndex={0}
            draggable
            aria-label={`${i.name}: priority ${
               at + 1
            }. Drag onto another initiative, or use the up and down arrow keys, to change its priority`}
            title="Drag to change its priority"
            onDragStart={e => {
               setDraggingLane(i.id);
               e.dataTransfer.effectAllowed = 'move';
               e.dataTransfer.setData('text/plain', `initiative:${i.id}`);
            }}
            onDragEnd={() => {
               setDraggingLane(null);
               setOverLane(null);
            }}
            onKeyDown={e => {
               if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
               e.preventDefault();
               const up = e.key === 'ArrowUp';
               const next = ranked[at + (up ? -1 : 1)];
               if (!next) return setAnnounced(`${i.name} is already ${up ? 'first' : 'last'}`);
               // above the one before, or above the one after the next
               const before = up
                  ? next.id
                  : allRanked[allRanked.findIndex(x => x.id === next.id) + 1]?.id ?? null;
               rankMove(i, before);
            }}
            className="hit flex-none cursor-grab rounded p-0.5 text-ink-3 hover:text-ink focus-visible:text-brand active:cursor-grabbing"
         >
            <Icon icon={GripVertical} size={13} />
         </span>
      );
   };
   const initiativeBody = (() => {
      const ranked = laneInitiatives.filter(i => i.status === 'open');
      const keys = [...laneInitiatives.map(i => i.slug), UNSORTED, NO_PROJECT_LANE];
      return keys.map(key => {
         const initiative = laneInitiatives.find(i => i.slug === key);
         const planned = shownPlans.filter(i => heldPlan(i) && laneKey(i.project) === key);
         const loose = everything ? shownUnplanned.filter(p => laneKey(p.slug) === key) : [];
         // its own question shows while the find names it, or nothing narrows
         const matched =
            !narrowed ||
            (!!q &&
               !!initiative &&
               [initiative.name, initiative.owner ?? ''].some(s => s.toLowerCase().includes(q)));
         const asked = initiative && matched ? initiativeRowOf(initiative.id) : undefined;
         // a closed initiative, or Unsorted, shows only while it holds a row
         if (!planned.length && !loose.length && !(asked && asked.reasons.length)) {
            if (!initiative || initiative.status !== 'open' || narrowed) return null;
         }
         const id = laneId(key);
         const projects = initiative?.projects.map(f => f.project) ?? [];
         const working = projects.filter(slug => bySlug.get(slug)?.status === 'live').length;
         // it rests closed unless it holds a call Decide asks
         const calls =
            !!asked?.reasons.length ||
            planned.some(i => planCalls.has(i.id)) ||
            loose.some(p => projectCalls.has(p.slug) || asksPlan.has(p.slug));
         const rank = initiative && initiative.status === 'open' ? rankOf(initiative) : 0;
         const label = initiative
            ? `${rank ? `${rank} ` : ''}${initiative.name}`
            : key === UNSORTED
            ? UNSORTED_WORD
            : NO_PROJECT_YET;
         return (
            <div
               key={id}
               {...laneDrop(key, initiative)}
               className="border-t border-secondary first:border-t-0"
               style={overLane === key ? { boxShadow: 'inset 0 2px 0 0 var(--brand)' } : undefined}
            >
               <TimelineLane
                  id={id}
                  label={label}
                  count={counted(planned) + loose.length}
                  gloss={
                     initiative
                        ? initiativeGloss(initiative, projects.length, working)
                        : key === UNSORTED
                        ? 'Projects filed nowhere yet. Decide asks where each one goes; drag a plan onto an initiative to file its project there.'
                        : 'Plans with no project label yet, so no initiative. Link each to its project in Edit details; Decide asks once one is active.'
                  }
                  load={null}
                  lined={false}
                  phrase={initiative ? spanWords(projects, everyPlan ?? []) : undefined}
                  gutter={rank ? laneGrip(initiative as Initiative, ranked) : undefined}
                  // an open initiative keeps its place in the list of
                  // contents with nothing in it
                  keepEmpty={!!initiative}
                  defaultOpen={calls || narrowed}
               >
                  {initiative && (
                     <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-secondary px-3.5 py-1.5 text-xs text-ink-3 first:border-t-0 sm:pl-[3.9375rem]">
                        <FactLink
                           onClick={() => navigate({ initiative: initiative.slug, project: null })}
                           title={`Open ${initiative.name}: its projects, owner and goal`}
                        >
                           Initiative page
                        </FactLink>
                        {initiative.owner && (
                           <span>
                              owned by{' '}
                              <FactLink
                                 onClick={() => person(initiative.owner as string)}
                                 title={`See ${initiative.owner} on People`}
                              >
                                 {initiative.owner}
                              </FactLink>
                           </span>
                        )}
                        {initiative.goal && <span className="text-ink-3">{initiative.goal}</span>}
                     </div>
                  )}
                  {initiative && asked && (
                     <div className="border-t border-secondary px-3.5 py-2 text-[13px] sm:pl-[3.9375rem]">
                        {asked.reasons.length > 0 && (
                           <p className="m-0 text-ink-2">
                              <span className="text-warn">{askOf(asked.reasons[0]).question}</span>
                           </p>
                        )}
                        <DecideCall row={asked} />
                     </div>
                  )}
                  {receipt?.key === `initiative:${initiative?.id}` && (
                     <ReceiptLine receipt={receipt} onOpen={openFromReceipt} />
                  )}
                  {planRows(planned, planned, { placed: true })}
                  {inFlightRows(loose)}
               </TimelineLane>
               {/* a rank move's receipt stays in view with the lane closed */}
               {initiative && receipt?.key === `initiative:${initiative.id}` && !calls && (
                  <ReceiptLine receipt={receipt} onOpen={openFromReceipt} />
               )}
            </div>
         );
      });
   })();
   return { fileByDrag, laneInitiatives, rankOf, initiativeBody };
}
