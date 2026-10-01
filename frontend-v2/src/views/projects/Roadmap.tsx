import {
   useEffect,
   useRef,
   useState,
   type DragEvent,
   type KeyboardEvent,
   type PointerEvent,
   type ReactNode,
} from 'react';
import {
   Check,
   ChevronLeft,
   ChevronRight,
   Flag,
   GripVertical,
   Plus,
   X,
   ZoomIn,
   ZoomOut,
} from 'lucide-react';
import { n } from '../../../../shared/format';
import { dayStart, firstOpenDay, utcDay } from '../../../../shared/model/projects';
import {
   addWeeks,
   bucketOf,
   checkRoadmapFields,
   MAX_WEEKS,
   mondayOf,
   moveBefore,
   NEXT_WEEKS,
   planEnd,
   ROADMAP_STATUSES,
   type RoadmapFields,
   type RoadmapItem,
   type RoadmapStatus,
   waitsOnProblem,
   weeksThrough,
} from '../../../../shared/model/roadmap';
import {
   LoadFailed,
   PrimaryButton,
   QuietButton,
   Segmented,
   textInputClass,
} from '../../components/bits';
import { Icon } from '../../components/Icon';
import { eyebrowText, Fold, GroupHeader, Rows, SubDoor, useFoldState } from '../../components/Lane';
import { useArmedConfirm } from '../../components/useArmedConfirm';
import { dateOf, dayOf, dayWords, useProjectsData, type Range } from '../../model/projectData';
import { findFilter, mainTeam, type PortfolioItem } from '../../model/portfolio';
import {
   createRoadmapItem,
   dismissRoadmapProblem,
   loadRoadmap,
   readRoadmap,
   removeRoadmapItem,
   reorderRoadmap,
   updateRoadmapItem,
   useRoadmap,
} from '../../model/roadmapData';
import {
   loadByWeek,
   mondaysBetween,
   spansFrom,
   weekMembers,
   type InFlightSpan,
} from '../../../../shared/model/load';
import {
   closedIssues,
   decideProjects,
   needsDecision,
   type DecideRow,
} from '../../../../shared/model/decide';
import {
   columnsFor,
   commitEnds,
   parseZoom,
   quarterOf,
   shiftZoom,
   zoomAround,
   zoomKey,
   zoomWords,
   type Column,
} from '../../model/roadmapTime';
import { NO_PLAN } from '../../model/words';
import { LoadChart } from './LoadChart';
import { NowNextLater } from './NowNextLater';
import {
   NarrowChip,
   openPlan,
   ORIGIN_OPTIONS,
   PageLink,
   switchView,
   type Navigate,
   type ProjectsNav,
} from './parts';
import {
   inInk,
   isAmber,
   loadWords,
   moveWords,
   PLAN_STATUS_WORD as STATUS_WORD,
   planWarnings,
   planWords,
   SaidWords,
   stepWithin,
   UpdatesPanel,
   type Said,
} from './roadmapHealth';

const DAY = 86400;

interface Horizon {
   from: number;
   to: number;
   start: string;
   end: string;
}

/** A day's place across the track, 0 to 100 (clamped). */
function at(day: string, h: Horizon): number {
   const t = dayStart(day) ?? h.from;
   return Math.min(100, Math.max(0, ((t - h.from) / (h.to - h.from)) * 100));
}

/** How each plan's bar reads: an outline before work starts, a fill once it
 * has, green when it's done, faint when it was dropped. */
const BAR_STYLE: Record<RoadmapStatus, { background: string; borderColor: string }> = {
   planned: { background: 'var(--brand-50)', borderColor: 'var(--brand)' },
   active: {
      background: 'color-mix(in oklab, var(--brand) 55%, transparent)',
      borderColor: 'var(--brand)',
   },
   done: {
      background: 'color-mix(in oklab, var(--ok) 45%, transparent)',
      borderColor: 'var(--ok)',
   },
   dropped: {
      background: 'color-mix(in oklab, var(--ink-3) 15%, transparent)',
      borderColor: 'color-mix(in oklab, var(--ink-3) 40%, transparent)',
   },
   parked: {
      background: 'transparent',
      borderColor: 'color-mix(in oklab, var(--ink-3) 55%, transparent)',
   },
};

const weekWords = dayWords;

const inputClass = `px-2.5 ${textInputClass}`;
const selectClass = `px-2 ${textInputClass}`;
/** a quiet text-link action: Cancel, Undo, Close */
const linkClass =
   'hit pressable rounded border-0 bg-transparent p-0 text-xs text-ink-3 underline hover:text-brand';

/** What a plan's span is: its first week and length. */
type Span = { start: string; weeks: number };

/** A picked origin, as the chip that says the rows are narrowed to it. */
const ORIGIN_ONLY: Record<NonNullable<ProjectsNav['origin']>, string> = {
   asked: 'Only plans asked for',
   fire: 'Only fires',
   chosen: 'Only the team’s own picks',
   unsaid: 'Only plans with no word on where they came from',
};

/**
 * The Mondays a plan can start on, said the board's way ("Aug 3") and
 * grouped by month: half a year back to two years ahead, with the plan's
 * own start among them wherever it is.
 */
function startChoices(today: string, keep: string): { month: string; days: string[] }[] {
   const first = addWeeks(mondayOf(today), -26);
   const days = new Set(Array.from({ length: 131 }, (_, i) => addWeeks(first, i)));
   days.add(keep);
   const months = new Map<string, string[]>();
   for (const day of [...days].sort()) {
      const month = dateOf(day).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      months.set(month, [...(months.get(month) ?? []), day]);
   }
   return [...months].map(([month, list]) => ({ month, days: list }));
}

/** A check's problem as a sentence, and the field it's about, which takes
 * the focus: a missing name is said beside the name, not by Save. */
function problemAt(error: string): { text: string; field: 'name' | 'lead' | null } {
   return {
      text: error.charAt(0).toUpperCase() + error.slice(1),
      field: /\bname\b/.test(error) ? 'name' : /\blead\b/.test(error) ? 'lead' : null,
   };
}

/**
 * What an item waits on: the chosen items, each with a way to drop it, and a
 * list to add another. The list leaves out the item itself, dropped work, and
 * anything that would make a loop, so every choice it offers can be saved.
 */
function WaitsOnField({
   id,
   value,
   all,
   onChange,
}: {
   /** the item being edited; null for a new one */
   id: number | null;
   value: number[];
   all: RoadmapItem[];
   onChange: (ids: number[]) => void;
}) {
   const byId = new Map(all.map(i => [i.id, i]));
   const choices = all.filter(
      i =>
         i.id !== id &&
         i.status !== 'dropped' &&
         !value.includes(i.id) &&
         !waitsOnProblem(id, [...value, i.id], all)
   );
   return (
      <span className="flex flex-wrap items-center gap-1.5">
         {value.map(other => {
            const name = byId.get(other)?.name ?? `plan ${other}`;
            return (
               <span
                  key={other}
                  className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
               >
                  {name}
                  <button
                     type="button"
                     aria-label={`Stop waiting on ${name}`}
                     onClick={() => onChange(value.filter(x => x !== other))}
                     className="hit pressable rounded border-0 bg-transparent p-0 text-ink-3 hover:text-ink"
                  >
                     <Icon icon={X} size={12} />
                  </button>
               </span>
            );
         })}
         {choices.length > 0 && (
            <select
               aria-label="Add a plan it waits on"
               className={selectClass}
               value=""
               onChange={e => e.target.value && onChange([...value, Number(e.target.value)])}
            >
               <option value="">{value.length ? 'Add another' : 'Nothing'}</option>
               {choices.map(i => (
                  <option key={i.id} value={i.id}>
                     {i.name}
                  </option>
               ))}
            </select>
         )}
      </span>
   );
}

/**
 * The editor for one item, open in the roadmap's own flow (work in progress
 * lives inline, never in a popover a stray click can close). The same form
 * adds a new item. Saves through the shared checks, so a mistake reads the
 * same here as the server would say it, beside the field it's about.
 */
function Editor({
   item,
   all,
   projects,
   teams,
   people,
   today,
   navigate,
   onDone,
   onAdded,
   onUpdates,
}: {
   /** null to add a new item */
   item: RoadmapItem | null;
   /** every item on the roadmap, to choose what this one waits on */
   all: RoadmapItem[];
   projects: { slug: string; name: string }[];
   teams: string[];
   people: string[];
   today: string;
   navigate: Navigate;
   /** closed: saved, cancelled, or removed (`removed` says which) */
   onDone: (removed?: boolean) => void;
   /** a new item, saved */
   onAdded?: (added: RoadmapItem) => void;
   /** to its updates instead */
   onUpdates?: () => void;
}) {
   // what the form started from: Save sends only the fields changed since,
   // so a bar dragged while the editor is open keeps its new weeks
   const [initial] = useState<RoadmapFields>(() =>
      item
         ? {
              name: item.name,
              project: item.project,
              team: item.team,
              lead: item.lead,
              status: item.status,
              origin: item.origin,
              start: item.start,
              weeks: item.weeks,
              notes: item.notes,
              waits_on: item.waits_on,
           }
         : {
              name: '',
              project: null,
              team: null,
              lead: null,
              status: 'planned',
              origin: null,
              start: addWeeks(mondayOf(utcDay(Date.now() / 1000)), 1),
              weeks: 4,
              notes: '',
              waits_on: [],
           }
   );
   const [draft, setDraft] = useState<RoadmapFields>(initial);
   const [error, setError] = useState<ReturnType<typeof problemAt> | null>(null);
   const [saving, setSaving] = useState(false);
   const { armed, run } = useArmedConfirm();
   const nameRef = useRef<HTMLInputElement>(null);
   const leadRef = useRef<HTMLInputElement>(null);
   useEffect(() => {
      // the roadmap scrolls the open editor into view, clear of its headers
      nameRef.current?.focus({ preventScroll: true });
   }, []);
   const set = (patch: Partial<RoadmapFields>) => setDraft(d => ({ ...d, ...patch }));
   const save = async () => {
      const changed = item
         ? (Object.fromEntries(
              Object.entries(draft).filter(
                 ([key, value]) =>
                    JSON.stringify(value) !== JSON.stringify(initial[key as keyof RoadmapFields])
              )
           ) as Partial<RoadmapFields>)
         : draft;
      if (item && !Object.keys(changed).length) return onDone();
      const checked = checkRoadmapFields(changed, { partial: !!item });
      if ('error' in checked) {
         const problem = problemAt(checked.error);
         setError(problem);
         (problem.field === 'name'
            ? nameRef
            : problem.field === 'lead'
            ? leadRef
            : null
         )?.current?.focus();
         return;
      }
      setSaving(true);
      const added = item ? null : await createRoadmapItem(checked.fields);
      const ok = item ? await updateRoadmapItem(item.id, checked.fields) : !!added;
      setSaving(false);
      if (!ok) {
         // said here, where Save was clicked, rather than at the top
         const { problem } = readRoadmap();
         dismissRoadmapProblem();
         return setError({
            text: problem ?? 'Couldn’t save the plan. Try again in a minute.',
            field: null,
         });
      }
      if (added) onAdded?.(added);
      onDone();
   };
   const field = (label: string, control: ReactNode, wide = false) => (
      <label className={`flex flex-col gap-1 text-xs text-ink-3 ${wide ? 'sm:col-span-2' : ''}`}>
         {label}
         {control}
      </label>
   );
   const fieldError = (at: 'name' | 'lead') =>
      error?.field === at && (
         <span id={`roadmap-error-${at}`} className="text-xs text-ink-2">
            {error.text}
         </span>
      );
   const projectOptions =
      draft.project && !projects.some(p => p.slug === draft.project)
         ? [...projects, { slug: draft.project, name: draft.project }]
         : projects;
   return (
      <form
         className="grid gap-3 border-t border-secondary bg-muted/40 px-3.5 py-3 sm:grid-cols-4"
         onSubmit={e => {
            e.preventDefault();
            void save();
         }}
         onKeyDown={e => {
            if (e.key === 'Escape') onDone();
         }}
      >
         <div className="flex flex-col gap-1 sm:col-span-2">
            {field(
               'Name',
               <input
                  ref={nameRef}
                  className={inputClass}
                  value={draft.name}
                  maxLength={120}
                  onChange={e => set({ name: e.target.value })}
                  placeholder="What the work is called"
                  aria-invalid={error?.field === 'name' || undefined}
                  aria-describedby={error?.field === 'name' ? 'roadmap-error-name' : undefined}
               />
            )}
            {fieldError('name')}
         </div>
         {field(
            'Status',
            <Segmented
               ariaLabel="status"
               value={draft.status}
               options={ROADMAP_STATUSES.map(s => [s, STATUS_WORD[s]])}
               onChange={status => set({ status })}
            />,
            true
         )}
         {field(
            'Where it came from',
            <Segmented
               ariaLabel="where it came from"
               value={draft.origin ?? 'unsaid'}
               options={ORIGIN_OPTIONS}
               onChange={o => set({ origin: o === 'unsaid' ? null : o })}
            />,
            true
         )}
         {field(
            'Starts the week of',
            <select
               className={selectClass}
               value={draft.start}
               onChange={e => set({ start: e.target.value })}
            >
               {startChoices(today, draft.start).map(g => (
                  <optgroup key={g.month} label={g.month}>
                     {g.days.map(day => (
                        <option key={day} value={day}>
                           {weekWords(day)}
                        </option>
                     ))}
                  </optgroup>
               ))}
            </select>
         )}
         {field(
            'Length in weeks',
            <input
               type="number"
               min={1}
               max={MAX_WEEKS}
               className={inputClass}
               value={draft.weeks}
               onChange={e => set({ weeks: Number(e.target.value) })}
            />
         )}
         {/* the same ends Decide commits to, from the start above */}
         <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3 sm:col-span-4">
            Run it through
            {commitEnds(today)
               .filter(c => c.end >= draft.start)
               .map(c => {
                  const weeks = weeksThrough(draft.start, c.end);
                  return (
                     <QuietButton
                        key={c.end}
                        onClick={() => set({ weeks })}
                        title={`${weekWords(draft.start)} to ${weekWords(
                           planEnd({ start: draft.start, weeks })
                        )}, ${n(weeks, 'week')}`}
                     >
                        {c.label}
                     </QuietButton>
                  );
               })}
         </div>
         <div className="flex flex-col gap-1 text-xs text-ink-3">
            {field(
               'Project it tracks',
               <select
                  className={selectClass}
                  value={draft.project ?? ''}
                  onChange={e => set({ project: e.target.value || null })}
               >
                  <option value="">No project yet</option>
                  {projectOptions.map(p => (
                     <option key={p.slug} value={p.slug}>
                        {p.name}
                     </option>
                  ))}
               </select>
            )}
            {/* under the box, outside its label; only for the project it
                tracks now, not one picked and not saved yet */}
            {initial.project && draft.project === initial.project && (
               <span>
                  <PageLink g={{ slug: initial.project }} navigate={navigate} />
               </span>
            )}
         </div>
         {field(
            'Team',
            <select
               className={selectClass}
               value={draft.team ?? ''}
               onChange={e => set({ team: e.target.value || null })}
            >
               <option value="">No team</option>
               {[...new Set([...teams, ...(draft.team ? [draft.team] : [])])].map(t => (
                  <option key={t} value={t}>
                     {t}
                  </option>
               ))}
            </select>
         )}
         <div className="flex flex-col gap-1">
            {field(
               'Lead',
               <>
                  <input
                     ref={leadRef}
                     className={inputClass}
                     list="roadmap-people"
                     value={draft.lead ?? ''}
                     onChange={e => set({ lead: e.target.value.trim() || null })}
                     placeholder="GitHub login"
                     aria-invalid={error?.field === 'lead' || undefined}
                     aria-describedby={error?.field === 'lead' ? 'roadmap-error-lead' : undefined}
                  />
                  <datalist id="roadmap-people">
                     {people.map(login => (
                        <option key={login} value={login} />
                     ))}
                  </datalist>
               </>
            )}
            {fieldError('lead')}
         </div>
         {field(
            'Waits on',
            <WaitsOnField
               id={item?.id ?? null}
               value={draft.waits_on}
               all={all}
               onChange={waits_on => set({ waits_on })}
            />,
            true
         )}
         {field(
            'Notes',
            <textarea
               className="min-h-16 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px]"
               value={draft.notes}
               maxLength={2000}
               onChange={e => set({ notes: e.target.value })}
               placeholder="Why it matters"
            />,
            true
         )}
         <div className="flex flex-wrap items-center gap-3 sm:col-span-4">
            <PrimaryButton disabled={saving}>{item ? 'Save' : 'Add to the roadmap'}</PrimaryButton>
            <button type="button" onClick={() => onDone()} className={linkClass}>
               Cancel
            </button>
            {onUpdates && (
               <button type="button" onClick={onUpdates} className={linkClass}>
                  See its updates
               </button>
            )}
            <span role="status" className="text-xs text-ink-2">
               {error && !error.field ? error.text : ''}
            </span>
            <span className="flex-1" />
            {item && (
               <button
                  type="button"
                  onClick={() =>
                     run(async () => {
                        if (await removeRoadmapItem(item.id)) return onDone(true);
                        // said here, like a save that failed
                        const { problem } = readRoadmap();
                        dismissRoadmapProblem();
                        setError({
                           text: problem ?? 'Couldn’t remove the plan. Try again in a minute.',
                           field: null,
                        });
                     })
                  }
                  // armed, it's the one thing here to look at; red stays CI's
                  className={`hit pressable rounded border-0 bg-transparent p-0 text-xs ${
                     armed ? 'font-semibold text-warn' : 'text-ink-3 hover:text-ink'
                  }`}
               >
                  {armed ? 'Click again to remove it' : 'Remove from the roadmap'}
               </button>
            )}
         </div>
      </form>
   );
}

/** One grid for every part of the timeline, so the header, the load chart
 * and the rows put a day at the same x. On a phone the names stack above a
 * full-width track, since a track beside them would be too narrow to read. */
const rowGrid =
   'grid grid-cols-1 items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,17rem)_1fr] lg:grid-cols-[minmax(0,21rem)_1fr]';

/** The time axis the timeline shares: where a day falls, and the lines
 * drawn through every row. */
interface Axis {
   horizon: Horizon;
   at: (day: string) => number;
   /** month lines (quarters stronger), or at month scale week lines (months
    * stronger) */
   lines: { left: number; strong: boolean }[];
   todayAt: number | null;
   /** the week picked on the load chart, as a band through every row */
   picked: { left: number; width: number } | null;
}

/** The axis's lines and today's dashed line, inside one row's track and
 * reaching through the row's padding, so they run unbroken down the list. */
function Gridlines({ axis }: { axis: Axis }) {
   return (
      <>
         {axis.lines.map(l => (
            <span
               key={`${l.left}:${l.strong}`}
               aria-hidden
               className="pointer-events-none absolute -top-[7px] -bottom-1.5 border-l"
               style={{
                  left: `${l.left}%`,
                  borderColor: l.strong
                     ? 'var(--border)'
                     : 'color-mix(in oklab, var(--border) 40%, transparent)',
               }}
            />
         ))}
         {axis.todayAt != null && (
            <span
               aria-hidden
               className="pointer-events-none absolute -top-[7px] -bottom-1.5 border-l border-dashed"
               style={{ left: `${axis.todayAt}%`, borderColor: 'var(--brand)' }}
            />
         )}
         {axis.picked && (
            <span
               aria-hidden
               className="pointer-events-none absolute -top-[7px] -bottom-1.5"
               style={{
                  left: `${axis.picked.left}%`,
                  width: `${axis.picked.width}%`,
                  background: 'color-mix(in oklab, var(--ink) 7%, transparent)',
               }}
            />
         )}
      </>
   );
}

/** A word on a row that does what it names when clicked: a lead opens them
 * on People, a health opens the updates, what it waits on opens that. */
function RowWord({
   onClick,
   title,
   className = '',
   id,
   expanded,
   tabIndex,
   children,
}: {
   onClick: () => void;
   title: string;
   className?: string;
   id?: string;
   /** it opens something under the row, open now or not */
   expanded?: boolean;
   /** -1 when another word on the row already does the same */
   tabIndex?: number;
   children: ReactNode;
}) {
   return (
      <button
         type="button"
         id={id}
         onClick={onClick}
         title={title}
         aria-expanded={expanded}
         tabIndex={tabIndex}
         className={`pressable rounded border-0 bg-transparent p-0 text-left text-[11px] hover:underline ${className}`}
      >
         {children}
      </button>
   );
}

/** The quiet line under a row that says what a click just saved, with the
 * way back (Decide's receipt): where the click was, not far away. */
interface Receipt {
   /** the row it sits under: `plan:<id>`, `project:<slug>`, or `added` */
   key: string;
   words: string;
   failed?: boolean;
   undo?: () => void;
   /** a plan it made, to open */
   open?: number;
   /** the project it planned, kept in its place in the list of no plan */
   project?: PortfolioItem;
}

function ReceiptLine({ receipt, onOpen }: { receipt: Receipt; onOpen: (id: number) => void }) {
   const open = receipt.open;
   return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-secondary bg-muted/40 px-3.5 py-1.5 text-xs text-ink-3">
         <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-2">
            {!receipt.failed && <Icon icon={Check} size={14} />}
            {receipt.words.replace(/\.$/, '')}.
         </span>
         {open != null && (
            <button type="button" onClick={() => onOpen(open)} className={linkClass}>
               Open its plan
            </button>
         )}
         {receipt.undo && (
            <button type="button" onClick={receipt.undo} className={linkClass}>
               Undo
            </button>
         )}
      </div>
   );
}

/** The words inside a plan's bar, color by its fill. */
const BAR_TEXT: Record<RoadmapStatus, string> = {
   planned: 'var(--brand-700)',
   active: 'var(--ink)',
   done: 'var(--ink)',
   dropped: 'var(--ink-3)',
   parked: 'var(--ink-3)',
};

/** A plan's piece of bar past its end: amber when that's the call it owes,
 * else ink, since another of its words already carries the amber. A 10%
 * tint keeps the words on it readable (5:1). */
const OVER_STYLE = {
   amber: { tint: 'color-mix(in oklab, var(--warn) 10%, transparent)', edge: 'var(--warn)' },
   ink: {
      tint: 'color-mix(in oklab, var(--ink-3) 12%, transparent)',
      edge: 'color-mix(in oklab, var(--ink-3) 70%, transparent)',
   },
};

/**
 * One planned item: its grip and place in the order, its name (the door to
 * its project's page, as everywhere in the tab, or to its editor when it
 * tracks no project), its words, and its bar, which says its dates and weeks
 * inside when there's room. A click on the bar opens the editor; a drag
 * moves the plan, and a drag on its right edge (shown on hover and focus)
 * changes the length. Both snap to whole weeks, Escape puts the bar back
 * mid-drag, and with the bar focused the arrow keys do the same (Shift
 * changes the length). Every mark on the track says what it is: a plan still
 * in flight past its end grows a piece labeled "+3 wk over" up to today,
 * fading on after it since nothing says when it ends, and its milestone is
 * a flag with its date.
 */
function PlanRow({
   item,
   all,
   rank,
   axis,
   today,
   linked,
   open,
   onEdit,
   onUpdates,
   onPerson,
   onOpenItem,
   onOpenProject,
   onMove,
   onShow,
   dragHandlers,
   dropHere,
}: {
   item: RoadmapItem;
   /** every item, for what this one waits on */
   all: RoadmapItem[];
   rank: number;
   axis: Axis;
   today: string;
   linked: PortfolioItem | undefined;
   /** what's open under the row: its editor, its updates, or nothing */
   open: 'plan' | 'updates' | null;
   onEdit: () => void;
   onUpdates: () => void;
   onPerson: (login: string) => void;
   onOpenItem: (id: number) => void;
   onOpenProject: (slug: string) => void;
   /** a drag or an arrow key moved or resized it */
   onMove: (to: Span) => void;
   /** bring a day into view: the plan is outside the weeks shown */
   onShow: (day: string) => void;
   dragHandlers: {
      grip: Record<string, unknown>;
      row: Record<string, unknown>;
   };
   dropHere: boolean;
}) {
   const trackRef = useRef<HTMLSpanElement>(null);
   // set while a drag moves the bar, so letting go isn't also a click
   const dragged = useRef(false);
   const [preview, setPreview] = useState<Span | null>(null);
   const { horizon, at: place } = axis;
   const plan = preview ?? { start: item.start, weeks: item.weeks };
   const end = planEnd(plan);
   const left = place(plan.start);
   const right = place(addWeeks(plan.start, plan.weeks));
   // the same warnings, in the same words, as now, next and later
   const w = planWarnings(
      item,
      all,
      today,
      linked ? { live: linked.status === 'live', target: linked.target } : null
   );
   const project = item.project;
   // past its end, the bar runs on to today, then fades
   const now = place(today);
   const overWidth = w.over ? now - right : 0;
   const over = isAmber(w.over) ? OVER_STYLE.amber : OVER_STYLE.ink;
   const fade = w.over ? Math.min(100, place(addWeeks(today, 3))) - now : 0;
   // the linked project's milestone, while the plan can still move to meet it
   const stillPlanned = item.status === 'planned' || item.status === 'active';
   const target = stillPlanned ? linked?.target ?? null : null;
   const due = target?.due_on?.slice(0, 10) ?? null;
   const targetName = target?.title ? `The milestone ${target.title}` : 'Its target';

   const commit = (next: Span) => {
      if (next.start !== item.start || next.weeks !== item.weeks) onMove(next);
   };
   const grab = (e: PointerEvent, mode: 'move' | 'resize') => {
      if (e.button !== 0 || !trackRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const width = trackRef.current.getBoundingClientRect().width;
      const pxPerWeek = (width / ((horizon.to - horizon.from) / DAY)) * 7;
      const x0 = e.clientX;
      const from = { start: item.start, weeks: item.weeks };
      let latest = from;
      let cancelled = false;
      dragged.current = false;
      const move = (ev: globalThis.PointerEvent) => {
         if (Math.abs(ev.clientX - x0) > 4) dragged.current = true;
         const dw = Math.round((ev.clientX - x0) / pxPerWeek);
         latest =
            mode === 'move'
               ? { start: addWeeks(from.start, dw), weeks: from.weeks }
               : { start: from.start, weeks: Math.min(MAX_WEEKS, Math.max(1, from.weeks + dw)) };
         setPreview(latest);
      };
      // Escape mid-drag puts the bar back where it was
      const cancel = (ev: globalThis.KeyboardEvent) => {
         if (ev.key !== 'Escape') return;
         ev.preventDefault();
         cancelled = true;
         dragged.current = true;
         window.removeEventListener('pointermove', move);
         setPreview(null);
      };
      const up = () => {
         window.removeEventListener('pointermove', move);
         window.removeEventListener('pointerup', up);
         window.removeEventListener('keydown', cancel);
         setPreview(null);
         if (!cancelled) commit(latest);
         // the click that comes with letting go has been heard by then
         setTimeout(() => {
            dragged.current = false;
         }, 0);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('keydown', cancel);
   };
   const keys = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 1 : -1;
      commit(
         e.shiftKey
            ? { start: item.start, weeks: Math.min(MAX_WEEKS, Math.max(1, item.weeks + step)) }
            : { start: addWeeks(item.start, step), weeks: item.weeks }
      );
   };
   // one line of what the planner acts on; PR counts live on the project list
   const meta: ReactNode[] = [
      <RowWord
         key="status"
         id={`roadmap-status-${item.id}`}
         onClick={onEdit}
         expanded={open === 'plan'}
         title={
            w.status ? `${w.status.title} Click to change it.` : 'Change its status or its plan'
         }
      >
         {w.status ? <SaidWords said={w.status} /> : STATUS_WORD[item.status]}
      </RowWord>,
   ];
   if (w.health) {
      meta.push(
         <RowWord
            key="health"
            onClick={onUpdates}
            expanded={open === 'updates'}
            className="text-ink-2"
            title={`${w.health.title}\nClick to see its updates and post one.`}
         >
            <SaidWords said={w.health} />
         </RowWord>
      );
   }
   const lead = item.lead;
   if (lead) {
      meta.push(
         <RowWord key="lead" onClick={() => onPerson(lead)} title={`Open ${lead}’s row on People`}>
            {lead}
         </RowWord>
      );
   }
   const waits = w.waits;
   if (waits) {
      meta.push(
         <RowWord
            key="waits"
            onClick={() => onOpenItem(waits.opens.id)}
            title={`${waits.title}. Click to open ${waits.opens.name}.`}
         >
            <SaidWords said={waits} />
         </RowWord>
      );
   }
   // past its end is said once: by its piece of bar, or here while that's
   // out of the weeks shown
   if (w.over && overWidth <= 0) {
      meta.push(
         <RowWord key="over" onClick={onEdit} title={`${w.over.title} Click to change the plan.`}>
            <SaidWords said={w.over} />
         </RowWord>
      );
   }
   if (w.target && project) {
      meta.push(
         <RowWord
            key="target"
            onClick={() => onOpenProject(project)}
            title={`${w.target.title} Click to open the project.`}
         >
            <SaidWords said={w.target} />
         </RowWord>
      );
   }
   const span = `${weekWords(plan.start)} to ${weekWords(end)}`;
   return (
      <div
         {...dragHandlers.row}
         className="border-t border-secondary first:border-t-0"
         style={dropHere ? { boxShadow: 'inset 0 2px 0 0 var(--brand)' } : undefined}
      >
         <div className={`${rowGrid} px-3.5 py-1.5 hover:bg-muted`}>
            <span className="flex min-w-0 items-center gap-2">
               <span
                  {...dragHandlers.grip}
                  id={`roadmap-grip-${item.id}`}
                  role="button"
                  tabIndex={0}
                  draggable
                  aria-label={`${item.name}: priority ${rank}. Drag, or use the up and down arrow keys, to change its place`}
                  title="Drag to change its priority"
                  className="flex-none cursor-grab touch-none text-ink-3 hover:text-ink focus-visible:text-brand active:cursor-grabbing"
               >
                  <Icon icon={GripVertical} size={13} />
               </span>
               <span className="w-5 flex-none text-right text-xs text-ink-3 tabular-nums">
                  {rank}
               </span>
               <span className="flex min-w-0 flex-col">
                  {project ? (
                     <button
                        type="button"
                        onClick={() => onOpenProject(project)}
                        className="hit pressable min-w-0 rounded border-0 bg-transparent p-0 text-left text-[13px] font-medium break-words text-ink hover:text-brand"
                        title="Open the project’s page"
                     >
                        {item.name}
                     </button>
                  ) : (
                     <button
                        type="button"
                        aria-expanded={open === 'plan'}
                        onClick={onEdit}
                        className="hit pressable min-w-0 rounded border-0 bg-transparent p-0 text-left text-[13px] font-medium break-words text-ink hover:text-brand"
                        title="Edit this plan; it tracks no project yet"
                     >
                        {item.name}
                     </button>
                  )}
                  <span className="flex min-w-0 flex-wrap gap-x-2 text-[11px] text-ink-3">
                     {meta.map((m, i) => (
                        <span key={i} className="whitespace-nowrap">
                           {m}
                        </span>
                     ))}
                  </span>
               </span>
            </span>
            <span ref={trackRef} className="relative block h-9">
               <Gridlines axis={axis} />
               {right > left ? (
                  <button
                     type="button"
                     id={`roadmap-bar-${item.id}`}
                     aria-label={`${item.name}: planned ${span}, ${plan.weeks} weeks. Enter edits it; the left and right arrows move it a week, and with Shift they change its length.`}
                     title={`${span} · ${plan.weeks} weeks. Click to edit; drag to move, or drag the right edge to change the length. Escape cancels a drag.`}
                     onPointerDown={e => grab(e, 'move')}
                     onClick={() => {
                        if (!dragged.current) onEdit();
                     }}
                     onKeyDown={keys}
                     className="group/bar @container absolute top-1.5 h-4 cursor-grab touch-none overflow-hidden rounded-md border p-0 text-left active:cursor-grabbing"
                     style={{
                        left: `${left}%`,
                        width: `max(${right - left}%, 6px)`,
                        ...BAR_STYLE[item.status],
                     }}
                  >
                     {/* the weeks, when the bar has room; the dates too, when it has more */}
                     <span
                        aria-hidden
                        className="hidden px-1.5 text-[10px] leading-[14px] font-medium whitespace-nowrap tabular-nums @min-[2.75rem]:block @min-[9rem]:hidden"
                        style={{ color: BAR_TEXT[item.status] }}
                     >
                        {plan.weeks} wk
                     </span>
                     <span
                        aria-hidden
                        className="hidden px-1.5 text-[10px] leading-[14px] font-medium whitespace-nowrap tabular-nums @min-[9rem]:block"
                        style={{ color: BAR_TEXT[item.status] }}
                     >
                        {span} · {plan.weeks} wk
                     </span>
                     {/* the edge that changes the length, shown on hover and
                         focus so the bar says it can */}
                     <span
                        aria-hidden
                        onPointerDown={e => grab(e, 'resize')}
                        className="absolute inset-y-0 right-0 flex w-2 cursor-ew-resize items-center justify-center opacity-0 transition-opacity duration-150 group-hover/bar:opacity-100 group-focus-visible/bar:opacity-100 motion-reduce:transition-none"
                     >
                        <span
                           className="h-2.5 w-0.5 rounded-full"
                           style={{ background: BAR_STYLE[item.status].borderColor }}
                        />
                     </span>
                  </button>
               ) : (
                  !(w.over && overWidth > 0) && (
                     // outside the weeks shown: its dates, at the edge it's past
                     <button
                        type="button"
                        onClick={() => onShow(plan.start)}
                        className={`absolute top-1.5 inline-flex items-center gap-0.5 border-0 bg-transparent p-0 text-[10px] leading-4 whitespace-nowrap text-ink-3 tabular-nums hover:text-brand ${
                           right <= 0 ? 'left-1' : 'right-1'
                        }`}
                        title={`Planned ${span}, outside the weeks shown. Click to show it.`}
                     >
                        {right <= 0 && <Icon icon={ChevronLeft} size={10} />}
                        {span}
                        {right > 0 && <Icon icon={ChevronRight} size={10} />}
                     </button>
                  )
               )}
               {w.over && overWidth > 0 && (
                  <>
                     {fade > 0 && (
                        <span
                           aria-hidden
                           className="pointer-events-none absolute top-1.5 h-4"
                           style={{
                              left: `${now}%`,
                              width: `${fade}%`,
                              background: `linear-gradient(to right, ${over.tint}, transparent)`,
                           }}
                        />
                     )}
                     <button
                        type="button"
                        // the bar opens the same editor from the keyboard
                        tabIndex={-1}
                        onClick={onEdit}
                        className={`@container absolute top-1.5 h-4 rounded-r-md border border-l-0 p-0 text-left text-[10px] leading-[14px] font-medium whitespace-nowrap ${
                           isAmber(w.over) ? 'text-warn' : 'text-ink-2'
                        }`}
                        style={{
                           left: `${right}%`,
                           width: `${overWidth}%`,
                           background: over.tint,
                           borderColor: over.edge,
                        }}
                        title={`${w.over.title} Click to change the plan.`}
                     >
                        {/* its words inside it when they fit (two digits need
                            more room), else just past today's line, where it
                            ends: never cut */}
                        <span
                           className={`hidden px-1 ${
                              w.over.weeks < 10 ? '@min-[4rem]:block' : '@min-[4.5rem]:block'
                           }`}
                        >
                           {w.over.mark}
                        </span>
                        <span
                           className={`absolute top-0 left-full pl-1.5 ${
                              w.over.weeks < 10 ? '@min-[4rem]:hidden' : '@min-[4.5rem]:hidden'
                           }`}
                        >
                           {w.over.mark}
                        </span>
                     </button>
                  </>
               )}
               {due && project && due >= horizon.start && due < horizon.end && (
                  <button
                     type="button"
                     // the name opens the same project from the keyboard
                     tabIndex={-1}
                     onClick={() => onOpenProject(project)}
                     className="absolute top-[23px] inline-flex items-center gap-0.5 border-0 bg-transparent p-0 text-[10px] leading-3 font-medium whitespace-nowrap text-ink-2 hover:underline"
                     style={{
                        left: `${place(due)}%`,
                        // near the right edge, the words go on the flag's left
                        transform: place(due) > 80 ? 'translateX(-100%)' : undefined,
                     }}
                     title={`${targetName}, due ${weekWords(due)}. Click to open the project.`}
                  >
                     <Icon icon={Flag} size={10} />
                     {weekWords(due)} target
                  </button>
               )}
               {preview && (
                  <span
                     className="pointer-events-none absolute -top-3 z-[1] rounded bg-surface px-1 text-[10px] whitespace-nowrap text-ink-2 shadow-sm tabular-nums"
                     style={{ left: `${left}%` }}
                  >
                     {span} · {plan.weeks} weeks
                  </span>
               )}
            </span>
         </div>
      </div>
   );
}

/**
 * A live project with no plan, on one line: the plus that opens its chooser
 * (it offers, so it shows on the row's hover or focus, and always on touch,
 * which has no hover), its name (the door to its page), its lead and open
 * PRs, and a dashed bar over the weeks its PRs have run, fading past today
 * since nothing says when it ends. Dragging across its weeks plans it for
 * them; Escape lets go without planning.
 */
function InFlightRow({
   item,
   span,
   axis,
   today,
   choosing,
   saving,
   onChoose,
   onPlan,
   onOpen,
   onPerson,
}: {
   item: PortfolioItem;
   span: InFlightSpan | null;
   axis: Axis;
   today: string;
   /** its chooser is open */
   choosing: boolean;
   /** a plan for it is on its way to the server: no second one */
   saving: boolean;
   onChoose: () => void;
   onPlan: (plan: Span) => void;
   onOpen: () => void;
   onPerson: (login: string) => void;
}) {
   const trackRef = useRef<HTMLSpanElement>(null);
   const [drag, setDrag] = useState<Span | null>(null);
   const { at: place, horizon } = axis;
   const left = span ? place(span.start) : 0;
   const now = place(today);
   const tail = Math.min(100, place(addWeeks(today, 3))) - now;
   // the Monday under the pointer
   const weekAt = (x: number): string => {
      const box = (trackRef.current as HTMLSpanElement).getBoundingClientRect();
      const at = Math.min(1, Math.max(0, (x - box.left) / box.width));
      return mondayOf(utcDay(horizon.from + at * (horizon.to - horizon.from)));
   };
   const spanOf = (a: string, b: string): Span => {
      const [first, last] = a <= b ? [a, b] : [b, a];
      return { start: first, weeks: weeksThrough(first, last) };
   };
   // a drag across weeks plans it for them; a plain click opens the chooser
   const grab = (e: PointerEvent) => {
      if (e.button !== 0 || !trackRef.current || saving) return;
      e.preventDefault();
      const x0 = e.clientX;
      const from = weekAt(e.clientX);
      let latest = spanOf(from, from);
      let moved = false;
      let cancelled = false;
      const move = (ev: globalThis.PointerEvent) => {
         if (Math.abs(ev.clientX - x0) > 4) moved = true;
         if (!moved) return;
         latest = spanOf(from, weekAt(ev.clientX));
         setDrag(latest);
      };
      // Escape mid-drag lets go without planning it
      const cancel = (ev: globalThis.KeyboardEvent) => {
         if (ev.key !== 'Escape') return;
         ev.preventDefault();
         cancelled = true;
         window.removeEventListener('pointermove', move);
         setDrag(null);
      };
      const up = () => {
         window.removeEventListener('pointermove', move);
         window.removeEventListener('pointerup', up);
         window.removeEventListener('keydown', cancel);
         setDrag(null);
         if (cancelled) return;
         if (moved) onPlan(latest);
         else onChoose();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('keydown', cancel);
   };
   return (
      <div
         // a named group: the lane's fold is a group too
         className={`group/row ${rowGrid} border-t border-secondary px-3.5 py-1 first:border-t-0 hover:bg-muted`}
      >
         <span className="flex min-w-0 items-baseline gap-x-2">
            <button
               type="button"
               id={`roadmap-plus-${item.slug}`}
               onClick={onChoose}
               disabled={saving}
               aria-expanded={choosing}
               aria-label={`Plan ${item.name}`}
               title={`Put ${item.name} on the roadmap`}
               // an offer: it shows on the row's hover or focus, and stands
               // while its chooser is open
               className={`hit pressable flex-none self-center rounded-md border-0 bg-transparent p-0.5 text-brand transition-opacity duration-150 hover:bg-brand-50 focus-visible:opacity-100 disabled:opacity-40 group-hover/row:opacity-100 group-focus-within/row:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100 ${
                  choosing || saving ? 'opacity-100' : 'opacity-0'
               }`}
            >
               <Icon icon={Plus} size={13} />
            </button>
            <span className="min-w-0 break-words">
               <button
                  type="button"
                  onClick={onOpen}
                  className="hit pressable rounded border-0 bg-transparent p-0 text-left text-[13px] text-ink hover:text-brand"
                  title="Open the project’s page"
               >
                  {item.name}
               </button>
               <span className="ml-2 inline-flex gap-x-1.5 text-[11px] whitespace-nowrap text-ink-3">
                  {item.lead && (
                     <RowWord
                        onClick={() => onPerson(item.lead as string)}
                        title={`Open ${item.lead}’s row on People`}
                        className="text-ink-3"
                     >
                        {item.lead}
                     </RowWord>
                  )}
                  <RowWord
                     onClick={onOpen}
                     // the name opens the same page from the keyboard
                     tabIndex={-1}
                     title="Open the project and its PRs"
                     className="text-ink-3"
                  >
                     {saving ? 'Saving its plan…' : n(item.open, 'open PR')}
                  </RowWord>
               </span>
            </span>
         </span>
         <span
            ref={trackRef}
            onPointerDown={grab}
            className={`relative block h-6 touch-none ${saving ? '' : 'cursor-crosshair'}`}
            title="Drag across weeks to plan it for them, or click to pick an end date"
         >
            <Gridlines axis={axis} />
            {span && now > left && (
               <span
                  className="@container absolute top-1 h-4 overflow-hidden rounded-l-md border border-r-0 border-dashed"
                  style={{
                     left: `${left}%`,
                     width: `${now - left}%`,
                     borderColor: 'color-mix(in oklab, var(--ink-3) 70%, transparent)',
                     background: 'color-mix(in oklab, var(--ink-3) 14%, transparent)',
                  }}
                  title={`PRs since ${weekWords(span.start)}, and no plan saying when it ends`}
               >
                  <span className="hidden px-1.5 text-[10px] leading-[14px] whitespace-nowrap text-ink-2 @min-[8rem]:block">
                     since {weekWords(span.start)}, no plan
                  </span>
               </span>
            )}
            {span && tail > 0 && (
               <span
                  aria-hidden
                  className="pointer-events-none absolute top-1 h-4"
                  style={{
                     left: `${now}%`,
                     width: `${tail}%`,
                     background:
                        'linear-gradient(to right, color-mix(in oklab, var(--ink-3) 14%, transparent), transparent)',
                  }}
               />
            )}
            {drag && (
               <span
                  className="pointer-events-none absolute top-1 z-[1] h-4 rounded-md border border-dashed border-brand"
                  style={{
                     left: `${place(drag.start)}%`,
                     width: `${place(addWeeks(drag.start, drag.weeks)) - place(drag.start)}%`,
                     background: 'color-mix(in oklab, var(--brand) 15%, transparent)',
                  }}
               >
                  <span className="absolute -top-4 left-0 rounded bg-surface px-1 text-[10px] whitespace-nowrap text-ink-2 shadow-sm tabular-nums">
                     {weekWords(drag.start)} to {weekWords(planEnd(drag))} · {drag.weeks} wk
                  </span>
               </span>
            )}
         </span>
      </div>
   );
}

/**
 * Planning a project already in flight, open under its row: from the week
 * its PRs began (the work so far is part of the plan) through the end of a
 * coming month or quarter, the same calls Decide offers. Each one plans it
 * in one click; the editor is there for anything else.
 */
function PlanChooser({
   item,
   today,
   start,
   onPlan,
   onClose,
}: {
   item: PortfolioItem;
   today: string;
   /** the Monday of the week its PRs began */
   start: string;
   onPlan: (plan: Span) => void;
   onClose: () => void;
}) {
   return (
      <div
         className="flex flex-wrap items-center gap-2 border-t border-secondary bg-muted/40 px-3.5 py-2 text-xs text-ink-3"
         onKeyDown={e => {
            if (e.key === 'Escape') onClose();
         }}
      >
         Plan {item.name} from {weekWords(start)} through
         {commitEnds(today).map(c => {
            const plan = { start, weeks: weeksThrough(start, c.end) };
            return (
               <QuietButton
                  key={c.end}
                  onClick={() => onPlan(plan)}
                  title={`${weekWords(plan.start)} to ${weekWords(planEnd(plan))}, ${n(
                     plan.weeks,
                     'week'
                  )}`}
               >
                  {c.label}
               </QuietButton>
            );
         })}
         <span>or drag across its weeks on the timeline.</span>
         <button type="button" onClick={onClose} className={linkClass}>
            Cancel
         </button>
      </div>
   );
}

/**
 * The line in a team's lane where its people run out: the work in flight
 * above it, in priority order, has a developer each; the work in flight
 * below it doesn't. It turns the order into what to park. A click opens
 * Decide on that team.
 */
function CapacityLine({
   team,
   developers,
   onOpen,
}: {
   team: string;
   developers: number;
   onOpen: () => void;
}) {
   return (
      <button
         type="button"
         onClick={onOpen}
         className="pressable flex w-full items-center gap-2 border-0 border-t-2 border-dashed border-warn bg-transparent px-3.5 py-1 text-left text-[11px] font-medium text-warn hover:bg-muted"
         title={`${team} has ${n(
            developers,
            'developer'
         )}. Above this line, in priority order, are the first ${developers} plans and projects in progress this week; below it, anything in progress has nobody left to staff it. Park or finish something, or drag what matters less below the line. Click to see ${team}’s decisions.`}
      >
         Below here: more in progress than {team}’s {n(developers, 'developer')} can staff
      </button>
   );
}

/**
 * A lane of the timeline, the board's own fold: its name and how many rows
 * it holds, and for a team, its load in words in the band. One call owed,
 * one amber mark: while the lane's open and shows where its people run
 * out, that line says it, so the band's words stay ink.
 */
function TimelineLane({
   id,
   label,
   count,
   gloss,
   load,
   lined,
   children,
}: {
   id: string;
   label: string;
   count: number;
   gloss: string;
   /** a team's load in words; null for none */
   load: Said | null;
   /** its capacity line is drawn in it */
   lined: boolean;
   children: ReactNode;
}) {
   const [open] = useFoldState(id, true);
   const words = load && lined && open ? inInk(load) : load;
   return (
      <Fold
         id={id}
         defaultOpen
         label={label}
         count={count}
         gloss={gloss}
         detail={
            words && (
               <span className="text-[11px]" title={words.title}>
                  <SaidWords said={words} />
               </span>
            )
         }
      >
         {children}
      </Fold>
   );
}

/** The columns' names and the smaller marks under them (months under
 * quarters, Mondays under months, days under a week), in the sticky header.
 * A column that can fill the width is a button with a zoom glass. */
function AxisHeader({
   columns,
   ticks,
   axis,
   onZoom,
}: {
   columns: Column[];
   ticks: { left: number; label: string; zoom?: string }[];
   axis: Axis;
   onZoom: (key: string) => void;
}) {
   return (
      <div className={`${rowGrid} rounded-t-2xl border border-line bg-surface px-3.5 py-1.5`}>
         <span className={`hidden text-ink-3 sm:block ${eyebrowText}`}>Project</span>
         <span className="relative block h-9">
            {columns.map((c, i) => {
               const style = { left: `${axis.at(c.start)}%` };
               const zoom = c.zoom;
               // a sliver of a week at a month's edge keeps its line, not a name
               if (axis.at(c.end) - axis.at(c.start) < 8) {
                  return (
                     <span
                        key={c.start}
                        aria-hidden
                        className="absolute top-0 h-3 border-l border-line"
                        style={style}
                     />
                  );
               }
               // six quarters across a phone fit only without the year, so
               // it's said where it starts: the first column and each Q1
               const short = /^Q[2-4] \d{4}$/.test(c.label) && i > 0 ? c.label.slice(0, 2) : null;
               const label = short ? (
                  <>
                     <span className="sm:hidden">{short}</span>
                     <span className="hidden sm:inline">{c.label}</span>
                  </>
               ) : (
                  c.label
               );
               return zoom ? (
                  <button
                     key={c.start}
                     type="button"
                     onClick={() => onZoom(zoom)}
                     title={`Zoom in: fill the width with ${c.label}`}
                     // no .hit here: it sets position: relative, and this sits absolutely on the axis
                     className={`pressable absolute top-0 inline-flex items-center gap-1 rounded-none border-0 border-l border-line bg-transparent py-0 pl-1.5 pr-0 whitespace-nowrap text-ink-2 hover:text-brand ${eyebrowText}`}
                     style={style}
                  >
                     {label}
                     <span className="hidden sm:inline">
                        <Icon icon={ZoomIn} size={11} />
                     </span>
                  </button>
               ) : (
                  <span
                     key={c.start}
                     className={`absolute top-0 border-l border-line pl-1.5 whitespace-nowrap text-ink-2 ${eyebrowText}`}
                     style={style}
                  >
                     {label}
                  </span>
               );
            })}
            {ticks.map(t => {
               const zoom = t.zoom;
               return zoom ? (
                  <button
                     key={t.left}
                     type="button"
                     // a mouse shortcut: from the keyboard, the quarter's own
                     // name zooms in, and then its months are the columns
                     tabIndex={-1}
                     onClick={() => onZoom(zoom)}
                     title={`Zoom in: fill the width with ${dateOf(`${zoom}-01`).toLocaleDateString(
                        undefined,
                        { month: 'long', year: 'numeric' }
                     )}`}
                     className="pressable absolute bottom-0 hidden border-0 bg-transparent p-0 pl-1 text-[10px] text-ink-3 tabular-nums hover:text-brand hover:underline sm:block"
                     style={{ left: `${t.left}%` }}
                  >
                     {t.label}
                  </button>
               ) : (
                  <span
                     key={t.left}
                     className="absolute bottom-0 hidden pl-1 text-[10px] text-ink-3 tabular-nums sm:block"
                     style={{ left: `${t.left}%` }}
                  >
                     {t.label}
                  </span>
               );
            })}
         </span>
      </div>
   );
}

/**
 * The roadmap: the plan a project manager lays out, month by month or
 * quarter by quarter, set against everything actually in flight. Across the
 * top, how loaded each week is against the developers there are. Below, the
 * plans in priority order (drag to reorder, drag a bar to move it, drag its
 * end to resize), each with what its PRs really did, and then every live
 * project with no plan, on the same weeks, one click from being planned.
 * Lanes split both by team, each with its own load. The roadmap is
 * Pulldasher's own record (the one thing in this tab not read off GitHub),
 * saved as you go.
 */
export function Roadmap({
   items,
   teamMembers,
   teamOf,
   nav,
   navigate,
}: {
   /** the portfolio, for linking plans to projects and their PRs */
   items: PortfolioItem[];
   /** developer teams: name to logins */
   teamMembers: Record<string, string[]>;
   teamOf: (login: string) => string | null;
   nav: ProjectsNav;
   navigate: Navigate;
   /** the calls Decide asks for now (null while they load), so a plan's row
    * names the same call Decide and the Overview do */
   decisions?: DecideRow[] | null;
}) {
   const { items: plan, loadFailed, problem } = useRoadmap();
   const teams = Object.keys(teamMembers);
   // the open item is in the URL, so a link can open it; whether its editor
   // or its updates show under it is the door it was opened by
   const editing = nav.item;
   const [panel, setPanel] = useState<'plan' | 'updates'>('plan');
   const [adding, setAdding] = useState(false);
   const [dragging, setDragging] = useState<number | null>(null);
   const [dropTarget, setDropTarget] = useState<number | null>(null);
   const [choosing, setChoosing] = useState<string | null>(null);
   // what the last click saved, under its row, with the way back
   const [receipt, setReceipt] = useState<Receipt | null>(null);
   // the same, said to a screen reader, with what a key press moved
   const [announced, setAnnounced] = useState('');
   // projects whose plan is on its way to the server: a second click on the
   // plus mustn't plan one twice (the ref answers before a re-render can)
   const planning = useRef(new Set<string>());
   const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
   // a run of moves on one plan (arrow presses, or drag after drag) undoes
   // to where the run began
   const run = useRef<{ key: string; from: Span | number[]; team: string | null } | null>(null);
   // the controls to give the focus to after the next render, the first found
   const refocus = useRef<string[] | null>(null);
   const stickyRef = useRef<HTMLDivElement>(null);
   const now = new Date();
   const today = dayOf(now);
   const timeline = nav.scale !== 'now';
   const scale = nav.scale === 'month' ? 'month' : 'quarter';
   const zoom = timeline ? parseZoom(nav.zoom) : null;
   const columns = columnsFor(scale, zoom, now);
   // how fine the lines and marks are: quarters, months (seven across, or a
   // zoomed quarter's three), or a zoomed month's weeks
   const level =
      zoom?.kind === 'month' ? 'weeks' : scale === 'quarter' && !zoom ? 'quarters' : 'months';
   // zooming out goes up one step: a month to its quarter when the roadmap
   // is in quarters, else back to the whole view
   const zoomOut = zoom?.kind === 'month' && scale === 'quarter' ? zoomKey(quarterOf(zoom)) : null;
   const horizon: Horizon = {
      start: columns[0].start,
      end: columns[columns.length - 1].end,
      from: dayStart(columns[0].start) as number,
      to: dayStart(columns[columns.length - 1].end) as number,
   };
   const place = (day: string) => at(day, horizon);
   const weeks = mondaysBetween(horizon.start, horizon.end);
   // the first of every month in the horizon, and every day, for the lines
   const months =
      level === 'quarters'
         ? columns.flatMap(c => {
              const first = dateOf(c.start);
              return [0, 1, 2].map(i =>
                 dayOf(new Date(first.getFullYear(), first.getMonth() + i, 1))
              );
           })
         : columns.filter(c => c.start.endsWith('-01')).map(c => c.start);
   const days: string[] = [];
   if (level === 'weeks') {
      for (let d = dateOf(horizon.start); dayOf(d) < horizon.end; d.setDate(d.getDate() + 1)) {
         days.push(dayOf(d));
      }
   }
   const axis: Axis = {
      horizon,
      at: place,
      lines:
         level === 'quarters'
            ? months.map(day => ({ left: place(day), strong: columns.some(c => c.start === day) }))
            : level === 'months'
            ? [
                 ...weeks.map(week => ({ left: place(week), strong: false })),
                 ...months.map(day => ({ left: place(day), strong: true })),
              ]
            : [
                 ...days.map(day => ({ left: place(day), strong: false })),
                 ...columns.map(c => ({ left: place(c.start), strong: true })),
              ],
      todayAt: today >= horizon.start && today < horizon.end ? place(today) : null,
      picked: nav.week
         ? {
              left: place(nav.week),
              width: place(addWeeks(nav.week, 1)) - place(nav.week),
           }
         : null,
   };
   // under each column's name: its months, its Mondays' dates, or its days
   const ticks =
      level === 'quarters'
         ? months.map(day => ({
              left: place(day),
              label: dateOf(day).toLocaleDateString(undefined, { month: 'short' }),
              zoom: day.slice(0, 7),
           }))
         : level === 'months'
         ? weeks
              .filter(week => week >= horizon.start)
              .map(week => ({ left: place(week), label: String(Number(week.slice(8))) }))
         : days.map(day => ({ left: place(day), label: String(Number(day.slice(8))) }));
   // the horizon's own history, so a project's real span starts where its
   // first PR did, not where the date range picker begins
   const pastRange: Range = {
      start: horizon.start,
      end: today < horizon.end ? today : horizon.end,
   };
   const history = useProjectsData(pastRange)?.window.projects ?? {};
   const bySlug = new Map(items.map(i => [i.slug, i]));
   const lanes = nav.group === 'team';
   // Show: every row, only the plans, or only the projects with no plan
   const showPlans = nav.show !== 'unplanned';
   const everything = nav.show !== 'plan';
   const ordered = plan ?? [];
   const ids = ordered.map(i => i.id);
   const kept = ordered.filter(i => i.status !== 'dropped');
   const linkedSlugs = new Set(kept.flatMap(i => (i.project ? [i.project] : [])));
   // every project with PRs in the horizon, as a span: ones with PRs open
   // run to today, the rest end at their last merge or close
   const spans = spansFrom(
      history,
      Object.fromEntries(
         items.flatMap(i => (i.open > 0 && i.group ? [[i.slug, firstOpenDay(i.group)]] : []))
      ),
      horizon.start
   );
   // the projects with no plan that owe a decision keep counting in the weeks
   // ahead; smaller work ships (decide.ts)
   const closedProjects = closedIssues(items.flatMap(i => (i.project ? [i.project] : [])));
   const ahead = new Set(
      decideProjects({
         live: items.flatMap(i => (i.status === 'live' && i.group ? [i.group] : [])),
      })
         .filter(p => needsDecision(p, closedProjects))
         .map(p => p.slug)
   );
   const spanBySlug = new Map(spans.map(s => [s.slug, s]));
   // a project being planned here keeps its place while it saves, and then
   // as its receipt until the next thing saved
   const justPlanned = receipt && !receipt.failed ? receipt.project?.slug : undefined;
   const keepsPlace = (slug: string) => slug === justPlanned || saving.has(slug);
   // live projects with no plan, the longest-running first
   const unplanned = items
      .filter(i => i.status === 'live' && (!linkedSlugs.has(i.slug) || keepsPlace(i.slug)))
      .sort(
         (a, b) =>
            (spanBySlug.get(a.slug)?.start ?? today).localeCompare(
               spanBySlug.get(b.slug)?.start ?? today
            ) || a.name.localeCompare(b.name)
      );
   // the find box narrows the rows to a name, label, lead or team, on the
   // timeline and in now, next and later; the load chart still counts
   // everything
   const q = nav.find.trim().toLowerCase();
   const filter = findFilter(nav.find);
   const parentsOf = (slug: string | null) =>
      (slug && items.find(i => i.slug === slug)?.parents) || [];
   const found = (i: RoadmapItem) =>
      !filter ||
      filter({
         name: i.name,
         slug: i.project,
         lead: i.lead,
         team: i.team,
         parents: parentsOf(i.project),
      });
   // a week picked on the load chart narrows them to exactly what that week
   // counts, by the chart's own rule, so its numbers and its rows agree
   const picked = nav.week;
   const members = picked ? weekMembers({ today, plans: ordered, spans, ahead })(picked) : null;
   // an origin picked on the load chart keeps only the plans from there;
   // work with no plan has no origin to match
   const fromOrigin = (i: RoadmapItem) => !nav.origin || (i.origin ?? 'unsaid') === nav.origin;
   const shownPlans = showPlans
      ? ordered.filter(
           i =>
              found(i) &&
              fromOrigin(i) &&
              (!members ||
                 members.plans.has(i.id) ||
                 (!!i.project && members.projects.get(i.project) === 'on'))
        )
      : [];
   const shownUnplanned = nav.origin
      ? []
      : unplanned.filter(
           p =>
              (!filter || filter({ ...p, team: mainTeam(p, teamOf) })) &&
              (!members || members.projects.get(p.slug) === 'off' || keepsPlace(p.slug))
        );
   const narrowed = !!(q || picked || nav.origin);
   const of = (shown: number, total: number, word: string) =>
      narrowed ? `${shown} of ${n(total, word)}` : n(total, word);
   const developers = new Set(
      Object.values(teamMembers)
         .flat()
         .map(l => l.toLowerCase())
   ).size;
   const load = loadByWeek({ weeks, today, plans: ordered, spans, ahead });
   // this week's, for the chart's headline wherever the timeline is zoomed
   const [thisWeek] = loadByWeek({
      weeks: [mondayOf(today)],
      today,
      plans: ordered,
      spans,
      ahead,
   });
   // a project's lane: its plan's team, or else the team most of its
   // developers are on
   const planTeam = new Map(kept.flatMap(i => (i.project ? [[i.project, i.team ?? null]] : [])));
   const laneOfSlug = (slug: string) => {
      if (planTeam.has(slug)) return planTeam.get(slug) ?? null;
      const p = bySlug.get(slug);
      return p ? mainTeam(p, teamOf) : null;
   };
   const projectOptions = [...items]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(i => ({ slug: i.slug, name: i.name }));
   const people = [
      ...new Set([
         ...items.flatMap(i => [...i.developers, ...i.nonDevelopers, i.lead ?? '']),
         ...teams,
      ]),
   ].filter(Boolean);

   // a person clicked anywhere in the tab opens their row on People
   const person = (login: string) =>
      navigate({ ...switchView('people'), who: login }, { push: true });
   const open = (id: number, which: 'plan' | 'updates') => {
      // a second click on the same door closes it
      if (editing === id && panel === which) return close(id);
      setPanel(which);
      navigate({ item: id });
   };
   const close = (id: number) => {
      refocus.current = [`roadmap-status-${id}`];
      navigate({ item: null });
   };
   const openFromReceipt = (id: number) => {
      setPanel('plan');
      navigate(openPlan(nav, id));
   };
   const say = (next: Receipt | null, words?: string) => {
      if (next?.key !== run.current?.key) run.current = null;
      setReceipt(next);
      setAnnounced(words ?? (next ? `${next.words.replace(/\.$/, '')}.` : ''));
   };
   // a save that failed says so where the click was, not in the toolbar
   const fail = (key: string) => {
      const why = readRoadmap().problem;
      dismissRoadmapProblem();
      run.current = null;
      say({ key, words: why ?? 'Couldn’t save that. Try again in a minute', failed: true });
   };
   const moved = (item: RoadmapItem, to: Span) => {
      const key = `plan:${item.id}`;
      if (run.current?.key !== key || Array.isArray(run.current.from)) {
         run.current = { key, from: { start: item.start, weeks: item.weeks }, team: item.team };
      }
      const from = run.current.from as Span;
      void updateRoadmapItem(item.id, to).then(ok => {
         if (!ok) return fail(key);
         const words = moveWords(item.name, from, to);
         if (!words) return say(null, `${item.name} is back where it was`);
         say({
            key,
            words,
            undo: () => {
               run.current = null;
               refocus.current = [`roadmap-bar-${item.id}`, `roadmap-grip-${item.id}`];
               void updateRoadmapItem(item.id, from).then(back =>
                  back ? say(null, `Put ${item.name} back: ${planWords(from)}`) : fail(key)
               );
            },
         });
      });
   };
   const reorder = (item: RoadmapItem, next: number[], team?: string | null) => {
      const key = `plan:${item.id}`;
      if (run.current?.key !== key || !Array.isArray(run.current.from)) {
         run.current = { key, from: ids, team: item.team };
      }
      const { from, team: fromTeam } = run.current as { from: number[]; team: string | null };
      void Promise.all([
         reorderRoadmap(next),
         team === undefined ? true : updateRoadmapItem(item.id, { team }),
      ]).then(([order, lane]) => {
         if (!order || !lane) return fail(key);
         const where = team === undefined ? '' : `${team ?? 'No team'}, `;
         say({
            key,
            words: `Moved ${item.name} to ${where}priority ${next.indexOf(item.id) + 1}`,
            undo: () => {
               run.current = null;
               refocus.current = [`roadmap-grip-${item.id}`];
               const now = readRoadmap().items?.find(i => i.id === item.id)?.team ?? null;
               void Promise.all([
                  reorderRoadmap(from),
                  now === fromTeam ? true : updateRoadmapItem(item.id, { team: fromTeam }),
               ]).then(([a, b]) =>
                  a && b
                     ? say(null, `Put ${item.name} back at priority ${from.indexOf(item.id) + 1}`)
                     : fail(key)
               );
            },
         });
      });
   };
   const removed = (item: RoadmapItem, visible: number[]) => {
      // the focus goes to the plan that took its place
      const at = visible.indexOf(item.id);
      const next = visible[at + 1] ?? visible[at - 1];
      refocus.current = next == null ? null : [`roadmap-grip-${next}`];
      navigate({ item: null });
      say(null, `Removed ${item.name} from the roadmap`);
   };
   const added = (item: RoadmapItem) => {
      const rank = (readRoadmap().items ?? []).findIndex(i => i.id === item.id) + 1;
      refocus.current = ['roadmap-add'];
      say({
         key: 'added',
         words: `Added ${item.name} to the roadmap${rank ? `, at priority ${rank}` : ''}`,
         open: item.id,
      });
   };

   const handlersFor = (item: RoadmapItem, visible: number[]) => ({
      grip: {
         onDragStart: (e: DragEvent) => {
            setDragging(item.id);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(item.id));
         },
         onDragEnd: () => {
            setDragging(null);
            setDropTarget(null);
         },
         // up and down past the neighbor on screen, as the find box and the
         // lanes show it, and read out
         onKeyDown: (e: KeyboardEvent) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            e.preventDefault();
            const up = e.key === 'ArrowUp';
            const next = stepWithin(ids, visible, item.id, up ? -1 : 1);
            if (!next) return setAnnounced(`${item.name} is already ${up ? 'first' : 'last'} here`);
            refocus.current = [`roadmap-grip-${item.id}`];
            reorder(item, next);
         },
      },
      row: {
         onDragOver: (e: DragEvent) => {
            if (dragging == null) return;
            e.preventDefault();
            setDropTarget(item.id);
         },
         onDrop: (e: DragEvent) => {
            e.preventDefault();
            const dropped = ordered.find(i => i.id === dragging);
            setDragging(null);
            setDropTarget(null);
            if (!dropped || dropped.id === item.id) return;
            // in team lanes, dropping into another team's lane moves it there
            reorder(
               dropped,
               moveBefore(ids, dropped.id, item.id),
               lanes && dropped.team !== item.team ? item.team : undefined
            );
         },
      },
   });

   // the week a project's PRs began
   const runStart = (p: PortfolioItem) => mondayOf((p.group && firstOpenDay(p.group)) || today);
   const planProject = (p: PortfolioItem, span: Span) => {
      setChoosing(null);
      if (planning.current.has(p.slug)) return;
      planning.current.add(p.slug);
      setSaving(new Set(planning.current));
      const key = `project:${p.slug}`;
      void createRoadmapItem({
         name: p.name,
         project: p.slug,
         team: laneOfSlug(p.slug),
         lead: p.lead,
         // it has PRs in flight, so it's under way once its weeks have come
         status: span.start <= today ? 'active' : 'planned',
         ...span,
      }).then(made => {
         planning.current.delete(p.slug);
         setSaving(new Set(planning.current));
         if (!made) return fail(key);
         say({
            key,
            words: `Planned ${p.name}: ${planWords(span)}`,
            open: made.id,
            project: p,
            undo: () => {
               refocus.current = [`roadmap-plus-${p.slug}`];
               void removeRoadmapItem(made.id).then(ok =>
                  ok ? say(null, `${p.name} has no plan again`) : fail(key)
               );
            },
         });
      });
   };

   // into view, clear of the app's header and the roadmap's own sticky one,
   // which stay on top; one already on screen stays put
   const scrollClear = (el: HTMLElement | null) => {
      if (!el) return;
      const header =
         parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 0;
      const bar = stickyRef.current;
      const stuck = bar && getComputedStyle(bar).position === 'sticky' ? bar.offsetHeight : 0;
      el.style.scrollMarginTop = `${header + stuck + 8}px`;
      el.scrollIntoView({ block: 'nearest' });
   };
   // the open item, when it or what's open under it changes or the plan
   // first loads; and a new plan's form, which Add can open from far below
   const loaded = plan != null;
   useEffect(() => {
      if (loaded && nav.item != null)
         scrollClear(document.getElementById(`roadmap-item-${nav.item}`));
   }, [loaded, nav.item, panel]);
   useEffect(() => {
      if (adding) scrollClear(document.getElementById('roadmap-new'));
   }, [adding]);
   // after a move, a close or an undo, the focus goes back where it was:
   // a moved row's control can lose it as React moves the row
   useEffect(() => {
      const want = refocus.current;
      if (!want) return;
      refocus.current = null;
      const el = want.map(id => document.getElementById(id)).find(Boolean);
      el?.focus();
   });

   const planRows = (list: RoadmapItem[], visible: RoadmapItem[] = list) => {
      const visibleIds = visible.map(i => i.id);
      return list.map(item => {
         const key = `plan:${item.id}`;
         const isOpen = editing === item.id;
         return (
            <div key={item.id} id={`roadmap-item-${item.id}`}>
               <PlanRow
                  item={item}
                  all={ordered}
                  rank={ids.indexOf(item.id) + 1}
                  axis={axis}
                  today={today}
                  linked={item.project ? bySlug.get(item.project) : undefined}
                  open={isOpen ? panel : null}
                  onEdit={() => open(item.id, 'plan')}
                  onUpdates={() => open(item.id, 'updates')}
                  onPerson={person}
                  onOpenItem={openFromReceipt}
                  onOpenProject={slug => navigate({ project: slug })}
                  onMove={to => moved(item, to)}
                  onShow={day =>
                     zoom
                        ? navigate({ zoom: zoomKey(zoomAround(zoom.kind, dateOf(day))) })
                        : open(item.id, 'plan')
                  }
                  dragHandlers={handlersFor(item, visibleIds)}
                  dropHere={dropTarget === item.id && dragging !== item.id}
               />
               {receipt?.key === key && <ReceiptLine receipt={receipt} onOpen={openFromReceipt} />}
               {isOpen &&
                  (panel === 'updates' ? (
                     // its updates alone, the focus in the box for the next one
                     <div
                        onKeyDown={e => {
                           if (e.key === 'Escape') close(item.id);
                        }}
                     >
                        <UpdatesPanel
                           item={item}
                           autoFocus
                           actions={
                              <>
                                 <button
                                    type="button"
                                    onClick={() => setPanel('plan')}
                                    className={linkClass}
                                 >
                                    Change the plan
                                 </button>
                                 <button
                                    type="button"
                                    onClick={() => close(item.id)}
                                    className={linkClass}
                                 >
                                    Close
                                 </button>
                              </>
                           }
                        />
                     </div>
                  ) : (
                     <Editor
                        item={item}
                        all={ordered}
                        projects={projectOptions}
                        teams={teams}
                        people={people}
                        today={today}
                        navigate={navigate}
                        onUpdates={() => setPanel('updates')}
                        onDone={gone => (gone ? removed(item, visibleIds) : close(item.id))}
                     />
                  ))}
            </div>
         );
      });
   };
   const inFlightRows = (list: PortfolioItem[]) =>
      list.map(p => {
         const here = receipt?.key === `project:${p.slug}` ? receipt : null;
         return (
            <div key={p.slug}>
               {here && !here.failed ? (
                  // planned just now: the receipt stands where the row was
                  <ReceiptLine receipt={here} onOpen={openFromReceipt} />
               ) : (
                  <>
                     <InFlightRow
                        item={p}
                        span={spanBySlug.get(p.slug) ?? null}
                        axis={axis}
                        today={today}
                        choosing={choosing === p.slug}
                        saving={saving.has(p.slug)}
                        onChoose={() => setChoosing(choosing === p.slug ? null : p.slug)}
                        onPlan={span => planProject(p, span)}
                        onOpen={() => navigate({ project: p.slug })}
                        onPerson={person}
                     />
                     {choosing === p.slug && (
                        <PlanChooser
                           item={p}
                           today={today}
                           start={runStart(p)}
                           onPlan={span => planProject(p, span)}
                           onClose={() => {
                              refocus.current = [`roadmap-plus-${p.slug}`];
                              setChoosing(null);
                           }}
                        />
                     )}
                     {here && <ReceiptLine receipt={here} onOpen={openFromReceipt} />}
                  </>
               )}
            </div>
         );
      });

   const laneTitles = [
      ...new Set([...teams, ...ordered.map(i => i.team).filter((t): t is string => !!t)]),
   ];
   const body = lanes ? (
      [...laneTitles, null].map(team => {
         const inLane = (t: string | null | undefined) => (t ?? null) === team;
         const planned = ordered.filter(i => inLane(i.team));
         const loose = everything ? unplanned.filter(p => inLane(mainTeam(p, teamOf))) : [];
         const shownPlanned = shownPlans.filter(i => inLane(i.team));
         const shownLoose = everything
            ? shownUnplanned.filter(p => inLane(mainTeam(p, teamOf)))
            : [];
         if (!shownPlanned.length && !shownLoose.length) return null;
         const laneSpans = spans.filter(s => laneOfSlug(s.slug) === team);
         const laneLoad = loadByWeek({ weeks, today, plans: planned, spans: laneSpans, ahead });
         const developers = team ? teamMembers[team]?.length ?? 0 : 0;
         // where the team's people run out, in priority order: the row in
         // flight this week that's one more than it has developers. Plans
         // come first by priority; projects with no plan come after them all.
         let cut = -1;
         if (developers > 0 && !narrowed && everything) {
            const thisWeekIn = weekMembers({ today, plans: planned, spans: laneSpans, ahead })(
               mondayOf(today)
            );
            const inFlight = [
               ...shownPlanned.map(
                  i =>
                     thisWeekIn.plans.has(i.id) ||
                     (!!i.project && thisWeekIn.projects.get(i.project) === 'on')
               ),
               ...shownLoose.map(p => thisWeekIn.projects.get(p.slug) === 'off'),
            ];
            let seen = 0;
            cut = inFlight.findIndex(going => going && ++seen > developers);
         }
         const line = cut >= 0 && (
            <CapacityLine
               team={team as string}
               developers={developers}
               onOpen={() => navigate({ ...switchView('decide'), team })}
            />
         );
         const split = shownPlanned.length;
         const name = team ?? 'No team';
         const id = `roadmap:lane:${team ?? '(none)'}`;
         const looseWords = loose.length
            ? `, then ${of(
                 shownLoose.length,
                 loose.length,
                 'project'
              )} in progress with no plan, longest-running first`
            : '';
         return (
            <TimelineLane
               key={id}
               id={id}
               label={name}
               count={shownPlanned.length + shownLoose.length}
               gloss={`${name}: ${of(
                  shownPlanned.length,
                  planned.length,
                  'plan'
               )} in priority order${looseWords}.`}
               load={developers ? loadWords(laneLoad, developers, today) : null}
               lined={cut >= 0}
            >
               {cut >= 0 && cut < split ? (
                  <>
                     {planRows(shownPlanned.slice(0, cut), shownPlanned)}
                     {line}
                     {planRows(shownPlanned.slice(cut), shownPlanned)}
                     {inFlightRows(shownLoose)}
                  </>
               ) : cut >= split ? (
                  <>
                     {planRows(shownPlanned)}
                     {inFlightRows(shownLoose.slice(0, cut - split))}
                     {line}
                     {inFlightRows(shownLoose.slice(cut - split))}
                  </>
               ) : (
                  <>
                     {planRows(shownPlanned)}
                     {inFlightRows(shownLoose)}
                  </>
               )}
            </TimelineLane>
         );
      })
   ) : (
      <>
         {shownPlans.length > 0 && (
            <TimelineLane
               id="roadmap:planned"
               label="On the roadmap"
               count={shownPlans.length}
               gloss={`${of(
                  shownPlans.length,
                  ordered.length,
                  'plan'
               )} in priority order: what matters most is on top.`}
               load={null}
               lined={false}
            >
               {planRows(shownPlans)}
            </TimelineLane>
         )}
         {everything && shownUnplanned.length > 0 && (
            <TimelineLane
               id="roadmap:unplanned"
               label={NO_PLAN}
               count={shownUnplanned.length}
               gloss={`${of(
                  shownUnplanned.length,
                  unplanned.length,
                  'project'
               )} in progress with no plan, longest-running first. A project’s plus plans it.`}
               load={null}
               lined={false}
            >
               {inFlightRows(shownUnplanned)}
            </TimelineLane>
         )}
      </>
   );

   // what the find box and the load chart's picks narrow, put back in one click
   const showAll = () => navigate({ find: '', week: null, origin: null, show: 'all' });
   const nothingMatches = (in_: string) => (
      <div className="px-3.5 py-4 text-[13px] text-ink-3">
         Nothing {in_} matches
         {q ? ` “${nav.find.trim()}”` : ''}
         {timeline && picked ? ` in the week of ${weekWords(picked)}` : ''}.{' '}
         <button
            type="button"
            onClick={showAll}
            className="pressable rounded border-0 bg-transparent p-0 text-[13px] font-medium text-brand hover:underline"
         >
            Show all
         </button>
      </div>
   );
   const nnlPlans = ordered.filter(found);
   const receiptAdded = receipt?.key === 'added' && (
      <ReceiptLine receipt={receipt} onOpen={openFromReceipt} />
   );
   const newPlan = adding && (
      <div id="roadmap-new">
         <Editor
            item={null}
            all={ordered}
            projects={projectOptions}
            teams={teams}
            people={people}
            today={today}
            navigate={navigate}
            onAdded={added}
            onDone={() => {
               refocus.current = ['roadmap-add'];
               setAdding(false);
            }}
         />
      </div>
   );

   return (
      <section className="mb-7">
         {/* the timeline's toolbar and column names stay in place while its
             rows scroll, from sm up; on a phone they'd eat the screen */}
         <div
            ref={stickyRef}
            className={`z-[5] bg-[var(--canvas)] ${
               timeline ? 'sm:sticky sm:top-[var(--header-h,0px)]' : ''
            }`}
         >
            <GroupHeader
               title="What’s planned, and when"
               sub={
                  timeline ? (
                     <SubDoor
                        label="How the timeline works"
                        text="Top to bottom is priority; drag a plan’s grip or bar, or use the arrow keys"
                     >
                        <p className="m-0">
                           Drag a plan’s grip, or press the up and down arrow keys on it, to change
                           its place in the order.
                        </p>
                        <p className="m-0">
                           Drag a bar to move the plan, or its right edge to change its length. With
                           a bar focused, the left and right arrow keys do the same, with Shift for
                           the length. Escape cancels a drag, and Undo takes a move back.
                        </p>
                        <p className="m-0">
                           Click a bar to edit its plan, and a health word to see its updates and
                           post one. The counts beside the load chart, and a week’s bar in it,
                           narrow the rows to what they count.
                        </p>
                        <p className="m-0">
                           To plan a project with no plan, click its plus and pick an end, or drag
                           across its weeks.
                        </p>
                     </SubDoor>
                  ) : (
                     <SubDoor
                        label="How now, next and later works"
                        text="Each column is in priority order; click a plan to change it on the timeline"
                     >
                        <p className="m-0">
                           Now is work in progress, and plans whose start week has come. Next starts
                           within {NEXT_WEEKS} weeks, and Later after that.
                        </p>
                        <p className="m-0">
                           The columns come from each plan’s dates, so this and the timeline can’t
                           disagree. Done, dropped and parked plans aren’t shown.
                        </p>
                     </SubDoor>
                  )
               }
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-2">
               <Segmented
                  ariaLabel="roadmap layout"
                  value={nav.scale}
                  options={[
                     ['month', 'Months'],
                     ['quarter', 'Quarters'],
                     ['now', 'Now, next, later'],
                  ]}
                  onChange={next => navigate({ scale: next, zoom: null })}
               />
               {zoom && (
                  <span className="inline-flex items-center gap-1">
                     <QuietButton
                        size="md"
                        onClick={() => navigate({ zoom: zoomOut })}
                        title="Zoom out"
                     >
                        <Icon icon={ZoomOut} size={13} className="mr-1" />
                        {zoomOut
                           ? zoomWords(quarterOf(zoom))
                           : scale === 'quarter'
                           ? 'All quarters'
                           : 'All months'}
                     </QuietButton>
                     <button
                        type="button"
                        aria-label={`The ${zoom.kind} before`}
                        title={`The ${zoom.kind} before`}
                        onClick={() => navigate({ zoom: zoomKey(shiftZoom(zoom, -1)) })}
                        className="hit pressable rounded-md border-0 bg-transparent p-1 text-ink-3 hover:text-brand"
                     >
                        <Icon icon={ChevronLeft} size={15} />
                     </button>
                     <span className="min-w-[7rem] text-center text-[13px] font-semibold text-ink">
                        {zoomWords(zoom)}
                     </span>
                     <button
                        type="button"
                        aria-label={`The ${zoom.kind} after`}
                        title={`The ${zoom.kind} after`}
                        onClick={() => navigate({ zoom: zoomKey(shiftZoom(zoom, 1)) })}
                        className="hit pressable rounded-md border-0 bg-transparent p-1 text-ink-3 hover:text-brand"
                     >
                        <Icon icon={ChevronRight} size={15} />
                     </button>
                     {(today < horizon.start || today >= horizon.end) && (
                        <QuietButton
                           size="md"
                           onClick={() => navigate({ zoom: zoomKey(zoomAround(zoom.kind, now)) })}
                           title={`Zoom to this ${zoom.kind}`}
                        >
                           Today
                        </QuietButton>
                     )}
                  </span>
               )}
               {/* a span, not a label: a label would pass a click on its words
                   to the first option */}
               <span className="inline-flex items-center gap-2 text-xs text-ink-3">
                  Group by
                  <Segmented
                     ariaLabel="group by"
                     value={lanes ? 'team' : 'none'}
                     options={[
                        ['none', 'None'],
                        ['team', 'Team'],
                     ]}
                     onChange={group => navigate({ group })}
                  />
               </span>
               <span className="flex-1" />
               {/* what the load chart's counts and bars narrow the rows to,
                   each with its own way out: the chart scrolls away, these
                   stay in view */}
               {timeline && nav.show !== 'all' && (
                  <NarrowChip
                     label={nav.show === 'plan' ? 'Only plans' : 'Only projects with no plan'}
                     clear="Show everything"
                     onClear={() => navigate({ show: 'all' })}
                  />
               )}
               {timeline && nav.origin && (
                  <NarrowChip
                     label={ORIGIN_ONLY[nav.origin]}
                     clear="Show every plan"
                     onClear={() => navigate({ origin: null })}
                  />
               )}
               {timeline && picked && (
                  <NarrowChip
                     label={`Week of ${weekWords(picked)}`}
                     clear="Show every week"
                     onClear={() => navigate({ week: null })}
                  />
               )}
               <input
                  type="search"
                  aria-label="Find a project, lead or team"
                  placeholder="Find a project, lead or team"
                  value={nav.find}
                  onChange={e => navigate({ find: e.target.value })}
                  className={`w-52 px-2.5 ${textInputClass}`}
               />
               <QuietButton
                  size="md"
                  id="roadmap-add"
                  onClick={() => setAdding(a => !a)}
                  aria-expanded={adding}
                  // until the roadmap loads, a new plan would land in a list of one
                  disabled={!loaded}
               >
                  <Icon icon={Plus} size={14} className="mr-1.5" />
                  Add to the roadmap
               </QuietButton>
            </div>
            {problem && (
               <div
                  role="status"
                  className="mb-2 flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-[13px]"
               >
                  <span className="text-ink-2">{problem}</span>
                  <span className="flex-1" />
                  <button type="button" onClick={dismissRoadmapProblem} className={linkClass}>
                     Dismiss
                  </button>
               </div>
            )}
            {timeline && loaded && (
               <AxisHeader
                  columns={columns}
                  ticks={ticks}
                  axis={axis}
                  onZoom={key => navigate({ zoom: key })}
               />
            )}
         </div>
         <p role="status" className="sr-only">
            {announced}
         </p>
         {!loaded ? (
            // until it loads, every project would read as having no plan
            loadFailed ? (
               <LoadFailed what="the roadmap" onRetry={() => void loadRoadmap()} />
            ) : (
               <p className="m-0 text-[13px] text-ink-3">Loading the roadmap…</p>
            )
         ) : timeline ? (
            // its own stacking context, so nothing in it paints over the
            // sticky headers above
            <div className="isolate overflow-hidden rounded-b-2xl border border-t-0 border-line bg-surface">
               <LoadChart
                  weeks={load}
                  now={thisWeek}
                  developers={developers}
                  at={place}
                  todayAt={axis.todayAt}
                  when={today < horizon.start ? 'future' : today >= horizon.end ? 'past' : 'both'}
                  rowGrid={rowGrid}
                  picked={picked}
                  onPick={week => navigate({ week })}
                  show={nav.show}
                  onShow={show => navigate({ show })}
                  origin={nav.origin}
                  onOrigin={origin => navigate({ origin })}
                  onPeople={() => navigate(switchView('people'))}
               />
               {newPlan}
               {receiptAdded}
               {!ordered.length && !unplanned.length && !adding ? (
                  <div className="px-3.5 py-4 text-[13px] text-ink-3">
                     Nothing on the roadmap yet, and no projects in progress. Click Add to the
                     roadmap to start a plan.
                  </div>
               ) : (
                  <div>{body}</div>
               )}
               {narrowed &&
                  !shownPlans.length &&
                  !(everything && shownUnplanned.length) &&
                  nothingMatches('on the roadmap or in progress')}
            </div>
         ) : (
            <>
               {(newPlan || receiptAdded) && (
                  <div className="mb-3">
                     <Rows>
                        {newPlan}
                        {receiptAdded}
                     </Rows>
                  </div>
               )}
               {q && !nnlPlans.some(i => bucketOf(i, today)) ? (
                  <Rows>{nothingMatches('on the roadmap')}</Rows>
               ) : (
                  <NowNextLater
                     items={nnlPlans}
                     all={ordered}
                     bySlug={bySlug}
                     laneTitles={lanes ? laneTitles : null}
                     today={today}
                     onOpen={id => openFromReceipt(id)}
                  />
               )}
            </>
         )}
      </section>
   );
}
