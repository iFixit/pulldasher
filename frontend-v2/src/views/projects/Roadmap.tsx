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
   ChevronDown,
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
   checkRoadmapFields,
   blockersOf,
   healthStanding,
   MAX_WEEKS,
   mondayOf,
   moveBefore,
   periodPlan,
   planEnd,
   ROADMAP_STATUSES,
   type RoadmapFields,
   type RoadmapItem,
   type RoadmapStatus,
   waitsOnProblem,
   weeksThrough,
} from '../../../../shared/model/roadmap';
import { Segmented, textInputClass } from '../../components/bits';
import { Icon } from '../../components/Icon';
import { eyebrowText, Rows, useFoldState } from '../../components/Lane';
import { useArmedConfirm } from '../../components/useArmedConfirm';
import { dateOf, dayOf, dayWords, useProjectsData, type Range } from '../../model/projectData';
import { mainTeam, type PortfolioItem } from '../../model/portfolio';
import {
   createRoadmapItem,
   dismissRoadmapProblem,
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
   type LoadWeek,
} from '../../../../shared/model/load';
import { closedIssues, decideProjects, needsDecision } from '../../../../shared/model/decide';
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
import { LoadChart } from './LoadChart';
import { NowNextLater } from './NowNextLater';
import { openPlan, ORIGIN_OPTIONS, type Navigate, type ProjectsNav } from './parts';
import {
   healthWords,
   loadWords,
   PLAN_STATUS_WORD as STATUS_WORD,
   UpdatesPanel,
   waitsWords,
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

/** The editor's one-click plans, for organizing by month or quarter. */
const PERIODS: ['month' | 'quarter', 'this' | 'next', string][] = [
   ['month', 'this', 'This month'],
   ['month', 'next', 'Next month'],
   ['quarter', 'this', 'This quarter'],
   ['quarter', 'next', 'Next quarter'],
];

const inputClass = `px-2.5 ${textInputClass}`;
const selectClass = `px-2 ${textInputClass}`;

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
            const name = byId.get(other)?.name ?? `item ${other}`;
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
               aria-label="add something it waits on"
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
 * same here as the server would say it.
 */
function Editor({
   item,
   all,
   projects,
   teams,
   people,
   onDone,
}: {
   /** null to add a new item */
   item: RoadmapItem | null;
   /** every item on the roadmap, to choose what this one waits on */
   all: RoadmapItem[];
   projects: { slug: string; name: string }[];
   teams: string[];
   people: string[];
   onDone: () => void;
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
   const [error, setError] = useState<string | null>(null);
   const [saving, setSaving] = useState(false);
   const { armed, run } = useArmedConfirm();
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
      if ('error' in checked) return setError(checked.error);
      setSaving(true);
      const ok = item
         ? await updateRoadmapItem(item.id, checked.fields)
         : !!(await createRoadmapItem(checked.fields));
      setSaving(false);
      if (ok) onDone();
   };
   const field = (label: string, control: ReactNode, wide = false) => (
      <label className={`flex flex-col gap-1 text-xs text-ink-3 ${wide ? 'sm:col-span-2' : ''}`}>
         {label}
         {control}
      </label>
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
         {field(
            'Name',
            <input
               autoFocus
               className={inputClass}
               value={draft.name}
               maxLength={120}
               onChange={e => set({ name: e.target.value })}
               placeholder="What the work is called"
            />,
            true
         )}
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
            <input
               type="date"
               className={inputClass}
               value={draft.start}
               onChange={e => e.target.value && set({ start: mondayOf(e.target.value) })}
            />
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
         <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3 sm:col-span-4">
            Plan it for
            {PERIODS.map(([kind, which, label]) => (
               <button
                  key={label}
                  type="button"
                  onClick={() => set(periodPlan(kind, which, dayOf(new Date())))}
                  className="hit pressable rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-ink-2 hover:border-brand hover:text-brand"
               >
                  {label}
               </button>
            ))}
         </div>
         {field(
            'Tracks the PRs of',
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
         {field(
            'Lead',
            <>
               <input
                  className={inputClass}
                  list="roadmap-people"
                  value={draft.lead ?? ''}
                  onChange={e => set({ lead: e.target.value.trim() || null })}
                  placeholder="GitHub login"
               />
               <datalist id="roadmap-people">
                  {people.map(login => (
                     <option key={login} value={login} />
                  ))}
               </datalist>
            </>
         )}
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
            <button
               type="submit"
               disabled={saving}
               className="pressable rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-surface hover:bg-brand-700 disabled:opacity-40"
            >
               {item ? 'Save' : 'Add to the roadmap'}
            </button>
            <button
               type="button"
               onClick={onDone}
               className="hit pressable rounded border-0 bg-transparent p-0 text-xs text-ink-3 hover:text-ink"
            >
               Cancel
            </button>
            {error && <span className="text-xs text-warn">{error}</span>}
            <span className="flex-1" />
            {item && (
               <button
                  type="button"
                  onClick={() =>
                     run(async () => {
                        if (await removeRoadmapItem(item.id)) onDone();
                     })
                  }
                  className={`hit pressable rounded border-0 bg-transparent p-0 text-xs ${
                     armed ? 'font-semibold text-bad' : 'text-ink-3 hover:text-bad'
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

/** A word on a row that does what it names when clicked: a lead filters to
 * their work, a health opens the updates, what it waits on opens that. */
function RowWord({
   onClick,
   title,
   className = '',
   children,
}: {
   onClick: () => void;
   title: string;
   className?: string;
   children: ReactNode;
}) {
   return (
      <button
         type="button"
         onClick={onClick}
         title={title}
         className={`pressable rounded border-0 bg-transparent p-0 text-left text-[11px] hover:underline ${className}`}
      >
         {children}
      </button>
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

/**
 * One planned item: its grip and place in the order, its name (the door to
 * its editor), and its bar, which says its dates and weeks inside when
 * there's room. Drag the bar to move the plan, its right edge to change the
 * length; both snap to whole weeks, and with the bar focused the arrow keys
 * do the same (Shift changes the length). Every mark on the track says what
 * it is: a linked project still in flight past its plan grows an amber piece
 * labeled "+3 wk over", and its milestone is a flag with its date.
 */
function PlanRow({
   item,
   all,
   rank,
   axis,
   today,
   linked,
   editing,
   onEdit,
   onFind,
   onOpenItem,
   onOpenProject,
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
   editing: boolean;
   onEdit: () => void;
   /** narrow the roadmap to a lead's work */
   onFind: (text: string) => void;
   onOpenItem: (id: number) => void;
   onOpenProject: (slug: string) => void;
   dragHandlers: {
      grip: Record<string, unknown>;
      row: Record<string, unknown>;
   };
   dropHere: boolean;
}) {
   const trackRef = useRef<HTMLSpanElement>(null);
   // set while a drag moves the bar, so letting go isn't also a click
   const dragged = useRef(false);
   const [preview, setPreview] = useState<{ start: string; weeks: number } | null>(null);
   const { horizon, at: place } = axis;
   const plan = preview ?? { start: item.start, weeks: item.weeks };
   const end = planEnd(plan);
   const left = place(plan.start);
   const right = place(addWeeks(plan.start, plan.weeks));
   // running over: the plan's end has passed, the item isn't marked done or
   // dropped, and its project still has work in flight
   const stillPlanned = item.status === 'planned' || item.status === 'active';
   const over = stillPlanned && linked?.status === 'live' && today > end;
   const weeksOver = over
      ? Math.ceil(((dayStart(today) as number) - (dayStart(end) as number)) / (7 * DAY))
      : 0;
   // the linked project's milestone, while the plan can still move to meet
   // it. Work still running past its plan ends no sooner than today.
   const target = stillPlanned ? linked?.target ?? null : null;
   const due = target?.due_on?.slice(0, 10) ?? null;
   const expectedEnd = over ? today : end;
   const weeksLate =
      due && expectedEnd > due
         ? Math.ceil(((dayStart(expectedEnd) as number) - (dayStart(due) as number)) / (7 * DAY))
         : 0;
   const health = healthWords(healthStanding(item));
   const waits = waitsWords(item, all);

   const commit = (next: { start: string; weeks: number }) => {
      if (next.start !== item.start || next.weeks !== item.weeks) {
         void updateRoadmapItem(item.id, next);
      }
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
      const up = () => {
         window.removeEventListener('pointermove', move);
         window.removeEventListener('pointerup', up);
         setPreview(null);
         commit(latest);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
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
      <RowWord key="status" onClick={onEdit} title="Change its status or its plan">
         {STATUS_WORD[item.status]}
      </RowWord>,
   ];
   if (health) {
      meta.push(
         <RowWord
            key="health"
            onClick={onEdit}
            className={health.warn ? 'text-warn' : 'text-ink-2'}
            title={`${health.title} Click to see its updates and post one.`}
         >
            {health.text}
         </RowWord>
      );
   }
   const lead = item.lead;
   if (lead) {
      meta.push(
         <RowWord key="lead" onClick={() => onFind(lead)} title={`Show only ${lead}’s work`}>
            {lead}
         </RowWord>
      );
   }
   // what it waits on opens that item: the one that clashes, else the first
   const blockers = blockersOf(item, all);
   const blocker = (blockers.find(b => b.clash) ?? blockers[0])?.item;
   if (waits && blocker) {
      meta.push(
         <RowWord
            key="waits"
            onClick={() => onOpenItem(blocker.id)}
            className={waits.warn ? 'text-warn' : ''}
            title={`${waits.title}. Click to open ${blocker.name}.`}
         >
            {waits.text}
         </RowWord>
      );
   }
   if (over) {
      meta.push(
         <RowWord key="over" onClick={onEdit} className="text-warn" title="Change its plan">
            {n(weeksOver, 'week')} past the plan
         </RowWord>
      );
   }
   // an on-time milestone is only its flag on the track; a missed one is
   // said here too, since it asks for a new plan or a new date
   const project = item.project;
   if (due && weeksLate && project) {
      meta.push(
         <RowWord
            key="target"
            onClick={() => onOpenProject(project)}
            className="text-warn"
            title={`The milestone ${target?.title} is due ${weekWords(
               due
            )}. Click to open the project.`}
         >
            {due < today
               ? `missed its ${weekWords(due)} target`
               : `ends ${n(weeksLate, 'week')} after its ${weekWords(due)} target`}
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
                  role="button"
                  tabIndex={0}
                  draggable
                  aria-label={`${item.name}: priority ${rank}. Drag, or use the up and down arrow keys, to change its place`}
                  title="drag to change its priority"
                  className="flex-none cursor-grab touch-none text-ink-3 hover:text-ink focus-visible:text-brand active:cursor-grabbing"
               >
                  <Icon icon={GripVertical} size={13} />
               </span>
               <span className="w-5 flex-none text-right text-xs text-ink-3 tabular-nums">
                  {rank}
               </span>
               <span className="flex min-w-0 flex-col">
                  <button
                     type="button"
                     aria-expanded={editing}
                     onClick={onEdit}
                     className="hit pressable min-w-0 rounded border-0 bg-transparent p-0 text-left text-[13px] font-medium break-words text-ink hover:text-brand"
                     title="edit this item and its updates"
                  >
                     {item.name}
                  </button>
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
               {right > left && (
                  <button
                     type="button"
                     aria-label={`${item.name}: planned ${span}, ${plan.weeks} weeks. Left and right arrows move it a week; with Shift they change its length.`}
                     title={`${span} · ${plan.weeks} weeks. Click to edit; drag to move; drag the right edge to change the length.`}
                     onPointerDown={e => grab(e, 'move')}
                     onClick={() => {
                        if (dragged.current) dragged.current = false;
                        else onEdit();
                     }}
                     onKeyDown={keys}
                     className="@container absolute top-1.5 h-4 cursor-grab touch-none overflow-hidden rounded-md border p-0 text-left focus-visible:outline-2 focus-visible:outline-brand active:cursor-grabbing"
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
                     <span
                        aria-hidden
                        onPointerDown={e => grab(e, 'resize')}
                        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-md"
                     />
                  </button>
               )}
               {over && (
                  <button
                     type="button"
                     onClick={onEdit}
                     className="@container absolute top-1.5 h-4 cursor-pointer overflow-hidden rounded-r-md border border-l-0 p-0 text-left"
                     style={{
                        left: `${right}%`,
                        width: `${Math.max(0, place(today) - right)}%`,
                        background: 'color-mix(in oklab, var(--warn) 20%, transparent)',
                        borderColor: 'var(--warn)',
                     }}
                     title={`Still in flight ${n(
                        weeksOver,
                        'week'
                     )} past the plan. Click to change the plan.`}
                  >
                     <span className="hidden px-1 text-[10px] leading-[14px] font-medium whitespace-nowrap text-warn @min-[4.5rem]:block">
                        +{weeksOver} wk over
                     </span>
                  </button>
               )}
               {due && project && due >= horizon.start && due < horizon.end && (
                  <button
                     type="button"
                     onClick={() => onOpenProject(project)}
                     className="absolute top-[23px] inline-flex cursor-pointer items-center gap-0.5 border-0 bg-transparent p-0 text-[10px] leading-3 font-medium whitespace-nowrap hover:underline"
                     style={{
                        left: `${place(due)}%`,
                        color: weeksLate ? 'var(--warn)' : 'var(--ink-2)',
                        // near the right edge, the words go on the flag's left
                        transform: place(due) > 80 ? 'translateX(-100%)' : undefined,
                     }}
                     title={`The milestone ${target?.title}, due ${weekWords(
                        due
                     )}. Click to open the project.`}
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

/** What planning an in-flight project sets: its first week and length. */
type Span = { start: string; weeks: number };

/**
 * A live project with no plan, on one line: the plus that opens its chooser,
 * its name (the door to its page), its lead and open PRs, and a dashed bar
 * over the weeks its PRs have run, fading past today since nothing says when
 * it ends. Dragging across its weeks plans it for them.
 */
function InFlightRow({
   item,
   span,
   axis,
   today,
   choosing,
   onChoose,
   onPlan,
   onOpen,
   onFind,
}: {
   item: PortfolioItem;
   span: InFlightSpan | null;
   axis: Axis;
   today: string;
   /** its chooser is open */
   choosing: boolean;
   onChoose: () => void;
   onPlan: (plan: Span) => void;
   onOpen: () => void;
   onFind: (text: string) => void;
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
      if (e.button !== 0 || !trackRef.current) return;
      e.preventDefault();
      const x0 = e.clientX;
      const from = weekAt(e.clientX);
      let latest = spanOf(from, from);
      let moved = false;
      const move = (ev: globalThis.PointerEvent) => {
         if (Math.abs(ev.clientX - x0) > 4) moved = true;
         if (!moved) return;
         latest = spanOf(from, weekAt(ev.clientX));
         setDrag(latest);
      };
      const up = () => {
         window.removeEventListener('pointermove', move);
         window.removeEventListener('pointerup', up);
         setDrag(null);
         if (moved) onPlan(latest);
         else onChoose();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
   };
   return (
      <div
         className={`${rowGrid} border-t border-secondary px-3.5 py-1 first:border-t-0 hover:bg-muted`}
      >
         <span className="flex min-w-0 items-baseline gap-x-2">
            <button
               type="button"
               onClick={onChoose}
               aria-expanded={choosing}
               aria-label={`Plan ${item.name}`}
               title={`Put ${item.name} on the roadmap`}
               className="hit pressable flex-none self-center rounded-md border-0 bg-transparent p-0.5 text-brand hover:bg-brand-50"
            >
               <Icon icon={Plus} size={13} />
            </button>
            <span className="min-w-0 break-words">
               <button
                  type="button"
                  onClick={onOpen}
                  className="hit pressable rounded border-0 bg-transparent p-0 text-left text-[13px] text-ink hover:text-brand"
                  title="Open the project's page"
               >
                  {item.name}
               </button>
               <span className="ml-2 inline-flex gap-x-1.5 text-[11px] whitespace-nowrap text-ink-3">
                  {item.lead && (
                     <RowWord
                        onClick={() => onFind(item.lead as string)}
                        title={`Show only ${item.lead}’s work`}
                        className="text-ink-3"
                     >
                        {item.lead}
                     </RowWord>
                  )}
                  <RowWord
                     onClick={onOpen}
                     title="Open the project and its PRs"
                     className="text-ink-3"
                  >
                     {n(item.open, 'open PR')}
                  </RowWord>
               </span>
            </span>
         </span>
         <span
            ref={trackRef}
            onPointerDown={grab}
            className="relative block h-6 cursor-crosshair touch-none"
            title="Drag across the weeks to plan it for them, or click for the choices"
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
 * The choices for planning an in-flight project, open under its row: the
 * weeks its PRs have run and two more, or this or next month or quarter.
 * Each one plans it in one click; the editor is there for anything else.
 */
/**
 * Planning a project already in flight: from the week its PRs began (the
 * work so far is part of the plan) through the end of a coming month or
 * quarter, the same calls Decide offers.
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
   const choice = (label: string, plan: Span) => (
      <button
         type="button"
         onClick={() => onPlan(plan)}
         title={`${weekWords(plan.start)} to ${weekWords(planEnd(plan))}, ${n(plan.weeks, 'week')}`}
         className="hit pressable rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-ink-2 hover:border-brand hover:text-brand"
      >
         {label}
      </button>
   );
   return (
      <div
         className="flex flex-wrap items-center gap-2 border-t border-secondary bg-muted/40 px-3.5 py-2 text-xs text-ink-3"
         onKeyDown={e => {
            if (e.key === 'Escape') onClose();
         }}
      >
         Plan {item.name} from {weekWords(start)} through
         {commitEnds(today).map(c => (
            <span key={c.end}>{choice(c.label, { start, weeks: weeksThrough(start, c.end) })}</span>
         ))}
         <span>or drag across its weeks on the timeline.</span>
         <button
            type="button"
            onClick={onClose}
            className="hit pressable rounded border-0 bg-transparent p-0 text-xs text-ink-3 hover:text-ink"
         >
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
         title={`Work in flight above this line has one of ${team}’s developers each, in priority order; below it, there’s nobody left. Park or finish something, or move work below the line. Click for ${team}’s decisions.`}
      >
         Below here: more in flight than {team}’s {n(developers, 'developer')} can staff
      </button>
   );
}

/**
 * A lane's band: the button that folds it, its name, its counts, and, for a
 * team, the most it has in flight at once against its developers, in words.
 */
function LaneBand({
   title,
   counts,
   load,
   developers,
   today,
   open,
   onToggle,
}: {
   title: string;
   counts: string;
   load: LoadWeek[];
   /** the lane's developers, for its amber words; 0 to compare with nobody */
   developers: number;
   today: string;
   open: boolean;
   onToggle: () => void;
}) {
   const words = developers ? loadWords(load, developers, today) : null;
   return (
      <div className="border-t border-line bg-muted/40 px-3.5 py-[6px] first:border-t-0">
         <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="hit pressable flex min-w-0 flex-wrap items-baseline gap-x-2 rounded border-0 bg-transparent p-0 text-left"
         >
            <Icon
               icon={open ? ChevronDown : ChevronRight}
               size={13}
               className="flex-none self-center text-ink-3"
            />
            <span className={`text-ink-2 ${eyebrowText}`}>{title}</span>
            <span className="text-[11px] text-ink-3">{counts}</span>
            {words && (
               <span
                  className={`text-[11px] ${words.warn ? 'text-warn' : 'text-ink-3'}`}
                  title={words.title}
               >
                  {words.text}
               </span>
            )}
         </button>
      </div>
   );
}

/** A band that folds, remembering its choice like every fold on the board. */
function Lane({
   id,
   band,
   children,
}: {
   id: string;
   band: (open: boolean, toggle: () => void) => ReactNode;
   children: ReactNode;
}) {
   const [open, setOpen] = useFoldState(id, true);
   return (
      <div>
         {band(open, () => setOpen(!open))}
         {open && children}
      </div>
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
            {columns.map(c => {
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
               return zoom ? (
                  <button
                     key={c.start}
                     type="button"
                     onClick={() => onZoom(zoom)}
                     title={`Zoom in: fill the width with ${c.label}`}
                     // no .hit here: it sets position: relative, and this sits absolutely on the axis
                     className={`pressable absolute top-0 inline-flex items-center gap-1 rounded-none border-0 border-l border-line bg-transparent py-0 pl-1.5 pr-0 text-ink-2 hover:text-brand ${eyebrowText}`}
                     style={style}
                  >
                     {c.label}
                     <span className="hidden sm:inline">
                        <Icon icon={ZoomIn} size={11} />
                     </span>
                  </button>
               ) : (
                  <span
                     key={c.start}
                     className={`absolute top-0 border-l border-line pl-1.5 text-ink-2 ${eyebrowText}`}
                     style={style}
                  >
                     {c.label}
                  </span>
               );
            })}
            {ticks.map(t => {
               const zoom = t.zoom;
               return zoom ? (
                  <button
                     key={t.left}
                     type="button"
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
}) {
   const { items: plan, loadFailed, problem } = useRoadmap();
   const teams = Object.keys(teamMembers);
   // the open item is in the URL, so a link can open it; a new one is a draft
   const editing = nav.item;
   const openItem = (id: number | null) => navigate({ item: id });
   const [adding, setAdding] = useState(false);
   const [dragging, setDragging] = useState<number | null>(null);
   const [dropTarget, setDropTarget] = useState<number | null>(null);
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
   // live projects with no plan, the longest-running first
   const unplanned = items
      .filter(i => i.status === 'live' && !linkedSlugs.has(i.slug))
      .sort(
         (a, b) =>
            (spanBySlug.get(a.slug)?.start ?? today).localeCompare(
               spanBySlug.get(b.slug)?.start ?? today
            ) || a.name.localeCompare(b.name)
      );
   // the find box narrows the rows to a name, label, lead or team; the load
   // chart still counts everything
   const q = nav.find.trim().toLowerCase();
   const matches = (...words: (string | null | undefined)[]) =>
      !q || words.some(w => w?.toLowerCase().includes(q));
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
              matches(i.name, i.project, i.lead, i.team) &&
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
              matches(p.name, p.slug, p.lead, mainTeam(p, teamOf)) &&
              (!members || members.projects.get(p.slug) === 'off')
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

   const handlersFor = (item: RoadmapItem, index: number) => ({
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
         onKeyDown: (e: KeyboardEvent) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            e.preventDefault();
            const j = e.key === 'ArrowUp' ? index - 1 : index + 1;
            if (j < 0 || j >= ids.length) return;
            const next = [...ids];
            [next[index], next[j]] = [next[j], next[index]];
            void reorderRoadmap(next);
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
            const moved = ordered.find(i => i.id === dragging);
            if (moved && moved.id !== item.id) {
               void reorderRoadmap(moveBefore(ids, moved.id, item.id));
               // in team lanes, dropping into another team's lane moves it there
               if (lanes && moved.team !== item.team)
                  void updateRoadmapItem(moved.id, { team: item.team });
            }
            setDragging(null);
            setDropTarget(null);
         },
      },
   });

   // the week a project's PRs began
   const runStart = (p: PortfolioItem) => mondayOf((p.group && firstOpenDay(p.group)) || today);
   const [choosing, setChoosing] = useState<string | null>(null);
   const planProject = (p: PortfolioItem, span: Span) => {
      setChoosing(null);
      void createRoadmapItem({
         name: p.name,
         project: p.slug,
         team: laneOfSlug(p.slug),
         lead: p.lead,
         // it has PRs in flight, so it's under way once its weeks have come
         status: span.start <= today ? 'active' : 'planned',
         ...span,
      });
   };

   // bring the open item into view when it changes or the plan first loads;
   // one already on screen stays put
   const loaded = plan != null;
   useEffect(() => {
      if (!loaded || nav.item == null) return;
      document.getElementById(`roadmap-item-${nav.item}`)?.scrollIntoView({ block: 'nearest' });
   }, [loaded, nav.item]);

   const planRows = (list: RoadmapItem[]) =>
      list.map(item => {
         const index = ids.indexOf(item.id);
         const linked = item.project ? bySlug.get(item.project) : undefined;
         return (
            <div key={item.id} id={`roadmap-item-${item.id}`}>
               <PlanRow
                  item={item}
                  all={ordered}
                  rank={index + 1}
                  axis={axis}
                  today={today}
                  linked={linked}
                  editing={editing === item.id}
                  onEdit={() => openItem(editing === item.id ? null : item.id)}
                  onFind={text => navigate({ find: text })}
                  onOpenItem={id => navigate(openPlan(nav, id))}
                  onOpenProject={slug => navigate({ project: slug })}
                  dragHandlers={handlersFor(item, index)}
                  dropHere={dropTarget === item.id && dragging !== item.id}
               />
               {editing === item.id && (
                  <>
                     <Editor
                        item={item}
                        all={ordered}
                        projects={projectOptions}
                        teams={teams}
                        people={people}
                        onDone={() => openItem(null)}
                     />
                     <UpdatesPanel item={item} />
                  </>
               )}
            </div>
         );
      });
   const inFlightRows = (list: PortfolioItem[]) =>
      list.map(p => (
         <div key={p.slug}>
            <InFlightRow
               item={p}
               span={spanBySlug.get(p.slug) ?? null}
               axis={axis}
               today={today}
               choosing={choosing === p.slug}
               onChoose={() => setChoosing(choosing === p.slug ? null : p.slug)}
               onPlan={span => planProject(p, span)}
               onOpen={() => navigate({ project: p.slug })}
               onFind={text => navigate({ find: text })}
            />
            {choosing === p.slug && (
               <PlanChooser
                  item={p}
                  today={today}
                  start={runStart(p)}
                  onPlan={span => planProject(p, span)}
                  onClose={() => setChoosing(null)}
               />
            )}
         </div>
      ));

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
            const now = weekMembers({ today, plans: planned, spans: laneSpans, ahead })(
               mondayOf(today)
            );
            const inFlight = [
               ...shownPlanned.map(
                  i => now.plans.has(i.id) || (!!i.project && now.projects.get(i.project) === 'on')
               ),
               ...shownLoose.map(p => now.projects.get(p.slug) === 'off'),
            ];
            let seen = 0;
            cut = inFlight.findIndex(going => going && ++seen > developers);
         }
         const line = cut >= 0 && (
            <CapacityLine
               team={team as string}
               developers={developers}
               onOpen={() => navigate({ view: 'decide', team, item: null })}
            />
         );
         const split = shownPlanned.length;
         return (
            <Lane
               key={team ?? '(none)'}
               id={`roadmap:lane:${team ?? '(none)'}`}
               band={(open, toggle) => (
                  <LaneBand
                     title={team ?? 'No developer team'}
                     counts={[
                        of(shownPlanned.length, planned.length, 'plan'),
                        everything
                           ? `${of(
                                shownLoose.length,
                                loose.length,
                                'project'
                             )} in flight with no plan`
                           : null,
                     ]
                        .filter(Boolean)
                        .join(' · ')}
                     load={laneLoad}
                     developers={developers}
                     today={today}
                     open={open}
                     onToggle={toggle}
                  />
               )}
            >
               {cut >= 0 && cut < split ? (
                  <>
                     {planRows(shownPlanned.slice(0, cut))}
                     {line}
                     {planRows(shownPlanned.slice(cut))}
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
            </Lane>
         );
      })
   ) : (
      <>
         {shownPlans.length > 0 && (
            <Lane
               id="roadmap:planned"
               band={(open, toggle) => (
                  <LaneBand
                     title="On the roadmap"
                     counts={of(shownPlans.length, ordered.length, 'plan')}
                     load={[]}
                     developers={0}
                     today={today}
                     open={open}
                     onToggle={toggle}
                  />
               )}
            >
               {planRows(shownPlans)}
            </Lane>
         )}
         {everything && shownUnplanned.length > 0 && (
            <Lane
               id="roadmap:unplanned"
               band={(open, toggle) => (
                  <LaneBand
                     title="In flight, not on the roadmap"
                     counts={`${of(
                        shownUnplanned.length,
                        unplanned.length,
                        'live project'
                     )}, the longest-running first`}
                     load={[]}
                     developers={0}
                     today={today}
                     open={open}
                     onToggle={toggle}
                  />
               )}
            >
               {inFlightRows(shownUnplanned)}
            </Lane>
         )}
         {narrowed && !shownPlans.length && !(everything && shownUnplanned.length) && (
            <div className="px-3.5 py-4 text-[13px] text-ink-3">
               Nothing on the roadmap or in flight matches
               {q ? ` “${nav.find.trim()}”` : ''}
               {picked ? ` in the week of ${weekWords(picked)}` : ''}.
            </div>
         )}
      </>
   );

   return (
      <section className="mb-7">
         <div className="sticky top-[var(--header-h,0px)] z-[5] bg-[var(--canvas)]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-2">
               <h2 className="m-0 text-base font-semibold leading-snug">Roadmap</h2>
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
                     <button
                        type="button"
                        onClick={() => navigate({ zoom: zoomOut })}
                        className="hit pressable inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-ink-2 hover:border-brand hover:text-brand"
                        title="Zoom out"
                     >
                        <Icon icon={ZoomOut} size={13} />
                        {zoomOut
                           ? zoomWords(quarterOf(zoom))
                           : scale === 'quarter'
                           ? 'All quarters'
                           : 'All months'}
                     </button>
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
                        <button
                           type="button"
                           onClick={() => navigate({ zoom: zoomKey(zoomAround(zoom.kind, now)) })}
                           title={`Zoom to this ${zoom.kind}`}
                           className="hit pressable rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-ink-2 hover:border-brand hover:text-brand"
                        >
                           Today
                        </button>
                     )}
                  </span>
               )}
               <label className="inline-flex items-center gap-2 text-xs text-ink-3">
                  Lanes
                  <Segmented
                     ariaLabel="roadmap lanes"
                     value={lanes ? 'team' : 'none'}
                     options={[
                        ['none', 'None'],
                        ['team', 'By team'],
                     ]}
                     onChange={group => navigate({ group })}
                  />
               </label>
               {timeline && (
                  <label className="inline-flex items-center gap-2 text-xs text-ink-3">
                     Show
                     <Segmented
                        ariaLabel="what the roadmap shows"
                        value={nav.show}
                        options={[
                           ['all', 'Everything'],
                           ['plan', 'Only plans'],
                           ['unplanned', 'No plan yet'],
                        ]}
                        onChange={show => navigate({ show })}
                     />
                  </label>
               )}
               <span className="flex-1" />
               {timeline && picked && (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-brand bg-surface py-1 pr-1 pl-2 text-xs text-ink">
                     Week of {weekWords(picked)}
                     <button
                        type="button"
                        aria-label="Show every week"
                        title="Show every week"
                        onClick={() => navigate({ week: null })}
                        className="hit pressable rounded border-0 bg-transparent p-0 text-ink-3 hover:text-ink"
                     >
                        <Icon icon={X} size={12} />
                     </button>
                  </span>
               )}
               <input
                  type="search"
                  aria-label="Find a project, lead or team"
                  placeholder="Find a project, lead or team"
                  value={nav.find}
                  onChange={e => navigate({ find: e.target.value })}
                  className={`w-52 px-2.5 ${textInputClass}`}
               />
               <button
                  type="button"
                  onClick={() => setAdding(a => !a)}
                  className="pressable inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-surface hover:bg-brand-700"
               >
                  <Icon icon={Plus} size={14} />
                  Add to the roadmap
               </button>
            </div>
            {problem && (
               <div
                  className="mb-2 flex items-center gap-3 rounded-lg border border-warn bg-surface px-3 py-2 text-[13px]"
                  role="alert"
               >
                  <span className="text-ink-2">{problem}</span>
                  <span className="flex-1" />
                  <button
                     type="button"
                     onClick={dismissRoadmapProblem}
                     className="hit pressable rounded border-0 bg-transparent p-0 text-xs text-ink-3 hover:text-ink"
                  >
                     Dismiss
                  </button>
               </div>
            )}
            {timeline && (
               <AxisHeader
                  columns={columns}
                  ticks={ticks}
                  axis={axis}
                  onZoom={key => navigate({ zoom: key })}
               />
            )}
         </div>
         {loadFailed && plan == null && (
            <p className="text-[13px] text-ink-3">
               Couldn’t load the roadmap. Try again in a minute.
            </p>
         )}
         {timeline ? (
            <>
               <div className="overflow-hidden rounded-b-2xl border border-t-0 border-line bg-surface">
                  <LoadChart
                     weeks={load}
                     now={thisWeek}
                     developers={developers}
                     at={place}
                     todayAt={axis.todayAt}
                     when={
                        today < horizon.start ? 'future' : today >= horizon.end ? 'past' : 'both'
                     }
                     rowGrid={rowGrid}
                     picked={picked}
                     onPick={week => navigate({ week })}
                     show={nav.show}
                     onShow={show => navigate({ show })}
                     origin={nav.origin}
                     onOrigin={origin => navigate({ origin })}
                     onPeople={() => navigate({ view: 'people', item: null })}
                  />
                  {adding && (
                     <Editor
                        item={null}
                        all={ordered}
                        projects={projectOptions}
                        teams={teams}
                        people={people}
                        onDone={() => setAdding(false)}
                     />
                  )}
                  {plan && !plan.length && !unplanned.length && !adding ? (
                     <div className="px-3.5 py-4 text-[13px] text-ink-3">
                        Nothing planned or in flight yet. Add a project to start the plan.
                     </div>
                  ) : (
                     body
                  )}
               </div>
               <p className="mt-2 text-xs text-ink-3">
                  Order is priority: drag a plan’s grip, or use the arrow keys on it. Drag a bar to
                  move it, or its right edge to change its length; with a bar focused, the arrow
                  keys do the same, Shift for length. The plus beside a project with no plan puts it
                  on the roadmap over the weeks its PRs have run.
               </p>
            </>
         ) : (
            <>
               {adding && (
                  <div className="mb-3">
                     <Rows>
                        <Editor
                           item={null}
                           all={ordered}
                           projects={projectOptions}
                           teams={teams}
                           people={people}
                           onDone={() => setAdding(false)}
                        />
                     </Rows>
                  </div>
               )}
               <NowNextLater
                  items={ordered}
                  bySlug={bySlug}
                  laneTitles={lanes ? laneTitles : null}
                  today={today}
                  onOpen={id => navigate(openPlan(nav, id))}
               />
               <p className="mt-3 text-xs text-ink-3">
                  Each column is in priority order. Done and dropped work isn’t shown. Open an item
                  to change its plan on the timeline.
               </p>
            </>
         )}
      </section>
   );
}
