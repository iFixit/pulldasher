import {
   useEffect,
   useId,
   useLayoutEffect,
   useRef,
   useState,
   type DragEvent,
   type KeyboardEvent,
   type MutableRefObject,
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
   blockersOf,
   bucketOf,
   checkRoadmapFields,
   DONE_WHEN_MAX,
   END_KINDS,
   endOf,
   HEALTH_WORD,
   healthStanding,
   isStopped,
   isUnderWay,
   MAX_WEEKS,
   mondayOf,
   moveBefore,
   NEXT_WEEKS,
   ORIGIN_WORD,
   planEnd,
   ROADMAP_STATUSES,
   type EndKind,
   type RoadmapFields,
   type RoadmapItem,
   type RoadmapStatus,
   waitsOnProblem,
   weeksThrough,
} from '../../../../shared/model/roadmap';
import {
   FactLink,
   LoadFailed,
   PrimaryButton,
   QuietButton,
   Segmented,
   textInputClass,
} from '../../components/bits';
import { Icon } from '../../components/Icon';
import { eyebrowText, Fold, GroupHeader, Rows, SubDoor, useFoldState } from '../../components/Lane';
import { useRowKeys } from '../../components/useRowKeys';
import { dateOf, dayOf, dayWords, useProjectsData, type Range } from '../../model/projectData';
import { findFilter, planCell, type PortfolioItem } from '../../model/portfolio';
import { teamLoad } from '../../model/teamLoad';
import {
   byPriority,
   createRoadmapItem,
   dismissRoadmapProblem,
   loadRoadmap,
   readRoadmap,
   removeRoadmapItem,
   reorderRoadmap,
   restoreRoadmapItem,
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
   RANK,
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
import {
   andList,
   BEING_WORKED_ON,
   COMMIT_THROUGH,
   NEEDS_A_PLAN,
   NO_PLAN_NEEDED,
   PLAN_IT,
   DONE_WHEN,
   END_IN_A_SENTENCE,
   END_MEANS,
   END_WORD,
   NO_UPDATE_YET,
   UPDATE_DUE,
} from '../../model/words';
import { askOf, DecideCall, reasonWords, useCallsMadeHere } from './Decide';
import { LoadChart } from './LoadChart';
import { NowNextLater } from './NowNextLater';
import {
   NarrowChip,
   openPlan,
   ORIGIN_OPTIONS,
   switchView,
   type Navigate,
   type ProjectsNav,
} from './parts';
import {
   capacityWords,
   clearedBy,
   Dotted,
   inInk,
   isAmber,
   latestOf,
   moveWords,
   PLAN_STATUS_WORD as STATUS_WORD,
   planWarnings,
   planWords,
   restWords,
   SaidWords,
   stepWithin,
   TEAM_LOAD_RULE,
   UpdatesPanel,
   vouchRule,
   vouchWords,
   when,
   type PlanCall,
   type Said,
   type Tracked,
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

/** What a plan's warnings need of the project it tracks. */
const trackedBy = (linked: PortfolioItem | undefined): Tracked | null =>
   linked ? { live: linked.status === 'live', target: linked.target } : null;

/** How each plan's bar reads: an outline before work starts, a fill once it
 * has, green when it's done, faint when it was dropped. How firm its end is
 * is the bar's right end: a hard end has an ink cap (HARD_CAP), a soft end
 * (an estimate) is a plain rounded end, and ongoing work runs on to the edge
 * of the weeks shown, square there like any bar the view cuts off, in the
 * planned tint since it asks for nothing. A fade only ever means still going
 * past today. Dashes stay the mark of a project with no plan. */
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

/** A promised end, drawn as one: a 2px ink cap on the bar's right edge. */
const HARD_CAP = { borderRightWidth: 2, borderRightColor: 'var(--ink)' };

const weekWords = dayWords;

const inputClass = `px-2.5 ${textInputClass}`;
const selectClass = `px-2 ${textInputClass}`;
/** a row's scroll margin, so j and k (data-roadmap-row) bring it into view
 * below the sticky headers, whose height the roadmap measures */
const rowMargin = 'scroll-mt-[calc(var(--header-h,0px)_+_var(--roadmap-stuck,0px)_+_0.5rem)]';

/** What a plan's span is: its first week and length. */
type Span = { start: string; weeks: number };

/** no Decide rows yet, the same array each render */
const NO_ROWS: DecideRow[] = [];

/** what opens under a plan's row: from sm up, in line with the row's name
 * above, past its grip and rank (63px in), so it reads as that row's */
const UNDER_ROW = 'border-t border-secondary bg-muted/40 px-3.5 py-3 sm:pl-[3.9375rem]';

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

/** What each field is, in a receipt that names what a save changed. */
const FIELD_WORD: Record<keyof RoadmapFields, string> = {
   name: 'its name',
   project: 'its project',
   team: 'its team',
   lead: 'its lead',
   status: 'its status',
   origin: 'where it came from',
   start: 'its dates',
   weeks: 'its dates',
   end_kind: 'its end',
   done_when: 'when it’s done',
   notes: 'its notes',
   waits_on: 'what it waits on',
};

/**
 * A save in the editor, in words for its receipt: new dates the way a drag
 * says them, a new status as the call it is, and anything else by what it
 * changed ("Saved MySQL 8: changed its lead and its notes").
 */
export function savedWords(was: RoadmapItem, changed: Partial<RoadmapFields>): string {
   const now = { ...was, ...changed };
   const keys = Object.keys(changed) as (keyof RoadmapFields)[];
   const moved = keys.every(k => k === 'start' || k === 'weeks') && moveWords(now.name, was, now);
   if (moved) return moved;
   if (keys.length === 1 && changed.status) {
      return `Marked ${now.name} ${STATUS_WORD[changed.status].toLowerCase()}`;
   }
   if (keys.length === 1 && changed.end_kind) {
      return changed.end_kind === 'ongoing'
         ? `${now.name} is now ongoing`
         : `${now.name} now has ${END_IN_A_SENTENCE[changed.end_kind]}`;
   }
   return `Saved ${now.name}: changed ${andList([...new Set(keys.map(k => FIELD_WORD[k]))])}`;
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

/** A project a plan can track, with its target's day while it has one. */
type ProjectOption = { slug: string; name: string; target: string | null };

/**
 * A plan's fields, open in the roadmap's own flow (work in progress lives
 * inline, never in a popover a stray click can close): behind Edit details
 * in its plan's details, and as the form that adds a new plan, which asks
 * only its name and dates until More shows the rest. One column, each field
 * beside its name, the dates said as a sentence. Saves through the shared
 * checks, so a mistake reads the same here as the server would say it,
 * beside the field it's about; a save leaves a receipt with Undo under the
 * row (the roadmap's onSaved), so nothing asks twice.
 */
function Editor({
   item,
   all,
   projects,
   teams,
   people,
   today,
   focus = 'name',
   dirty,
   onDone,
   onSaved,
   onAdded,
}: {
   /** null to add a new item */
   item: RoadmapItem | null;
   /** every item on the roadmap, to choose what this one waits on */
   all: RoadmapItem[];
   projects: ProjectOption[];
   teams: string[];
   people: string[];
   today: string;
   /** the field that takes the focus as it opens */
   focus?: 'name' | 'notes' | 'project' | 'done_when';
   /** kept true while it holds changes not saved, so the roadmap won't close it */
   dirty?: MutableRefObject<boolean>;
   /** closed: saved or cancelled */
   onDone: () => void;
   /** an item's changes, saved: the item as it was, and what changed */
   onSaved?: (was: RoadmapItem, changed: Partial<RoadmapFields>) => void;
   /** a new item, saved */
   onAdded?: (added: RoadmapItem) => void;
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
              end_kind: item.end_kind,
              done_when: item.done_when,
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
              // an estimate until someone commits to it
              end_kind: 'soft',
              done_when: '',
              notes: '',
              waits_on: [],
           }
   );
   const [draft, setDraft] = useState<RoadmapFields>(initial);
   const [error, setError] = useState<ReturnType<typeof problemAt> | null>(null);
   const [saving, setSaving] = useState(false);
   // a new plan asks its name and dates; More shows the other fields
   const [more, setMore] = useState(!!item);
   const id = useId();
   const nameRef = useRef<HTMLInputElement>(null);
   const leadRef = useRef<HTMLInputElement>(null);
   const statusRef = useRef<HTMLSpanElement>(null);
   const notesRef = useRef<HTMLTextAreaElement>(null);
   const projectRef = useRef<HTMLSelectElement>(null);
   const doneRef = useRef<HTMLInputElement>(null);
   useEffect(() => {
      // the roadmap scrolls the open editor into view, clear of its headers
      const at =
         focus === 'notes'
            ? notesRef
            : focus === 'project'
            ? projectRef
            : focus === 'done_when'
            ? doneRef
            : nameRef;
      at.current?.focus({ preventScroll: true });
   }, []);
   const set = (patch: Partial<RoadmapFields>) => setDraft(d => ({ ...d, ...patch }));
   // what's changed since the form opened; a new plan sends everything
   const changes = () =>
      Object.fromEntries(
         Object.entries(draft).filter(
            ([key, value]) =>
               JSON.stringify(value) !== JSON.stringify(initial[key as keyof RoadmapFields])
         )
      ) as Partial<RoadmapFields>;
   useEffect(() => {
      if (!dirty) return;
      dirty.current = Object.keys(changes()).length > 0;
      return () => {
         dirty.current = false;
      };
   });
   const save = async () => {
      const changed = item ? changes() : draft;
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
      else if (item) onSaved?.(item, checked.fields);
      onDone();
   };
   /** A field's name, beside it from sm up and above it on a phone. A group
    * of buttons gets plain words: a label would hand its name, and a click
    * on its words, to the first of them. */
   const label = (text: string, field?: string) => {
      const className = 'pt-1 text-xs text-ink-3 sm:pt-0';
      return field ? (
         <label htmlFor={`${id}-${field}`} className={className}>
            {text}
         </label>
      ) : (
         <span className={className}>{text}</span>
      );
   };
   const fieldError = (at: 'name' | 'lead') =>
      error?.field === at && (
         <span id={`roadmap-error-${at}`} className="text-xs text-ink-2">
            {error.text}
         </span>
      );
   const projectOptions =
      draft.project && !projects.some(p => p.slug === draft.project)
         ? [...projects, { slug: draft.project, name: draft.project, target: null }]
         : projects;
   // a new plan's end, from the ends Decide commits to: its project's target
   // first while that's ahead, else the nearest, the one outlined answer
   const target = projects.find(p => p.slug === draft.project)?.target ?? null;
   const ends = item ? [] : commitEnds(today, target).filter(c => c.end >= draft.start);
   const runs = Number.isInteger(draft.weeks) && draft.weeks >= 1 && draft.weeks <= MAX_WEEKS;
   return (
      <form
         id={item ? `roadmap-edit-${item.id}` : undefined}
         className={item ? UNDER_ROW : 'border-t border-secondary bg-muted/40 px-3.5 py-3'}
         onSubmit={e => {
            e.preventDefault();
            void save();
         }}
         onKeyDown={e => {
            if (e.key !== 'Escape') return;
            // a stray Escape mustn't throw away what's typed: it closes the
            // form only while nothing has changed
            e.stopPropagation();
            if (!Object.keys(changes()).length) onDone();
            else setError({ text: 'Save your changes, or Cancel to drop them.', field: null });
         }}
      >
         <div className="grid max-w-3xl grid-cols-1 gap-x-3 gap-y-1 text-[13px] text-ink-2 sm:grid-cols-[minmax(7rem,max-content)_minmax(0,1fr)] sm:items-baseline sm:gap-y-2.5">
            {label('Name', 'name')}
            <div className="flex flex-col gap-1">
               <input
                  id={`${id}-name`}
                  ref={nameRef}
                  className={`w-full max-w-md ${inputClass}`}
                  value={draft.name}
                  maxLength={120}
                  onChange={e => set({ name: e.target.value })}
                  placeholder="What the work is called"
                  aria-invalid={error?.field === 'name' || undefined}
                  aria-describedby={error?.field === 'name' ? 'roadmap-error-name' : undefined}
               />
               {fieldError('name')}
            </div>
            {/* the dates as the sentence they make, so nobody counts weeks */}
            {label('Runs')}
            <div className="flex flex-col gap-1.5">
               <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  from the week of
                  <select
                     aria-label="Starts the week of"
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
                  {/* ongoing work has no length; its weeks wait, kept, for
                      when it gets an end again */}
                  {draft.end_kind === 'ongoing' ? (
                     <span className="text-ink-3">with no end</span>
                  ) : (
                     <>
                        for
                        <input
                           type="number"
                           min={1}
                           max={MAX_WEEKS}
                           aria-label="Length in weeks"
                           className={`w-16 ${inputClass}`}
                           value={draft.weeks}
                           onChange={e => set({ weeks: Number(e.target.value) })}
                        />
                        {/* the end kept with its word: the gap would part them */}
                        <span>
                           {draft.weeks === 1 ? 'week' : 'weeks'}
                           {!runs && (
                              <span className="text-ink-3" aria-live="polite">
                                 {`: a plan runs 1 to ${MAX_WEEKS} weeks`}
                              </span>
                           )}
                        </span>
                        {/* or the day it finishes, for anyone who knows the
                            date and not the weeks: it lands on that week's
                            Sunday, since plans move in whole weeks */}
                        {runs && (
                           <>
                              finishing
                              <input
                                 type="date"
                                 aria-label="Finishes on"
                                 className={inputClass}
                                 value={planEnd(draft)}
                                 min={draft.start}
                                 onChange={e => {
                                    if (e.target.value)
                                       set({ weeks: weeksThrough(draft.start, e.target.value) });
                                 }}
                              />
                           </>
                        )}
                     </>
                  )}
               </span>
               {ends.length > 0 && (
                  <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-3">
                     {COMMIT_THROUGH}
                     <Dotted>
                        {ends.map(c => {
                           const weeks = weeksThrough(draft.start, c.end);
                           const props = {
                              // the word is a commitment: it makes the end hard
                              onClick: () => set({ weeks, end_kind: 'hard' }),
                              'aria-label': `${COMMIT_THROUGH} ${c.through}`,
                              title: planWords({ start: draft.start, weeks }),
                           };
                           // in the run of words, "Promise to finish by its target date, Oct 21"
                           const words = c.target ? c.through : c.label;
                           return (
                              <QuietButton key={c.end} {...props}>
                                 {words}
                              </QuietButton>
                           );
                        })}
                     </Dotted>
                  </span>
               )}
            </div>
            {/* how firm the end is, said beside the choice */}
            {label('Ends')}
            <div className="flex flex-col gap-1">
               <span>
                  <Segmented
                     ariaLabel="how firm its end is"
                     value={draft.end_kind}
                     options={END_KINDS.map(k => [k, END_WORD[k]])}
                     onChange={end_kind => set({ end_kind })}
                  />
               </span>
               <span className="text-xs text-ink-3" aria-live="polite">
                  {END_MEANS[draft.end_kind]}
               </span>
            </div>
            {/* upkeep is never done, so it has no line for it */}
            {draft.end_kind !== 'ongoing' && (
               <>
                  {label(DONE_WHEN, 'done_when')}
                  <input
                     id={`${id}-done_when`}
                     ref={doneRef}
                     className={`w-full max-w-xl ${inputClass}`}
                     value={draft.done_when}
                     maxLength={DONE_WHEN_MAX}
                     onChange={e => set({ done_when: e.target.value })}
                     placeholder="What finished looks like, in a line"
                  />
               </>
            )}
            {more && (
               <>
                  {label('Status')}
                  <span ref={statusRef}>
                     <Segmented
                        ariaLabel="status"
                        value={draft.status}
                        options={ROADMAP_STATUSES.map(s => [s, STATUS_WORD[s]])}
                        onChange={status => set({ status })}
                     />
                  </span>
                  {/* who it's with as the sentence its details say: "Store, led by" */}
                  {label('Team', 'team')}
                  <div className="flex flex-col gap-1">
                     <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <select
                           id={`${id}-team`}
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
                        led by
                        <input
                           ref={leadRef}
                           aria-label="Lead"
                           className={`w-44 ${inputClass}`}
                           list="roadmap-people"
                           value={draft.lead ?? ''}
                           onChange={e => set({ lead: e.target.value.trim() || null })}
                           placeholder="GitHub login"
                           aria-invalid={error?.field === 'lead' || undefined}
                           aria-describedby={
                              error?.field === 'lead' ? 'roadmap-error-lead' : undefined
                           }
                        />
                        <datalist id="roadmap-people">
                           {people.map(login => (
                              <option key={login} value={login} />
                           ))}
                        </datalist>
                     </span>
                     {fieldError('lead')}
                  </div>
                  {label('Project', 'project')}
                  <span>
                     <select
                        id={`${id}-project`}
                        ref={projectRef}
                        className={`max-w-full ${selectClass}`}
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
                  </span>
                  {label('Waits on')}
                  <WaitsOnField
                     id={item?.id ?? null}
                     value={draft.waits_on}
                     all={all}
                     onChange={waits_on => set({ waits_on })}
                  />
                  {label('Came from')}
                  <span>
                     <Segmented
                        ariaLabel="where it came from"
                        value={draft.origin ?? 'unsaid'}
                        options={ORIGIN_OPTIONS}
                        onChange={o => set({ origin: o === 'unsaid' ? null : o })}
                     />
                  </span>
                  {label('Notes', 'notes')}
                  <textarea
                     id={`${id}-notes`}
                     ref={notesRef}
                     className="min-h-16 w-full max-w-xl rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink"
                     value={draft.notes}
                     maxLength={2000}
                     onChange={e => set({ notes: e.target.value })}
                     placeholder="Why it matters"
                  />
               </>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs sm:col-start-2 sm:mt-0">
               <PrimaryButton disabled={saving}>
                  {item ? 'Save' : 'Add to the roadmap'}
               </PrimaryButton>
               <QuietButton onClick={() => onDone()}>Cancel</QuietButton>
               {!more && (
                  <QuietButton
                     aria-expanded={false}
                     aria-label="More fields: its status, team and lead, project, what it waits on, where it came from and notes"
                     onClick={() => {
                        setMore(true);
                        // on to the first field it showed
                        requestAnimationFrame(() =>
                           statusRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus()
                        );
                     }}
                  >
                     More fields
                  </QuietButton>
               )}
               <span role="status" className="text-ink-2">
                  {error && !error.field ? error.text : ''}
               </span>
            </div>
         </div>
      </form>
   );
}

/** a line of a plan's details that runs under its words, not its label:
 * the whole width on a phone */
const WIDE = 'col-span-2 m-0 sm:col-span-1 sm:col-start-2';

/** Who a plan is with, in words: "Store, led by" before its lead's door,
 * or what it lacks. */
export function teamWords(team: string | null, lead: string | null): string {
   if (!team && !lead) return 'No team or lead yet';
   return `${team ?? 'No team'}, ${lead ? 'led by ' : 'no lead yet'}`;
}

/**
 * A plan's details, open under its row and read first, the way its project's
 * page says its plan: the plan in a line with Decide's calls under it (the
 * one asked, outlined; the coming ends; park, done and drop), each saved at
 * once with Undo where it was made; its latest update and the way to post
 * one; its team and lead; and only the facts it has (its project when that
 * isn't its name, what it waits on, where it came from, its notes). The
 * fields themselves wait behind Edit details. Nothing here is amber: the row
 * above carries the plan's one mark. Escape or Close puts it away, and a
 * stray click doesn't.
 */
function PlanPanel({
   item,
   all,
   linked,
   today,
   row,
   focusCalls,
   updates,
   dirty,
   onUpdates,
   onEdit,
   onRemove,
   onClose,
   onPerson,
   onOpenItem,
   onOpenProject,
}: {
   item: RoadmapItem;
   all: RoadmapItem[];
   /** the project it tracks, on the project list */
   linked: PortfolioItem | undefined;
   today: string;
   /** Decide's row for it, asked or answered here, for its calls */
   row: DecideRow;
   /** opened from a door (its bar, its words, a link): the focus goes to its
    * calls; back from its fields, the roadmap puts it on Edit details */
   focusCalls: boolean;
   /** its update form is open */
   updates: boolean;
   /** kept true while the update form holds words not posted */
   dirty: MutableRefObject<boolean>;
   onUpdates: (open: boolean) => void;
   /** its fields, with the focus on one */
   onEdit: (focus?: 'notes' | 'project' | 'done_when') => void;
   onRemove: () => Promise<unknown>;
   onClose: () => void;
   onPerson: (login: string) => void;
   onOpenItem: (id: number) => void;
   onOpenProject: (slug: string) => void;
}) {
   const ref = useRef<HTMLDivElement>(null);
   const [removing, setRemoving] = useState(false);
   const focused = useRef(false);
   const asked = row.reasons.length > 0;
   useEffect(() => {
      // opened from a door to change the plan: on to its calls (its updates
      // take their own focus), and on to Decide's answer if its question
      // arrives after, while the focus is still on the calls
      const panel = ref.current;
      if (!panel || updates) return;
      const onCalls = !!panel.querySelector('[role="toolbar"]')?.contains(document.activeElement);
      if (!(focusCalls && !focused.current) && !onCalls) return;
      focused.current = true;
      panel.querySelector<HTMLElement>('[data-decide-focus]')?.focus({ preventScroll: true });
   }, [asked]);
   // the facts behind the row's words, in ink
   const w = planWarnings(item, all, today, trackedBy(linked));
   const facts = [w.status, w.over, w.target].flatMap(s => (s ? [` · ${s.text}`] : []));
   const standing = healthStanding(item);
   const u = latestOf(standing);
   const vouch =
      standing.kind === 'quiet' || standing.kind === 'current' ? standing.vouch : undefined;
   const blockers = blockersOf(item, all);
   const lead = item.lead;
   const project = item.project;
   const projectName = linked?.name ?? project;
   const term = 'text-xs leading-5 text-ink-3';
   const post = (
      <QuietButton
         id={`roadmap-post-${item.id}`}
         aria-expanded={updates}
         onClick={() => onUpdates(!updates)}
      >
         {updates ? 'Close' : 'Post an update'}
      </QuietButton>
   );
   return (
      <div
         ref={ref}
         role="group"
         aria-label={`${item.name}: its plan`}
         className={UNDER_ROW}
         onKeyDown={e => {
            // the update form takes its own Escape
            if (e.key !== 'Escape' || updates) return;
            e.preventDefault();
            onClose();
         }}
      >
         <dl className="m-0 grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2.5 text-[13px] leading-5 sm:grid-cols-[minmax(7rem,max-content)_minmax(0,1fr)]">
            <dt className={term}>Plan</dt>
            <dd className="m-0 max-w-[70ch] text-ink-2">
               {STATUS_WORD[item.status]}, {planWords(item)}
               {facts}
            </dd>
            {/* under the plan's words; the whole width on a phone */}
            <dd className={`-mt-2 ${WIDE}`}>
               <DecideCall
                  row={row}
                  project={linked}
                  opened
                  // the row's words above ask the question its answer answers
                  describedBy={asked ? `roadmap-words-${item.id}` : undefined}
               />
            </dd>
            {/* what finished looks like, so "Done?" has something to check;
                upkeep is never done, so it isn't asked for there */}
            {(item.done_when || item.end_kind !== 'ongoing') && (
               <>
                  <dt className={term}>{DONE_WHEN}</dt>
                  <dd className="m-0 max-w-[70ch] text-ink-2">
                     {item.done_when || (
                        <QuietButton onClick={() => onEdit('done_when')}>
                           Say when it’s done
                        </QuietButton>
                     )}
                  </dd>
               </>
            )}
            {(u || isUnderWay(item.status)) && (
               <>
                  <dt className={term}>Update</dt>
                  <dd className="m-0 text-ink-2">
                     {u ? (
                        <>
                           <span className="font-medium text-ink">{HEALTH_WORD[u.health]}</span>
                           {` · ${when(u.at)} · ${u.author}`}
                           {standing.kind === 'stale' && ` · ${UPDATE_DUE}`} {post}
                           {u.body && (
                              <p className="m-0 mt-0.5 max-w-[70ch] whitespace-pre-line">
                                 {u.body}
                              </p>
                           )}
                           {vouch && (
                              <p className="m-0 mt-0.5 text-ink-3" title={vouchRule(vouch)}>
                                 {vouchWords(vouch)}
                              </p>
                           )}
                        </>
                     ) : (
                        <>
                           {vouch ? (
                              <span title={vouchRule(vouch)}>{vouchWords(vouch)}</span>
                           ) : standing.kind === 'missing' ? (
                              NO_UPDATE_YET
                           ) : (
                              'None yet'
                           )}{' '}
                           {post}
                        </>
                     )}
                  </dd>
                  {updates && (
                     <dd className="col-span-2 m-0 overflow-hidden rounded-xl border border-line bg-surface">
                        <UpdatesPanel
                           item={item}
                           bare
                           autoFocus
                           dirty={dirty}
                           onClose={() => onUpdates(false)}
                        />
                     </dd>
                  )}
               </>
            )}
            <dt className={term}>Team</dt>
            <dd className="m-0 text-ink-2">
               {teamWords(item.team, lead)}
               {lead && (
                  <FactLink onClick={() => onPerson(lead)} title={`Open ${lead}’s row on People`}>
                     {lead}
                  </FactLink>
               )}
            </dd>
            {/* its project, when that isn't already its name above */}
            {(!project || projectName !== item.name) && (
               <>
                  <dt className={term}>Project</dt>
                  <dd className="m-0 text-ink-2">
                     {project ? (
                        <FactLink
                           onClick={() => onOpenProject(project)}
                           title="Open the project’s page"
                        >
                           {projectName}
                        </FactLink>
                     ) : (
                        <>
                           None yet{' '}
                           <QuietButton onClick={() => onEdit('project')}>Pick one</QuietButton>
                        </>
                     )}
                  </dd>
               </>
            )}
            {blockers.length > 0 && (
               <>
                  <dt className={term}>Waits on</dt>
                  <dd className="m-0 max-w-[70ch] text-ink-2">
                     {blockers.map(({ item: b, clash }, i) => (
                        <span key={b.id}>
                           {i > 0 && '; '}
                           <FactLink onClick={() => onOpenItem(b.id)} title={`Open ${b.name}`}>
                              {b.name}
                           </FactLink>
                           {isStopped(b.status)
                              ? `, which was ${b.status}`
                              : b.end_kind === 'ongoing'
                              ? ', which is ongoing, with no end'
                              : `, which ends ${weekWords(planEnd(b))}${
                                   clash ? ', after this starts' : ''
                                }`}
                        </span>
                     ))}
                  </dd>
               </>
            )}
            {item.origin && (
               <>
                  <dt className={term}>Came from</dt>
                  <dd className="m-0 text-ink-2">{ORIGIN_WORD[item.origin]}</dd>
               </>
            )}
            <dt className={term}>Notes</dt>
            <dd className="m-0 text-ink-2">
               {item.notes ? (
                  <p className="m-0 max-w-[70ch] whitespace-pre-line">{item.notes}</p>
               ) : (
                  <QuietButton onClick={() => onEdit('notes')}>Add a note</QuietButton>
               )}
            </dd>
            <dd className={`mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs ${WIDE}`}>
               <QuietButton id={`roadmap-details-${item.id}`} onClick={() => onEdit()}>
                  Edit details
               </QuietButton>
               {/* one click: its receipt in the row's place has the Undo */}
               <QuietButton
                  disabled={removing}
                  onClick={() => {
                     setRemoving(true);
                     void onRemove().finally(() => setRemoving(false));
                  }}
               >
                  Remove from the roadmap
               </QuietButton>
               <span className="flex-1" />
               <QuietButton onClick={onClose}>Close</QuietButton>
            </dd>
         </dl>
      </div>
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
 * reaching through the row's padding, so they run unbroken down the list.
 * On a phone the track sits under the row's words, so they start at it. */
function Gridlines({ axis }: { axis: Axis }) {
   return (
      <>
         {axis.lines.map(l => (
            <span
               key={`${l.left}:${l.strong}`}
               aria-hidden
               className="pointer-events-none absolute top-0 -bottom-1.5 border-l sm:-top-[7px]"
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
               className="pointer-events-none absolute top-0 -bottom-1.5 border-l border-dashed sm:-top-[7px]"
               style={{ left: `${axis.todayAt}%`, borderColor: 'var(--brand)' }}
            />
         )}
         {axis.picked && (
            <span
               aria-hidden
               className="pointer-events-none absolute top-0 -bottom-1.5 sm:-top-[7px]"
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
   /** the plan it removed, kept in its place in the list of plans */
   gone?: RoadmapItem;
}

function ReceiptLine({ receipt, onOpen }: { receipt: Receipt; onOpen: (id: number) => void }) {
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
 * One planned item: its place in the order and its name (the door to its
 * project's page, as everywhere in the tab, or to its details when it
 * tracks no project), with its grip and lead on the row's hover, and its
 * bar. A second line only when Decide asks something (restWords), so a
 * row's height says it wants you; the rest waits in its details. The bar's
 * form says its status, its length on the axis its weeks; it names only an
 * end its form can't show (Ongoing, Promised). A click on the bar opens the
 * details; a drag moves the plan, and a drag on its right edge (shown on
 * hover and focus) changes the length. Both snap to whole weeks, Escape
 * puts the bar back mid-drag, and with the bar focused the arrow keys do
 * the same (Shift changes the length). A plan still in flight past its end
 * grows a piece labeled "3 wk overdue" up to today, fading on after it
 * since nothing says when it ends (in ink past a soft end, which nothing
 * asks about), and its milestone is a flag, with its date while that's
 * ahead. A bar the view cuts off is square at the cut, so it reads as going
 * on, which is how ongoing work, with no end and no length to drag, always
 * runs. A call Decide asks about the plan is its one amber mark.
 */
function PlanRow({
   item,
   all,
   rank,
   axis,
   today,
   linked,
   call,
   open,
   onOpen,
   onPerson,
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
   /** the call Decide asks about it */
   call: PlanCall | null;
   /** its details are open under the row */
   open: boolean;
   /** open its details */
   onOpen: () => void;
   onPerson: (login: string) => void;
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
   const ongoing = item.end_kind === 'ongoing';
   const hard = item.end_kind === 'hard';
   // upkeep in progress recedes into the planned tint: it asks for nothing
   const look: RoadmapStatus = ongoing && item.status === 'active' ? 'planned' : item.status;
   const end = planEnd(plan);
   const left = place(plan.start);
   // ongoing work runs on past the weeks shown
   const right = ongoing ? 100 : place(addWeeks(plan.start, plan.weeks));
   // the same warnings, in the same words, as now, next and later
   const w = planWarnings(item, all, today, trackedBy(linked), undefined, call);
   const project = item.project;
   // cut off by the weeks shown: square at the cut, so it reads as going on
   const cutLeft = plan.start < horizon.start;
   const cutRight = ongoing || addWeeks(plan.start, plan.weeks) > horizon.end;
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
      // ongoing work has no length to change
      if (e.shiftKey && ongoing) return;
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 1 : -1;
      commit(
         e.shiftKey
            ? { start: item.start, weeks: Math.min(MAX_WEEKS, Math.max(1, item.weeks + step)) }
            : { start: addWeeks(item.start, step), weeks: item.weeks }
      );
   };
   // one line at rest, a second only when Decide asks something (or the
   // order clashes): row height itself says "this one wants you". The lead
   // shows on the row's hover, the rest in its details
   const lead = item.lead;
   const rest = restWords(w);
   const span = ongoing
      ? `from ${weekWords(plan.start)}`
      : `${weekWords(plan.start)} to ${weekWords(end)}`;
   // the bar says its status and its end by its form; in words for a hover
   // and a reader
   const facts = `${STATUS_WORD[item.status]}, ${planWords({ ...plan, end_kind: item.end_kind })}${
      lead ? `, led by ${lead}` : ''
   }`;
   const barText = 'text-[11px] leading-[14px] font-medium whitespace-nowrap tabular-nums';
   const name =
      'hit pressable min-w-0 rounded border-0 bg-transparent p-0 text-left text-[13px] font-medium break-words text-ink hover:text-brand';
   return (
      <div
         {...dragHandlers.row}
         className="border-t border-secondary first:border-t-0"
         style={dropHere ? { boxShadow: 'inset 0 2px 0 0 var(--brand)' } : undefined}
      >
         <div className={`group/plan ${rowGrid} px-3.5 py-1.5 hover:bg-muted`}>
            <span className="flex min-w-0 items-start gap-2">
               <span
                  {...dragHandlers.grip}
                  id={`roadmap-grip-${item.id}`}
                  role="button"
                  tabIndex={0}
                  draggable
                  aria-label={`${item.name}: priority ${rank}. Drag, or use the up and down arrow keys, to change its place`}
                  title="Drag to change its priority"
                  // padded and widened by .hit to a 24px target, taking no
                  // more room in the row. The rank already says the rows are
                  // ordered, so the grip shows on the row's hover or focus,
                  // and always on touch, which has no hover
                  className="hit -m-0.5 flex-none cursor-grab leading-5 touch-none p-0.5 text-ink-3 opacity-0 transition-opacity duration-150 group-hover/plan:opacity-100 group-focus-within/plan:opacity-100 hover:text-ink focus-visible:text-brand focus-visible:opacity-100 active:cursor-grabbing motion-reduce:transition-none [@media(hover:none)]:opacity-100"
               >
                  <Icon icon={GripVertical} size={13} />
               </span>
               <span className="w-5 flex-none text-right text-xs leading-5 text-ink-3 tabular-nums">
                  {rank}
               </span>
               <span className="flex min-w-0 flex-col">
                  <span className="flex min-w-0 items-baseline gap-x-1.5">
                     {project ? (
                        <button
                           type="button"
                           data-roadmap-focus
                           onClick={() => onOpenProject(project)}
                           className={name}
                           title="Open the project’s page"
                        >
                           {item.name}
                        </button>
                     ) : (
                        // with no project page, its details are its page
                        <button
                           type="button"
                           data-roadmap-focus
                           aria-expanded={open}
                           onClick={onOpen}
                           className={name}
                           title="Open its plan; it tracks no project yet"
                        >
                           {item.name}
                        </button>
                     )}
                     {/* on the row's hover or focus, in a slot it already
                         takes, so nothing moves; no lead says so in the plan */}
                     {lead && (
                        <FactLink
                           onClick={() => onPerson(lead)}
                           title={`Open ${lead}’s row on People`}
                           className="pointer-events-none flex-none text-[11px] text-ink-3 opacity-0 group-hover/plan:pointer-events-auto group-hover/plan:opacity-100 group-focus-within/plan:pointer-events-auto group-focus-within/plan:opacity-100"
                        >
                           {lead}
                        </FactLink>
                     )}
                  </span>
                  {rest && (
                     // plain words, dotted since their hover explains: the
                     // bar and the name open the plan. What the answer in its
                     // details is read with, so a reader hears the reason too
                     <span
                        id={`roadmap-words-${item.id}`}
                        title={rest.title}
                        className="self-start text-[11px] text-ink-3 underline decoration-dotted underline-offset-2"
                     >
                        <span className="sr-only">{rest.title}</span>
                        <span aria-hidden>
                           <SaidWords said={rest} />
                        </span>
                     </span>
                  )}
               </span>
            </span>
            <span ref={trackRef} className="relative block h-9">
               <Gridlines axis={axis} />
               {right > left ? (
                  <button
                     type="button"
                     id={`roadmap-bar-${item.id}`}
                     aria-expanded={open}
                     aria-label={`${
                        item.name
                     }: ${facts}. Enter opens its plan; the left and right arrows move it a week${
                        ongoing ? '' : ', and with Shift they change its length'
                     }.`}
                     title={`${facts}. ${
                        END_MEANS[item.end_kind]
                     } Click to open its plan; drag to move it${
                        ongoing ? '' : ', or drag its right edge to change its length'
                     }. Escape cancels a drag.`}
                     onPointerDown={e => grab(e, 'move')}
                     onClick={() => {
                        if (!dragged.current) onOpen();
                     }}
                     onKeyDown={keys}
                     // .hit takes the 16px bar to a 24px target, so the words
                     // inside clip themselves rather than the bar clipping it
                     className={`group/bar hit @container absolute top-1.5 h-4 cursor-grab touch-none border-y border-transparent p-0 text-left active:cursor-grabbing ${
                        cutLeft ? '' : 'rounded-l-md'
                     } ${cutRight ? '' : 'rounded-r-md'}`}
                     style={{ left: `${left}%`, width: `max(${right - left}%, 6px)` }}
                  >
                     {/* the bar's own layer, under its words: its form says
                         its status, and a promised end has an ink cap */}
                     <span
                        aria-hidden
                        className={`pointer-events-none absolute inset-x-0 -inset-y-px border-y ${
                           cutLeft ? '' : 'rounded-l-md border-l'
                        } ${cutRight ? '' : 'rounded-r-md border-r'}`}
                        style={{
                           ...BAR_STYLE[look],
                           ...(hard && !cutRight ? HARD_CAP : {}),
                        }}
                     />
                     {/* no weeks or dates at rest: the bar's length on the
                         axis says them, and its hover and a drag say them in
                         words. Only an end the form can't show is named: work
                         that runs off the edge, and a promise's ink cap */}
                     {(ongoing || hard) && (
                        <span aria-hidden className="relative block overflow-hidden">
                           <span
                              className={`hidden px-1.5 ${barText} ${
                                 ongoing ? '@min-[3.25rem]:block' : '@min-[6.5rem]:block'
                              }`}
                              style={{ color: BAR_TEXT[look] }}
                           >
                              {END_WORD[item.end_kind]}
                           </span>
                        </span>
                     )}
                     {/* the edge that changes the length, shown on hover and
                         focus so the bar says it can; above the bar's own
                         widened target. Ongoing work has no length. */}
                     {!ongoing && (
                        <span
                           aria-hidden
                           onPointerDown={e => grab(e, 'resize')}
                           className="absolute inset-y-0 right-0 z-[1] flex w-2 cursor-ew-resize items-center justify-center opacity-0 transition-opacity duration-150 group-hover/bar:opacity-100 group-focus-visible/bar:opacity-100 motion-reduce:transition-none"
                        >
                           <span
                              className="h-2.5 w-0.5 rounded-full"
                              style={{ background: BAR_STYLE[look].borderColor }}
                           />
                        </span>
                     )}
                  </button>
               ) : (
                  !(w.over && overWidth > 0) && (
                     // outside the weeks shown: its dates, at the edge it's past
                     <button
                        type="button"
                        onClick={() => onShow(plan.start)}
                        className={`hit absolute top-1.5 inline-flex items-center gap-0.5 border-0 bg-transparent p-0 text-[11px] leading-4 whitespace-nowrap text-ink-3 tabular-nums hover:text-brand ${
                           right <= 0 ? 'left-1' : 'right-1'
                        }`}
                        title={`Planned ${span}, outside the weeks shown. Click to show it.`}
                     >
                        {right <= 0 && <Icon icon={ChevronLeft} size={11} />}
                        {span}
                        {right > 0 && <Icon icon={ChevronRight} size={11} />}
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
                        // the bar opens the same details from the keyboard
                        tabIndex={-1}
                        onClick={onOpen}
                        className={`hit @container absolute top-1.5 h-4 border-y p-0 text-left text-[11px] leading-[14px] font-medium whitespace-nowrap ${
                           today < horizon.end ? 'rounded-r-md border-r' : ''
                        } ${isAmber(w.over) ? 'text-warn' : 'text-ink-2'}`}
                        style={{
                           left: `${right}%`,
                           width: `${overWidth}%`,
                           background: over.tint,
                           borderColor: over.edge,
                        }}
                        title={`${w.over.title} Click to open its plan.`}
                     >
                        {/* its words inside it when they fit (two digits need
                            more room), else just past today's line, where it
                            ends: never cut */}
                        <span
                           className={`hidden px-1 ${
                              w.over.weeks < 10 ? '@min-[4.5rem]:block' : '@min-[5rem]:block'
                           }`}
                        >
                           {w.over.mark}
                        </span>
                        <span
                           className={`absolute top-0 left-full pl-1.5 ${
                              w.over.weeks < 10 ? '@min-[4.5rem]:hidden' : '@min-[5rem]:hidden'
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
                     className="absolute top-[23px] inline-flex items-center gap-0.5 border-0 bg-transparent p-0 text-[11px] leading-3 font-medium whitespace-nowrap text-ink-2 hover:underline"
                     style={{
                        left: `${place(due)}%`,
                        // near the right edge, the words go on the flag's left
                        transform: place(due) > 80 ? 'translateX(-100%)' : undefined,
                     }}
                     title={`${targetName}, ${due < today ? 'was ' : ''}due ${weekWords(
                        due
                     )}. Click to open the project.`}
                  >
                     <Icon icon={Flag} size={11} />
                     {/* a passed target is the flag alone: the overrun and
                         Decide's question already say late */}
                     {due >= today && `Due ${weekWords(due)}`}
                  </button>
               )}
               {preview && (
                  <span
                     className="pointer-events-none absolute -top-3.5 z-[1] rounded bg-surface px-1 text-[11px] whitespace-nowrap text-ink-2 shadow-sm tabular-nums"
                     style={{ left: `${left}%` }}
                  >
                     {ongoing
                        ? `${span}, ${END_IN_A_SENTENCE.ongoing}`
                        : `${span} · ${n(plan.weeks, 'week')}`}
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
 * which has no hover; in Needs a plan, where planning is the point, a Plan
 * it button that always shows), its name (the door to its page), its lead and open
 * PRs, and a dashed bar over the weeks its PRs have run, fading past today
 * since nothing says when it ends; its words go just past today when the
 * bar is too short to hold them. Dragging across its weeks plans it for
 * them; Escape lets go without planning.
 */
function InFlightRow({
   item,
   span,
   axis,
   today,
   call,
   needsPlan,
   planIt,
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
   /** a call Decide asks about it other than a first plan, its one amber mark */
   call: PlanCall | null;
   /** say Decide asks for a plan, where no fold around it says so */
   needsPlan: boolean;
   /** in the Needs a plan lane: planning it is the point, so its button
    * always shows */
   planIt: boolean;
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
   // its PRs began before the weeks shown: square at the cut
   const cut = !!span && span.start < horizon.start;
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
            {planIt ? (
               // keeps the names in line with the rows that have a plus
               <span aria-hidden className="w-[17px] flex-none" />
            ) : (
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
            )}
            <span className="min-w-0 break-words">
               <button
                  type="button"
                  data-roadmap-focus
                  onClick={onOpen}
                  className="hit pressable rounded border-0 bg-transparent p-0 text-left text-[13px] text-ink hover:text-brand"
                  title="Open the project’s page"
               >
                  {item.name}
               </button>
               <span className="ml-2 inline-flex flex-wrap gap-x-1.5 text-[11px] text-ink-3">
                  <Dotted>
                     {[
                        item.lead && (
                           <FactLink
                              key="lead"
                              onClick={() => onPerson(item.lead as string)}
                              title={`Open ${item.lead}’s row on People`}
                           >
                              {item.lead}
                           </FactLink>
                        ),
                        call ? (
                           <span
                              key="call"
                              title={`Decide asks: ${call.title} Open the project, where you can decide in one click.`}
                           >
                              <FactLink
                                 // the name opens the same page from the keyboard
                                 tabIndex={-1}
                                 onClick={onOpen}
                              >
                                 {call.text}
                              </FactLink>
                              {' · '}
                              <span className="text-warn">{call.question}</span>
                           </span>
                        ) : (
                           needsPlan && <span key="needs">{NEEDS_A_PLAN.toLowerCase()}</span>
                        ),
                        <FactLink
                           key="open"
                           onClick={onOpen}
                           // the name opens the same page from the keyboard
                           tabIndex={-1}
                           title="Open the project and its PRs"
                        >
                           {saving ? 'Saving its plan…' : n(item.open, 'open PR')}
                        </FactLink>,
                     ]}
                  </Dotted>
               </span>
            </span>
            {planIt && (
               <span className="ml-auto flex-none self-center">
                  <QuietButton
                     id={`roadmap-plus-${item.slug}`}
                     onClick={onChoose}
                     disabled={saving}
                     aria-expanded={choosing}
                     aria-label={`${PLAN_IT}: ${item.name}`}
                     title={`Put ${item.name} on the roadmap`}
                  >
                     {PLAN_IT}
                  </QuietButton>
               </span>
            )}
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
                  className={`@container absolute top-1 h-4 border-y border-dashed ${
                     cut ? '' : 'rounded-l-md border-l'
                  }`}
                  style={{
                     left: `${left}%`,
                     width: `${now - left}%`,
                     borderColor: 'color-mix(in oklab, var(--ink-3) 70%, transparent)',
                     background: 'color-mix(in oklab, var(--ink-3) 14%, transparent)',
                  }}
                  title={`PRs since ${weekWords(span.start)}, and no plan saying when it ends`}
               >
                  {/* its words inside it when they fit, else just past
                      today, where it ends, shorter */}
                  <span className="hidden px-1.5 text-[11px] leading-[14px] whitespace-nowrap text-ink-2 @min-[9rem]:block">
                     since {weekWords(span.start)}, no plan
                  </span>
                  <span className="absolute top-0 left-full pl-1.5 text-[11px] leading-[14px] whitespace-nowrap text-ink-2 @min-[9rem]:hidden">
                     since {weekWords(span.start)}
                  </span>
               </span>
            )}
            {span && now <= left && tail > 0 && (
               // its PRs began before the weeks shown and today is at their
               // start: no bar to hold its words, so they stand at the edge
               <span className="pointer-events-none absolute top-1 left-1 inline-flex items-center gap-0.5 text-[11px] leading-4 whitespace-nowrap text-ink-2">
                  <Icon icon={ChevronLeft} size={11} />
                  since {weekWords(span.start)}
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
                  <span className="absolute -top-4 left-0 rounded bg-surface px-1 text-[11px] whitespace-nowrap text-ink-2 shadow-sm tabular-nums">
                     {weekWords(drag.start)} to {weekWords(planEnd(drag))} · {n(drag.weeks, 'week')}
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
 * coming month or quarter, Decide's own call with the nearest end its one
 * outlined answer. Each one plans it in one click; the editor is there for
 * anything else. It opens with the focus on that answer.
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
   /** its first week (runStart), and what that week is */
   start: { day: string; from: 'field' | 'prs' };
   onPlan: (plan: Span) => void;
   onClose: () => void;
}) {
   // its issue's target first while it's ahead, as on Decide
   const target = item.target?.due_on?.slice(0, 10) ?? null;
   return (
      <div
         className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-secondary bg-muted/40 px-3.5 py-2 text-xs text-ink-3"
         onKeyDown={e => {
            if (e.key === 'Escape') onClose();
         }}
      >
         <span>
            Plan {item.name} from the week of {weekWords(start.day)},{' '}
            {start.from === 'field' ? 'its issue’s Start date' : 'when its PRs began'}.
         </span>
         <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {COMMIT_THROUGH}
            <Dotted>
               {commitEnds(today, target)
                  .filter(c => c.end >= start.day)
                  .map((c, i) => {
                     const plan = { start: start.day, weeks: weeksThrough(start.day, c.end) };
                     const props = {
                        onClick: () => onPlan(plan),
                        'aria-label': `Plan ${item.name} through ${c.through}`,
                        title: planWords(plan),
                     };
                     // in the run of words, "Promise to finish by its target date, Oct 21"
                     const words = c.target ? c.through : c.label;
                     return (
                        <QuietButton key={c.end} autoFocus={i === 0} {...props}>
                           {words}
                        </QuietButton>
                     );
                  })}
            </Dotted>
         </span>
         <span>Or drag across its weeks on the timeline.</span>
         <QuietButton onClick={onClose}>Cancel</QuietButton>
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
         )}. Above this line, in priority order, is the work that takes all ${developers} this week: ${TEAM_LOAD_RULE}. Below it, anything ${BEING_WORKED_ON} has nobody left to staff it. Park or finish something, or drag what matters less below the line. Click to see ${team}’s decisions.`}
      >
         <span>
            Below here: more {BEING_WORKED_ON} this week than {team}’s {n(developers, 'developer')}{' '}
            can staff. <span className="underline underline-offset-2">See {team}’s decisions</span>
         </span>
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
   defaultOpen = true,
   showCount = true,
   children,
}: {
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
 * A column that can fill the width is a button, its zoom glass shown on
 * hover and focus. */
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
               // four quarters across a phone fit only without the year, so
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
                     className={`group/zoom pressable absolute top-0 inline-flex items-center gap-1 rounded-none border-0 border-l border-line bg-transparent py-0 pl-1.5 pr-0 whitespace-nowrap text-ink-2 hover:text-brand ${eyebrowText}`}
                     style={style}
                  >
                     {label}
                     {/* the name zooms; the glass says so on hover and focus,
                         not after every name */}
                     <span className="hidden opacity-0 group-hover/zoom:opacity-100 group-focus-visible/zoom:opacity-100 sm:inline">
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
                     className="pressable absolute bottom-0 hidden border-0 bg-transparent p-0 pl-1 text-[11px] text-ink-3 tabular-nums hover:text-brand hover:underline sm:block"
                     style={{ left: `${t.left}%` }}
                  >
                     {t.label}
                  </button>
               ) : (
                  <span
                     key={t.left}
                     className="absolute bottom-0 hidden pl-1 text-[11px] text-ink-3 tabular-nums sm:block"
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
 * Lanes split both by team, each with its own load. A call Decide asks is
 * said on its row, its one amber mark. The roadmap is Pulldasher's own
 * record (the one thing in this tab not read off GitHub), saved as you go.
 */
export function Roadmap({
   items,
   teamMembers,
   nav,
   navigate,
   decisions,
}: {
   /** the portfolio, for linking plans to projects and their PRs */
   items: PortfolioItem[];
   /** developer teams: name to logins */
   teamMembers: Record<string, string[]>;
   nav: ProjectsNav;
   navigate: Navigate;
   /** the calls Decide asks for now (null while they load), so a plan's row
    * names the same call Decide and the Overview do */
   decisions?: DecideRow[] | null;
}) {
   const { items: plan, loadFailed, problem } = useRoadmap();
   // Decide's rows with the calls made here kept, so a call made in a plan's
   // details keeps its receipt and Undo there
   const callsHere = useCallsMadeHere(decisions ?? NO_ROWS);
   const teams = Object.keys(teamMembers);
   // the open item is in the URL, so a link can open it; its details show
   // under it, read first: on its updates when that's the door it was opened
   // by, or on its fields once Edit details opens them
   const editing = nav.item;
   const [panel, setPanel] = useState<'plan' | 'updates' | 'edit'>('plan');
   const [editFocus, setEditFocus] = useState<'name' | 'notes' | 'project' | 'done_when'>('name');
   // whether the open details take the focus to their calls: yes from a
   // door, no on the way back from their fields
   const [focusCalls, setFocusCalls] = useState(true);
   // the open fields hold changes not saved, or the update form words not
   // posted: another plan or a close waits
   const dirty = useRef(false);
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
   // to where the run began; `was` is the plan as the run found it
   const run = useRef<{
      key: string;
      from: Span | number[];
      team: string | null;
      was: RoadmapItem;
   } | null>(null);
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
   // the calls Decide asks, by the plan they're about, and by project for
   // work with no plan, each in the words the Overview's Plan cell uses: a
   // row says its call where its one amber mark goes
   const callOf = (row: DecideRow): PlanCall => {
      const reason = row.reasons.reduce((a, b) => (RANK[b.kind] < RANK[a.kind] ? b : a));
      const sentence = reasonWords(reason, row.item);
      return {
         kind: reason.kind,
         text: planCell(
            { plan: row.item, project: null, asks: [{ reason, item: row.item }] },
            today,
            now.getTime() / 1000
         ).text,
         question: askOf(reason).question,
         title: sentence,
      };
   };
   const planCalls = new Map<number, PlanCall>();
   const projectCalls = new Map<string, PlanCall>();
   // the projects with no plan that Decide asks to plan ("Plan it?")
   const asksPlan = new Set<string>();
   for (const row of decisions ?? []) {
      if (row.item) planCalls.set(row.item.id, callOf(row));
      else if (row.slug) {
         if (row.reasons.some(r => r.kind === 'new')) asksPlan.add(row.slug);
         const call = callOf(row);
         if (call.kind !== 'new') projectCalls.set(row.slug, call);
      }
   }
   const lanes = nav.group === 'team';
   // Show: every row, only the plans, or only the projects with no plan
   const showPlans = nav.show !== 'unplanned';
   const everything = nav.show !== 'plan';
   const ordered = plan ?? [];
   const ids = ordered.map(i => i.id);
   // a plan just removed keeps its place in the rows while its receipt
   // stands there, so Undo is where Remove was; nothing counts it
   const gone = receipt?.gone && !ids.includes(receipt.gone.id) ? receipt.gone : null;
   const listed = gone ? byPriority([...ordered, gone]) : ordered;
   const counted = (list: readonly RoadmapItem[]) => list.filter(i => i !== gone).length;
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
      ? listed.filter(
           i =>
              found(i) &&
              fromOrigin(i) &&
              (!members ||
                 i === gone ||
                 members.plans.has(i.id) ||
                 (!!i.project && members.projects.get(i.project) === 'on'))
        )
      : [];
   const shownUnplanned = nav.origin
      ? []
      : unplanned.filter(
           p =>
              (!filter || filter(p)) &&
              (!members || members.projects.get(p.slug) === 'off' || keepsPlace(p.slug))
        );
   const narrowed = !!(q || picked || nav.origin);
   const needing = shownUnplanned.filter(p => asksPlan.has(p.slug));
   const shipping = shownUnplanned.filter(p => !asksPlan.has(p.slug));
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
   // what starts, and what should end, in the next four weeks: the chart
   // says it in words right of today, where bars drawn from the plans could
   // only fall
   const fourWeeks = utcDay((dayStart(today) as number) + 28 * DAY);
   const within = (day: string | null): day is string => !!day && day >= today && day < fourWeeks;
   const nextWeeks = {
      starts: ordered.flatMap(i =>
         i.status === 'planned' && within(i.start) ? [{ name: i.name, day: i.start }] : []
      ),
      ends: ordered.flatMap(i => {
         const end = endOf(i);
         return isUnderWay(i.status) && within(end) ? [{ name: i.name, day: end }] : [];
      }),
   };
   const projectOptions = [...items]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(i => ({ slug: i.slug, name: i.name, target: i.target?.due_on?.slice(0, 10) ?? null }));
   const people = [
      ...new Set([
         ...items.flatMap(i => [...i.developers, ...i.nonDevelopers, i.lead ?? '']),
         ...teams,
      ]),
   ].filter(Boolean);

   // a person clicked anywhere in the tab opens their row on People
   const person = (login: string) =>
      navigate({ ...switchView('people'), who: login }, { push: true });
   // fields with changes not saved, or an update half written, keep their
   // place: the focus goes back to them, and a screen reader hears why
   const held = () => {
      if (editing == null || panel === 'plan' || !dirty.current) return false;
      setAnnounced(
         panel === 'edit'
            ? 'Save your changes, or Cancel them, first.'
            : 'Post the update, or empty its box, first.'
      );
      document
         .getElementById(`roadmap-item-${editing}`)
         ?.querySelector<HTMLElement>('form input, form select, form textarea')
         ?.focus();
      return true;
   };
   const open = (id: number, which: 'plan' | 'updates') => {
      if (held()) return;
      // a second click on the same door, or on any while a form in it is
      // open, closes it
      if (editing === id && (panel === which || panel !== 'plan')) return close(id);
      setPanel(which);
      setFocusCalls(true);
      if (editing !== id) navigate({ item: id });
   };
   const close = (id: number) => {
      refocus.current = [`roadmap-bar-${id}`, `roadmap-grip-${id}`];
      navigate({ item: null });
   };
   const openFromReceipt = (id: number) => {
      if (held()) return;
      setPanel('plan');
      setFocusCalls(true);
      navigate(openPlan(nav, id));
   };
   // its row on Decide, asked or answered here, else the plan alone, for the
   // calls in its details
   const rowFor = (item: RoadmapItem): DecideRow => {
      const mine = callsHere.all.filter(r => r.item?.id === item.id);
      return (
         mine.find(r => r.reasons.length > 0) ??
         mine[0] ?? { slug: item.project, item, reasons: [] }
      );
   };
   const say = (next: Receipt | null, words?: string) => {
      if (next?.key !== run.current?.key) run.current = null;
      setReceipt(next);
      setAnnounced(words ?? (next ? `${next.words.replace(/\.$/, '')}.` : ''));
   };
   // a save that failed says so where the click was, not in the toolbar;
   // `keep` holds a removed plan's place, and its Undo, to try again
   const fail = (key: string, keep?: Pick<Receipt, 'gone' | 'undo'>) => {
      const why = readRoadmap().problem;
      dismissRoadmapProblem();
      run.current = null;
      say({
         key,
         words: why ?? 'Couldn’t save that. Try again in a minute',
         failed: true,
         ...keep,
      });
   };
   const moved = (item: RoadmapItem, to: Span) => {
      const key = `plan:${item.id}`;
      if (run.current?.key !== key || Array.isArray(run.current.from)) {
         run.current = {
            key,
            from: { start: item.start, weeks: item.weeks },
            team: item.team,
            was: item,
         };
      }
      const { was } = run.current;
      const from = run.current.from as Span;
      void updateRoadmapItem(item.id, to).then(ok => {
         if (!ok) return fail(key);
         const words = moveWords(item.name, from, to);
         if (!words) return say(null, `${item.name} is back where it was`);
         // a nudge can take away something owed without anyone meaning to
         // (a later start resets when an update is due), so it says so
         const tracked = trackedBy(was.project ? bySlug.get(was.project) : undefined);
         const cleared = clearedBy(
            planWarnings(was, ordered, today, tracked),
            planWarnings({ ...was, ...to, updated_at: Date.now() / 1000 }, ordered, today, tracked)
         );
         say({
            key,
            words: cleared ? `${words}, which clears its “${cleared}”` : words,
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
         run.current = { key, from: ids, team: item.team, was: item };
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
   // a save in the editor: what it changed, and Undo puts back the fields
   // and the times it replaced, as Decide's Undo does
   const saved = (was: RoadmapItem, changed: Partial<RoadmapFields>) => {
      const key = `plan:${was.id}`;
      // a run of drags before it isn't this receipt's to undo
      run.current = null;
      const back = Object.fromEntries(
         Object.keys(changed).map(k => [k, was[k as keyof RoadmapFields]])
      ) as Partial<RoadmapFields>;
      const times =
         was.updated_at != null
            ? { updated_at: was.updated_at, status_at: was.status_at ?? null }
            : undefined;
      say({
         key,
         words: savedWords(was, changed),
         undo: () => {
            refocus.current = [`roadmap-bar-${was.id}`, `roadmap-grip-${was.id}`];
            void updateRoadmapItem(was.id, back, { undo: times }).then(ok =>
               ok ? say(null, `Put ${was.name} back as it was`) : fail(key)
            );
         },
      });
   };
   const removed = (item: RoadmapItem, visible: number[]) => {
      // the focus goes to the plan that took its place; its receipt, with
      // Undo, stands where it was
      const at = visible.indexOf(item.id);
      const next = visible[at + 1] ?? visible[at - 1];
      refocus.current = [...(next == null ? [] : [`roadmap-grip-${next}`]), 'roadmap-add'];
      navigate({ item: null });
      const key = `plan:${item.id}`;
      run.current = null;
      const undo = () => {
         refocus.current = [`roadmap-grip-${item.id}`];
         void restoreRoadmapItem(item.id).then(ok =>
            ok ? say(null, `Put ${item.name} back on the roadmap`) : fail(key, { gone: item, undo })
         );
      };
      say({ key, words: `Removed ${item.name} from the roadmap`, gone: item, undo });
   };
   const added = (item: RoadmapItem) => {
      const rank = (readRoadmap().items ?? []).findIndex(i => i.id === item.id) + 1;
      refocus.current = ['roadmap-add'];
      say({
         key: 'added',
         words: `Added ${item.name} to the roadmap${rank ? `, at priority ${rank}` : ''}`,
         open: item.id,
         undo: () => {
            refocus.current = ['roadmap-add'];
            void removeRoadmapItem(item.id).then(ok =>
               ok ? say(null, `Took ${item.name} off the roadmap`) : fail('added')
            );
         },
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

   // a new plan's first week: its issue's Start date when a person set one,
   // as everywhere a person's value wins, else the week its PRs began
   const runStart = (p: PortfolioItem): { day: string; from: 'field' | 'prs' } => {
      const field = p.project?.fields.start;
      if (field && dayStart(field) != null) return { day: mondayOf(field), from: 'field' };
      return { day: mondayOf((p.group && firstOpenDay(p.group)) || today), from: 'prs' };
   };
   const planProject = (p: PortfolioItem, span: Span, end_kind: EndKind) => {
      setChoosing(null);
      if (planning.current.has(p.slug)) return;
      planning.current.add(p.slug);
      setSaving(new Set(planning.current));
      const key = `project:${p.slug}`;
      void createRoadmapItem({
         name: p.name,
         project: p.slug,
         // the lane it's in now
         team: p.team,
         lead: p.lead,
         // it has PRs in flight, so it's under way once its weeks have come
         status: span.start <= today ? 'active' : 'planned',
         ...span,
         end_kind,
      }).then(made => {
         planning.current.delete(p.slug);
         setSaving(new Set(planning.current));
         if (!made) return fail(key);
         say({
            key,
            words: `Planned ${p.name}: ${planWords({ ...span, end_kind })}`,
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
   // j and k move between the rows, as on the board, skipping a folded lane
   useRowKeys('[data-roadmap-row]:not(details:not([open]) *)', '[data-roadmap-focus]');
   // the sticky headers' height, for the rows' scroll margin (rowMargin):
   // the toolbar grows with its chips, and on a phone it doesn't stick
   useLayoutEffect(() => {
      const bar = stickyRef.current;
      const section = bar?.parentElement;
      if (!bar || !section) return;
      const measure = () =>
         section.style.setProperty(
            '--roadmap-stuck',
            `${getComputedStyle(bar).position === 'sticky' ? bar.offsetHeight : 0}px`
         );
      measure();
      const watch = new ResizeObserver(measure);
      watch.observe(bar);
      return () => watch.disconnect();
   }, [timeline]);
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
         // removed just now: its receipt stands where the row was
         if (item === gone && receipt) {
            return (
               <div key={item.id} className={rowMargin}>
                  <ReceiptLine receipt={receipt} onOpen={openFromReceipt} />
               </div>
            );
         }
         const isOpen = editing === item.id;
         const linked = item.project ? bySlug.get(item.project) : undefined;
         return (
            <div
               key={item.id}
               id={`roadmap-item-${item.id}`}
               data-roadmap-row
               className={rowMargin}
            >
               <PlanRow
                  item={item}
                  all={ordered}
                  rank={ids.indexOf(item.id) + 1}
                  axis={axis}
                  today={today}
                  linked={linked}
                  call={planCalls.get(item.id) ?? null}
                  open={isOpen}
                  onOpen={() => open(item.id, 'plan')}
                  onPerson={person}
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
                  (panel === 'edit' ? (
                     <Editor
                        item={item}
                        all={ordered}
                        projects={projectOptions}
                        teams={teams}
                        people={people}
                        today={today}
                        focus={editFocus}
                        dirty={dirty}
                        onSaved={saved}
                        onDone={() => {
                           // back to its details, on the way to its fields
                           refocus.current = [`roadmap-details-${item.id}`];
                           setFocusCalls(false);
                           setPanel('plan');
                        }}
                     />
                  ) : (
                     <PlanPanel
                        item={item}
                        all={ordered}
                        linked={linked}
                        today={today}
                        row={rowFor(item)}
                        focusCalls={focusCalls}
                        updates={panel === 'updates'}
                        dirty={dirty}
                        onUpdates={on => {
                           // closed: back to the way it was opened
                           if (!on) refocus.current = [`roadmap-post-${item.id}`];
                           setPanel(on ? 'updates' : 'plan');
                        }}
                        onEdit={focus => {
                           setEditFocus(focus ?? 'name');
                           setPanel('edit');
                        }}
                        onRemove={() =>
                           removeRoadmapItem(item.id).then(gone =>
                              gone ? removed(item, visibleIds) : fail(key)
                           )
                        }
                        onClose={() => close(item.id)}
                        onPerson={person}
                        onOpenItem={openFromReceipt}
                        onOpenProject={slug => navigate({ project: slug })}
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
            <div key={p.slug} data-roadmap-row className={rowMargin}>
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
                        call={projectCalls.get(p.slug) ?? null}
                        // the lanes have no fold that says it
                        needsPlan={lanes && asksPlan.has(p.slug)}
                        planIt={!lanes && asksPlan.has(p.slug)}
                        choosing={choosing === p.slug}
                        saving={saving.has(p.slug)}
                        onChoose={() => setChoosing(choosing === p.slug ? null : p.slug)}
                        // a drag across weeks sketches an estimate
                        onPlan={span => planProject(p, span, 'soft')}
                        onOpen={() => navigate({ project: p.slug })}
                        onPerson={person}
                     />
                     {choosing === p.slug && (
                        <PlanChooser
                           item={p}
                           today={today}
                           start={runStart(p)}
                           // "Commit through" is a commitment, as on Decide
                           onPlan={span => planProject(p, span, 'hard')}
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

   // the teams in their configured order, then any other a plan names, by
   // name; "No team" goes last
   const laneTitles = [
      ...teams,
      ...[...new Set(ordered.map(i => i.team))]
         .filter((t): t is string => !!t && !teams.includes(t))
         .sort((a, b) => a.localeCompare(b)),
   ];
   const body = lanes ? (
      [...laneTitles, null].map(team => {
         const inLane = (t: string | null | undefined) => (t ?? null) === team;
         const planned = ordered.filter(i => inLane(i.team));
         const loose = everything ? unplanned.filter(p => inLane(p.team)) : [];
         const shownPlanned = shownPlans.filter(i => inLane(i.team));
         const shownLoose = everything ? shownUnplanned.filter(p => inLane(p.team)) : [];
         if (!shownPlanned.length && !shownLoose.length) return null;
         const developers = team ? teamMembers[team]?.length ?? 0 : 0;
         // what the team's developers have on this week, the count Decide's
         // team sentence uses too (model/teamLoad.ts)
         const load = team && developers ? teamLoad(team, ordered, items, today) : [];
         // where the team's people run out, in priority order: the row being
         // worked on this week that's one more than it has developers. Plans
         // come first by priority; projects with no plan come after them all.
         let cut = -1;
         if (developers > 0 && !narrowed && everything) {
            const counted = (id: number | null, slug: string | null) =>
               load.some(w => w.id === id && (id != null || w.slug === slug));
            const inFlight = [
               ...shownPlanned.map(i => counted(i.id, null)),
               ...shownLoose.map(p => counted(null, p.slug)),
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
              )} ${BEING_WORKED_ON} with no plan, longest-running first`
            : '';
         return (
            <TimelineLane
               key={id}
               id={id}
               label={name}
               count={counted(shownPlanned) + shownLoose.length}
               gloss={`${name}: ${of(
                  counted(shownPlanned),
                  planned.length,
                  'plan'
               )} in priority order${looseWords}.`}
               load={developers ? capacityWords(load.length, developers) : null}
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
               // "13 plans": the chart's counts above are projects this week
               label={`On the roadmap · ${n(counted(shownPlans), 'plan')}`}
               count={counted(shownPlans)}
               showCount={false}
               gloss={`${of(
                  counted(shownPlans),
                  ordered.length,
                  'plan'
               )} in priority order: what matters most is on top.`}
               load={null}
               lined={false}
            >
               {planRows(shownPlans)}
            </TimelineLane>
         )}
         {/* work with no plan in two: what Decide asks to plan, and the
             small work that ships without one, which rests folded */}
         {everything && needing.length > 0 && (
            <TimelineLane
               id="roadmap:unplanned"
               label={NEEDS_A_PLAN}
               count={needing.length}
               gloss={`${of(
                  needing.length,
                  unplanned.filter(p => asksPlan.has(p.slug)).length,
                  'project'
               )} ${BEING_WORKED_ON} with no plan and big enough that Decide asks for one, longest-running first. Press ${PLAN_IT} on a row to plan it.`}
               load={null}
               lined={false}
            >
               {inFlightRows(needing)}
            </TimelineLane>
         )}
         {everything && shipping.length > 0 && (
            <TimelineLane
               id="roadmap:ships"
               label={NO_PLAN_NEEDED}
               count={shipping.length}
               gloss={`${of(
                  shipping.length,
                  unplanned.filter(p => !asksPlan.has(p.slug)).length,
                  'project'
               )} ${BEING_WORKED_ON} with no plan, small enough to ship without one unless it stalls, longest-running first.`}
               load={null}
               lined={false}
               // open when the rows were narrowed to find something
               defaultOpen={narrowed || nav.show === 'unplanned'}
            >
               {inFlightRows(shipping)}
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
         <QuietButton onClick={showAll}>Show all plans</QuietButton>
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
                     <SubDoor label="How the timeline works" text="Highest priority first">
                        <p className="m-0">
                           Point at a row for its grip and its lead. Drag the grip, or press the up
                           and down arrow keys on it, to change its place in the order.
                        </p>
                        <p className="m-0">
                           Drag a bar to move the plan, or its right edge to change its length. With
                           a bar focused, the left and right arrow keys do the same, with Shift for
                           the length. Escape cancels a drag, and Undo takes a move back.
                        </p>
                        <p className="m-0">
                           Click a bar or a name to open its plan under it: Decide’s questions, its
                           latest update, who leads it, and Edit details for the rest. An amber
                           question on a row is a decision Decide asks for about that plan; point at
                           it for why.
                        </p>
                        <p className="m-0">
                           The bars count the plans and projects {BEING_WORKED_ON} each week, from
                           their PRs. Click a week to see only what was {BEING_WORKED_ON} then.
                        </p>
                        <p className="m-0">
                           Grouped by team, a lane counts what its developers have on this week:{' '}
                           {TEAM_LOAD_RULE}. A dashed line marks where they run out, in priority
                           order.
                        </p>
                        <p className="m-0">
                           To plan a project with no plan, click its plus and pick an end, or drag
                           across its weeks.
                        </p>
                     </SubDoor>
                  ) : (
                     <SubDoor
                        label="How now, next and later works"
                        text="Each column is in priority order; click a plan to open it on the timeline"
                     >
                        <p className="m-0">
                           Now holds the plans marked {STATUS_WORD.active}, and plans whose start
                           week has come. Next starts within {NEXT_WEEKS} weeks, and Later after
                           that.
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
               {/* the rest of the line on a phone, beside Add, with what
                   narrows the rows after it, as on the project list */}
               <input
                  type="search"
                  aria-label="Find a project, lead or team"
                  // "/" comes here, not to the board's PR search (hooks.ts)
                  aria-keyshortcuts="/"
                  placeholder="Find a project, lead or team"
                  value={nav.find}
                  onChange={e => navigate({ find: e.target.value })}
                  className={`min-w-48 flex-1 px-2.5 sm:w-52 sm:min-w-0 sm:flex-none ${textInputClass}`}
               />
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
               <QuietButton
                  size="md"
                  id="roadmap-add"
                  onClick={() => setAdding(a => !a)}
                  aria-expanded={adding}
                  aria-label="Add to the roadmap"
                  // until the roadmap loads, a new plan would land in a list of one
                  disabled={!loaded}
               >
                  <Icon icon={Plus} size={14} className="mr-1.5" />
                  {/* its short word on a phone, so it fits beside the find box */}
                  <span className="sm:hidden">Add</span>
                  <span className="hidden sm:inline">Add to the roadmap</span>
               </QuietButton>
            </div>
            {problem && (
               <div
                  role="status"
                  className="mb-2 flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-[13px]"
               >
                  <span className="text-ink-2">{problem}</span>
                  <span className="flex-1" />
                  <QuietButton onClick={dismissRoadmapProblem}>Dismiss</QuietButton>
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
                  ahead={nextWeeks}
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
                     Nothing on the roadmap yet, and no projects {BEING_WORKED_ON}. Click Add to the
                     roadmap to start a plan.
                  </div>
               ) : (
                  <div>{body}</div>
               )}
               {narrowed &&
                  !shownPlans.length &&
                  !(everything && shownUnplanned.length) &&
                  nothingMatches(`on the roadmap or ${BEING_WORKED_ON}`)}
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
                     calls={planCalls}
                     unplanned={unplanned.length}
                     onOpen={id => openFromReceipt(id)}
                     onPerson={person}
                     onTimeline={() =>
                        navigate({ scale: 'quarter', zoom: null, show: 'unplanned' })
                     }
                  />
               )}
            </>
         )}
      </section>
   );
}
