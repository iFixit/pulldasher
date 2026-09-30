import {
   useEffect,
   useRef,
   useState,
   type DragEvent,
   type KeyboardEvent,
   type PointerEvent,
   type ReactNode,
} from 'react';
import { GripVertical, Plus, X } from 'lucide-react';
import { n } from '../../../../shared/format';
import { dayStart, utcDay } from '../../../../shared/model/projects';
import {
   addWeeks,
   checkRoadmapFields,
   healthStanding,
   MAX_WEEKS,
   mondayOf,
   moveBefore,
   planEnd,
   ROADMAP_STATUSES,
   type RoadmapFields,
   type RoadmapItem,
   type RoadmapStatus,
   waitsOnProblem,
} from '../../../../shared/model/roadmap';
import { Segmented, textInputClass } from '../../components/bits';
import { Icon } from '../../components/Icon';
import { eyebrowText, Rows } from '../../components/Lane';
import { useArmedConfirm } from '../../components/useArmedConfirm';
import { dayOf, dayWords, useProjectsData, type Range } from '../../model/projectData';
import { mainTeam, type PortfolioItem } from '../../model/portfolio';
import {
   createRoadmapItem,
   dismissRoadmapProblem,
   removeRoadmapItem,
   reorderRoadmap,
   updateRoadmapItem,
   useRoadmap,
} from '../../model/roadmapData';
import { NowNextLater } from './NowNextLater';
import type { Navigate, ProjectsNav } from './parts';
import {
   healthWords,
   loadWords,
   PLAN_STATUS_WORD as STATUS_WORD,
   UpdatesPanel,
   waitsWords,
} from './roadmapHealth';

const DAY = 86400;

interface Column {
   start: string;
   /** the first day after it */
   end: string;
   label: string;
}

/** The roadmap's columns: seven months from last month, or six quarters
 * from last quarter, so a little of the past sits beside the plan. */
function columnsFor(scale: 'month' | 'quarter', now: Date): Column[] {
   const y = now.getFullYear();
   const m = now.getMonth();
   if (scale === 'month') {
      return Array.from({ length: 7 }, (_, i) => {
         const a = new Date(y, m - 1 + i, 1);
         return {
            start: dayOf(a),
            end: dayOf(new Date(y, m + i, 1)),
            label: a.toLocaleDateString(undefined, {
               month: 'short',
               year: i === 0 || a.getMonth() === 0 ? 'numeric' : undefined,
            }),
         };
      });
   }
   const q = Math.floor(m / 3) * 3;
   return Array.from({ length: 6 }, (_, i) => {
      const a = new Date(y, q - 3 + i * 3, 1);
      return {
         start: dayOf(a),
         end: dayOf(new Date(y, q + i * 3, 1)),
         label: `Q${Math.floor(a.getMonth() / 3) + 1} ${a.getFullYear()}`,
      };
   });
}

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
};

const weekWords = dayWords;

/** What a linked project's PRs actually did: first PR to last merge, or to
 * today while it's open. From the horizon's own history, so a project that
 * began months ago still starts in the right place. */
function actualSpan(
   slug: string | null,
   linked: PortfolioItem | undefined,
   history: Record<string, { first_opened: string | null; last_closed: string | null }>,
   today: string
): { start: string; end: string } | null {
   if (!slug) return null;
   const past = history[slug];
   const start = past?.first_opened ?? linked?.window?.first_opened ?? null;
   if (!start) return null;
   const open = linked && (linked.status === 'live' || linked.status === 'quiet');
   const end = open ? today : past?.last_closed ?? linked?.window?.last_closed ?? start;
   return { start, end };
}

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
   const [draft, setDraft] = useState<RoadmapFields>(() =>
      item
         ? {
              name: item.name,
              project: item.project,
              team: item.team,
              lead: item.lead,
              status: item.status,
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
              start: addWeeks(mondayOf(utcDay(Date.now() / 1000)), 1),
              weeks: 4,
              notes: '',
              waits_on: [],
           }
   );
   const [error, setError] = useState<string | null>(null);
   const [saving, setSaving] = useState(false);
   const { armed, run } = useArmedConfirm();
   const set = (patch: Partial<RoadmapFields>) => setDraft(d => ({ ...d, ...patch }));
   const save = async () => {
      const checked = checkRoadmapFields(draft, { partial: !!item });
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
            {error && <span className="text-xs text-bad">{error}</span>}
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

const rowGrid = 'grid grid-cols-[minmax(0,17rem)_1fr] items-center gap-3';

/**
 * One planned item: its grip and place in the order, its name (the door to
 * its editor), and its bar. Drag the bar to move the plan, its right edge to
 * change the length; both snap to whole weeks, and with the bar focused the
 * arrow keys do the same (Shift changes the length). A linked project's real
 * PR activity runs under the bar; past the planned end while still live,
 * that line turns amber.
 */
function RoadmapRow({
   item,
   all,
   rank,
   horizon,
   today,
   todayAt,
   linked,
   actual,
   editing,
   onEdit,
   dragHandlers,
   dropHere,
}: {
   item: RoadmapItem;
   /** every item, for what this one waits on */
   all: RoadmapItem[];
   rank: number;
   horizon: Horizon;
   today: string;
   /** where today falls across the track, or null when it's off the horizon */
   todayAt: number | null;
   linked: PortfolioItem | undefined;
   actual: { start: string; end: string } | null;
   editing: boolean;
   onEdit: () => void;
   dragHandlers: {
      grip: Record<string, unknown>;
      row: Record<string, unknown>;
   };
   dropHere: boolean;
}) {
   const trackRef = useRef<HTMLSpanElement>(null);
   const [preview, setPreview] = useState<{
      start: string;
      weeks: number;
   } | null>(null);
   const plan = preview ?? { start: item.start, weeks: item.weeks };
   const end = planEnd(plan);
   const left = at(plan.start, horizon);
   const right = at(addWeeks(plan.start, plan.weeks), horizon);
   const style = BAR_STYLE[item.status];
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
      const move = (ev: globalThis.PointerEvent) => {
         const dw = Math.round((ev.clientX - x0) / pxPerWeek);
         latest =
            mode === 'move'
               ? { start: addWeeks(from.start, dw), weeks: from.weeks }
               : {
                    start: from.start,
                    weeks: Math.min(MAX_WEEKS, Math.max(1, from.weeks + dw)),
                 };
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
            ? {
                 start: item.start,
                 weeks: Math.min(MAX_WEEKS, Math.max(1, item.weeks + step)),
              }
            : { start: addWeeks(item.start, step), weeks: item.weeks }
      );
   };
   const meta: ReactNode[] = [STATUS_WORD[item.status]];
   if (health) {
      meta.push(
         <span
            key="health"
            className={health.warn ? 'text-warn' : 'text-ink-2'}
            title={health.title}
         >
            {health.text}
         </span>
      );
   }
   if (item.lead) meta.push(item.lead);
   const waits = waitsWords(item, all);
   if (waits) {
      meta.push(
         <span key="waits" className={waits.warn ? 'text-warn' : undefined} title={waits.title}>
            {waits.text}
         </span>
      );
   }
   if (!item.project) meta.push('no PRs linked');
   else if (linked) {
      meta.push(
         `${linked.open} open${linked.waiting ? `, ${linked.waiting} waiting on review` : ''}`
      );
   }
   if (over) {
      meta.push(
         <span key="over" className="text-warn">
            {n(weeksOver, 'week')} past the plan
         </span>
      );
   }
   if (due) {
      meta.push(
         weeksLate ? (
            <span
               key="target"
               className="text-warn"
               title={`The milestone ${target?.title} is due ${weekWords(due)}`}
            >
               {due < today
                  ? `missed its ${weekWords(due)} target`
                  : `ends ${n(weeksLate, 'week')} after its ${weekWords(due)} target`}
            </span>
         ) : (
            <span key="target" title={`The milestone ${target?.title}`}>
               target {weekWords(due)}
            </span>
         )
      );
   }
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
                     className="hit pressable min-w-0 truncate rounded border-0 bg-transparent p-0 text-left text-[13px] font-medium text-ink hover:text-brand"
                     title="edit this item"
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
               {/* today, drawn per row so an open editor doesn't get a line through it */}
               {todayAt != null && (
                  <span
                     aria-hidden
                     className="pointer-events-none absolute -top-[7px] -bottom-1.5 border-l border-dashed"
                     style={{ left: `${todayAt}%`, borderColor: 'var(--brand)' }}
                  />
               )}
               {right > left && (
                  <button
                     type="button"
                     aria-label={`${item.name}: planned ${weekWords(plan.start)} to ${weekWords(
                        end
                     )}, ${
                        plan.weeks
                     } weeks. Left and right arrows move it a week; with Shift they change its length.`}
                     title={`${weekWords(plan.start)} to ${weekWords(end)} · ${
                        plan.weeks
                     } weeks. Drag to move; drag the right edge to change the length.`}
                     onPointerDown={e => grab(e, 'move')}
                     onKeyDown={keys}
                     className="absolute top-1.5 h-4 cursor-grab touch-none rounded-md border p-0 focus-visible:outline-2 focus-visible:outline-brand active:cursor-grabbing"
                     style={{
                        left: `${left}%`,
                        width: `max(${right - left}%, 6px)`,
                        ...style,
                     }}
                  >
                     <span
                        aria-hidden
                        onPointerDown={e => grab(e, 'resize')}
                        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-md"
                     />
                  </button>
               )}
               {due && due >= horizon.start && due < horizon.end && (
                  <span
                     aria-hidden
                     className="pointer-events-none absolute top-0.5 h-6 border-l-2"
                     style={{
                        left: `${at(due, horizon)}%`,
                        borderColor: weeksLate ? 'var(--warn)' : 'var(--ink-2)',
                     }}
                  />
               )}
               {preview && (
                  <span
                     className="pointer-events-none absolute -top-3 z-[1] rounded bg-surface px-1 text-[10px] whitespace-nowrap text-ink-2 shadow-sm tabular-nums"
                     style={{ left: `${left}%` }}
                  >
                     {weekWords(plan.start)} to {weekWords(end)} · {plan.weeks} weeks
                  </span>
               )}
               {actual && (
                  <>
                     <span
                        aria-hidden
                        className="absolute top-[26px] h-[3px] rounded-full"
                        style={{
                           left: `${at(actual.start, horizon)}%`,
                           width: `max(${
                              at(actual.end, horizon) - at(actual.start, horizon)
                           }%, 3px)`,
                           background: 'var(--ink-2)',
                           opacity: 0.55,
                        }}
                        title={`PRs from ${weekWords(actual.start)} to ${weekWords(actual.end)}`}
                     />
                     {over && (
                        <span
                           aria-hidden
                           className="absolute top-[26px] h-[3px] rounded-full"
                           style={{
                              left: `${at(end, horizon)}%`,
                              width: `max(${at(actual.end, horizon) - at(end, horizon)}%, 3px)`,
                              background: 'var(--warn)',
                           }}
                        />
                     )}
                  </>
               )}
            </span>
         </div>
      </div>
   );
}

/** A team lane's title, its plan count, and how many it runs at once. */
function LaneHeader({
   team,
   list,
   developers,
   today,
   until,
}: {
   team: string | null;
   list: RoadmapItem[];
   developers: number;
   today: string;
   until: string;
}) {
   const load = team ? loadWords(list, developers, today, until) : null;
   return (
      <div className="flex flex-wrap items-baseline gap-x-2 border-t border-secondary bg-muted/40 px-3.5 py-[6px] first:border-t-0">
         <span className={`text-ink-3 ${eyebrowText}`}>
            {team ?? 'No team'} <span className="tabular-nums">· {list.length}</span>
         </span>
         {load && (
            <span
               className={`text-[11px] ${load.warn ? 'text-warn' : 'text-ink-3'}`}
               title={load.title}
            >
               {load.text}
            </span>
         )}
      </div>
   );
}

/** A live project nobody has put on the roadmap: its real span, and one
 * click to add it with that span as the plan. */
function UnplannedRow({
   item,
   horizon,
   actual,
   onAdd,
}: {
   item: PortfolioItem;
   horizon: Horizon;
   actual: { start: string; end: string } | null;
   onAdd: () => void;
}) {
   return (
      <div
         className={`${rowGrid} border-t border-secondary px-3.5 py-1.5 first:border-t-0 hover:bg-muted`}
      >
         <span className="flex min-w-0 items-center gap-2">
            <button
               type="button"
               onClick={onAdd}
               className="hit pressable inline-flex flex-none items-center gap-1 rounded-md border-0 bg-transparent px-1 py-0.5 text-xs font-medium text-brand hover:bg-brand-50"
               title={`Put ${item.name} on the roadmap, planned over the time its PRs have taken so far`}
            >
               <Icon icon={Plus} size={12} />
               Add
            </button>
            <span className="flex min-w-0 flex-col">
               <span className="truncate text-[13px] text-ink">{item.name}</span>
               <span className="text-[11px] text-ink-3">
                  {item.open} open
                  {item.lead ? ` · ${item.lead}` : ''}
               </span>
            </span>
         </span>
         <span className="relative block h-6">
            {actual && (
               <span
                  aria-hidden
                  className="absolute top-2.5 h-[3px] rounded-full"
                  style={{
                     left: `${at(actual.start, horizon)}%`,
                     width: `max(${at(actual.end, horizon) - at(actual.start, horizon)}%, 3px)`,
                     background: 'var(--ink-2)',
                     opacity: 0.55,
                  }}
               />
            )}
         </span>
      </div>
   );
}

/**
 * The roadmap: the plan a project manager lays out, month by month or
 * quarter by quarter. Order is priority: drag rows to change it. Each item's
 * bar is when the work is planned; drag it to move, drag its end to resize.
 * An item linked to a project label draws what its PRs actually did under
 * the plan, so plan and reality sit on one line. Live projects nobody has
 * planned wait underneath with an Add button. The roadmap is Pulldasher's
 * own record (the one thing in this tab not read off GitHub), saved as you
 * go.
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
   const columns = columnsFor(nav.scale === 'month' ? 'month' : 'quarter', now);
   const horizon: Horizon = {
      start: columns[0].start,
      end: columns[columns.length - 1].end,
      from: dayStart(columns[0].start) as number,
      to: dayStart(columns[columns.length - 1].end) as number,
   };
   // the horizon's own history, so a linked project's real span starts where
   // its first PR did, not where the date range picker begins
   const pastRange: Range = {
      start: horizon.start,
      end: today < horizon.end ? today : horizon.end,
   };
   const history = useProjectsData(pastRange)?.window.projects ?? {};
   const bySlug = new Map(items.map(i => [i.slug, i]));
   const lanes = nav.group === 'team';
   const ordered = plan ?? [];
   const ids = ordered.map(i => i.id);
   const linkedSlugs = new Set(ordered.map(i => i.project).filter(Boolean));
   const unplanned = items.filter(i => i.status === 'live' && !linkedSlugs.has(i.slug));
   const projectOptions = [...items]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(i => ({ slug: i.slug, name: i.name }));
   const people = [
      ...new Set([
         ...items.flatMap(i => [...i.developers, ...i.nonDevelopers, i.lead ?? '']),
         ...teams,
      ]),
   ].filter(Boolean);
   // how much is planned or under way in each column
   const load = columns.map(
      c =>
         ordered.filter(
            i =>
               (i.status === 'planned' || i.status === 'active') &&
               i.start < c.end &&
               planEnd(i) >= c.start
         ).length
   );
   const todayAt = today >= horizon.start && today < horizon.end ? at(today, horizon) : null;

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

   const add = (p: PortfolioItem) => {
      const actual = actualSpan(p.slug, p, history, today);
      const start = mondayOf(actual?.start ?? today);
      const weeksSoFar = Math.ceil(
         ((dayStart(today) as number) - (dayStart(start) as number)) / (7 * DAY)
      );
      void createRoadmapItem({
         name: p.name,
         project: p.slug,
         team: mainTeam(p, teamOf),
         lead: p.lead,
         status: 'active',
         start,
         // what it has taken so far, and two more weeks to finish
         weeks: Math.min(MAX_WEEKS, Math.max(1, weeksSoFar + 2)),
      });
   };

   // arriving from a link to one item: bring it into view once the plan loads
   const arrived = useRef(false);
   useEffect(() => {
      if (arrived.current || !plan) return;
      arrived.current = true;
      if (nav.item != null) {
         document.getElementById(`roadmap-item-${nav.item}`)?.scrollIntoView({ block: 'center' });
      }
   }, [plan, nav.item]);

   const renderRows = (list: RoadmapItem[]) =>
      list.map(item => {
         const index = ids.indexOf(item.id);
         const linked = item.project ? bySlug.get(item.project) : undefined;
         return (
            <div key={item.id} id={`roadmap-item-${item.id}`}>
               <RoadmapRow
                  item={item}
                  all={ordered}
                  rank={index + 1}
                  horizon={horizon}
                  today={today}
                  todayAt={todayAt}
                  linked={linked}
                  actual={actualSpan(item.project, linked, history, today)}
                  editing={editing === item.id}
                  onEdit={() => openItem(editing === item.id ? null : item.id)}
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

   const laneTitles = lanes
      ? [...new Set([...teams, ...ordered.map(i => i.team).filter((t): t is string => !!t)])]
      : [];
   const header = (
      <div className="border-b border-line bg-muted/40 py-[7px]">
         <div className={`${rowGrid} px-3.5`}>
            <span className={`text-ink-3 ${eyebrowText}`}>Priority</span>
            <span className="relative block h-9">
               {columns.map(c => (
                  <span
                     key={c.start}
                     className="absolute top-0 flex h-full flex-col border-l border-secondary pl-1.5"
                     style={{ left: `${at(c.start, horizon)}%` }}
                  >
                     <span className={`text-ink-3 ${eyebrowText}`}>{c.label}</span>
                     <span
                        className="text-[11px] text-ink-3 tabular-nums"
                        title="planned or in progress in this stretch"
                     >
                        {load[columns.indexOf(c)] || ''}
                        {load[columns.indexOf(c)] ? ' planned' : ''}
                     </span>
                  </span>
               ))}
            </span>
         </div>
      </div>
   );

   return (
      <section className="mb-7">
         <div className="sticky top-[var(--header-h,0px)] z-[5] flex flex-wrap items-center gap-x-3 gap-y-2 bg-[var(--canvas)] pb-2">
            <h2 className="m-0 text-base font-semibold leading-snug">Roadmap</h2>
            <Segmented
               ariaLabel="roadmap columns"
               value={nav.scale}
               options={[
                  ['month', 'Months'],
                  ['quarter', 'Quarters'],
                  ['now', 'Now, next, later'],
               ]}
               onChange={scale => navigate({ scale })}
            />
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
            <span className="flex-1" />
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
         {loadFailed && plan == null && (
            <p className="text-[13px] text-ink-3">
               Couldn’t load the roadmap. Try again in a minute.
            </p>
         )}
         {nav.scale === 'now' ? (
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
                  onOpen={id => navigate({ scale: 'quarter', item: id })}
               />
               <p className="mt-3 text-xs text-ink-3">
                  Each column is in priority order. Done and dropped work isn’t shown. Open an item
                  to change its plan on the timeline.
               </p>
            </>
         ) : (
            <>
               <Rows>
                  {header}
                  <div className="relative">
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
                     {plan && !plan.length && !adding && (
                        <div className="px-3.5 py-4 text-[13px] text-ink-3">
                           Nothing planned yet. Add a project, or add a live one from the list
                           below.
                        </div>
                     )}
                     {lanes
                        ? [...laneTitles, null].map(team => {
                             const list = ordered.filter(i => (i.team ?? null) === team);
                             if (!list.length) return null;
                             return (
                                <div key={team ?? '(none)'}>
                                   <LaneHeader
                                      team={team}
                                      list={list}
                                      developers={team ? teamMembers[team]?.length ?? 0 : 0}
                                      today={today}
                                      until={horizon.end}
                                   />
                                   {renderRows(list)}
                                </div>
                             );
                          })
                        : renderRows(ordered)}
                  </div>
               </Rows>
               <p className="mt-2 text-xs text-ink-3">
                  Order is priority: drag a row’s grip (or use the arrow keys on it). Drag a bar to
                  move the plan and its right edge to change the length; with a bar focused, the
                  arrow keys do the same, Shift for length. The line under a bar is when the linked
                  project’s PRs actually ran: amber once a live project runs past its plan. A short
                  upright line is the linked project’s milestone. The dashed line is today.
               </p>
            </>
         )}
         {unplanned.length > 0 && (
            <section className="mt-6">
               <h3 className="m-0 mb-2 text-sm font-semibold">
                  Live projects not on the roadmap{' '}
                  <span className="font-normal text-ink-3 tabular-nums">· {unplanned.length}</span>
               </h3>
               <Rows>
                  {unplanned.map(p => (
                     <UnplannedRow
                        key={p.slug}
                        item={p}
                        horizon={horizon}
                        // the line only means something under the timeline's columns
                        actual={nav.scale === 'now' ? null : actualSpan(p.slug, p, history, today)}
                        onAdd={() => add(p)}
                     />
                  ))}
               </Rows>
            </section>
         )}
      </section>
   );
}
