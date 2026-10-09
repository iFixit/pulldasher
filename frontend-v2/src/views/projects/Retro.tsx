import {
   useEffect,
   useLayoutEffect,
   useRef,
   useState,
   type KeyboardEvent,
   type MouseEvent,
   type ReactNode,
} from 'react';
import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react';
import { n, pullKey, shortRepo } from '../../../../shared/format';
import { MISC_SLUG } from '../../../../shared/model/projects';
import { ORIGIN_WORD, planFor, type RoadmapItem } from '../../../../shared/model/roadmap';
import type { DerivedPull } from '../../../../shared/model/status';
import type { PullData } from '../../../../shared/types';
import { FactLink, LoadFailed, QuietButton, Segmented } from '../../components/bits';
import { ClosedRow } from '../../components/ClosedRow';
import { Icon } from '../../components/Icon';
import { eyebrowText, GroupHeader, SubDoor, Truncated, useFoldState } from '../../components/Lane';
import { Row, type RowOptions } from '../../components/Row';
import { useRowKeys } from '../../components/useRowKeys';
import type { PortfolioItem } from '../../model/portfolio';
import {
   chartWindow,
   dayOf,
   dayWords,
   previousRange,
   rangeDays,
   rangeWords,
   type Range,
} from '../../model/projectData';
import {
   beforeWords,
   chartWeeks,
   finishedIn,
   finishedOn,
   groupRows,
   lastWeek,
   loadByPerson,
   median,
   projectLength,
   quietWeeks,
   RETRO_PLAN_RANK,
   retroCsv,
   retroPlan,
   retroRows,
   spreadByPerson,
   weekBars,
   weeklyBy,
   weekTitle,
   weekWords,
   type ChartWeek,
   type PersonLoad,
   type RetroGroup,
   type RetroRow,
   type WeekBars,
} from '../../model/retro';
import { retryRetroData, useRetroData, type RetroPr } from '../../model/retroData';
import {
   COPY_AS_TEXT,
   days as daysOf,
   daysShort,
   devDays,
   NO_PLAN,
   NOT_IN_A_PROJECT,
   NOT_SAID,
   ONE_OFFS,
} from '../../model/words';
import { createMemoryStore } from '../../storage';
import { usePulldasher } from '../../store';
import { PersonCell, StatsCard } from '../stats/parts';
import { BacklogSection } from './BacklogSection';
import { ChartSlot, StripsChart } from './lazyCharts';
import {
   NarrowChip,
   openPlan,
   PeopleStack,
   readSort,
   switchView,
   Tile,
   deltaWords,
   versus,
   type Navigate,
   type ProjectsNav,
} from './parts';

type Split = ProjectsNav['by'];

const SPLIT_OPTIONS: [Split, string][] = [
   ['team', 'Team'],
   ['origin', 'Where it came from'],
   ['author', 'Whose PR'],
   ['repo', 'Repo'],
];
/** what the last list splits the days by, in words */
const SPLIT_WORDS: Record<Split, string> = {
   team: 'By the team of whoever spent them',
   origin: 'By where the work came from',
   author: 'By whose PR it was',
   repo: 'By repo',
};
const KIND_OPTIONS: [ProjectsNav['kind'], string][] = [
   ['all', 'All days'],
   ['writing', 'Writing'],
   ['reviewing', 'Reviewing'],
];

// the origin split's groups beyond a plan's own word
const NOT_FILED = 'not-filed';
const UNPLANNED = 'no-plan';
const UNSAID = 'unsaid';
/** the team key for people on no developer team, as the URL spells it */
const NO_TEAM = '(none)';

const AUTHOR_WORDS: Record<string, string> = {
   own: 'Their own PRs',
   developer: 'Other developers’ PRs',
   other: 'Non-developers’ PRs',
   bot: 'Bots’ PRs',
};

/**
 * The splits whose groups make up a tile's number, banded under the tile's
 * word with the band's share, so the tile's click lands on the number it
 * showed ("Reviewing 55%"), not on its parts.
 */
const BANDS: Partial<Record<Split, { names: string[]; of: (key: string) => string }>> = {
   author: {
      names: ['Writing', 'Reviewing'],
      of: key => (key === 'own' ? 'Writing' : 'Reviewing'),
   },
   origin: {
      names: ['On the roadmap', 'Not on the roadmap'],
      of: key => (key === NOT_FILED || key === UNPLANNED ? 'Not on the roadmap' : 'On the roadmap'),
   },
};

/** the long-list rule: this many rows, then "+ N more" */
const LIST_CAP = 40;

/** "2.5 days", in a sentence */
const dayCount = (d: number) => daysOf(devDays(d));
const pct = (part: number, whole: number) => `${whole ? Math.round((100 * part) / whole) : 0}%`;
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** a zero in a table cell: blank, as on People, and still 0 to a screen reader */
const ZERO = <span className="sr-only">0</span>;

const SECTION = 'scroll-mt-[var(--header-h,0px)]';
/** a column head's opaque tint and its bottom line: a border would stay
 * behind when the head sticks, since a collapsed border doesn't move with it */
const HEAD =
   'bg-[color-mix(in_oklab,var(--muted)_40%,var(--surface))] shadow-[inset_0_-1px_0_var(--border)]';

// the rows opened in place, by "person:", "project:" or "split:" and key,
// kept while the tab is open, so a trip to a project's page or to People and
// back finds them as they were
const openRows = createMemoryStore<{ keys: readonly string[] }>({ keys: [] });

/**
 * Bring a section into view and put focus on its heading, so a tile's jump
 * moves a keyboard or a screen reader there too, not only the page. Run
 * after the click's own change has drawn.
 */
function jumpTo(id: string) {
   requestAnimationFrame(() => {
      const section = document.getElementById(id);
      if (!section) return;
      section.scrollIntoView({ block: 'start' });
      const heading = section.querySelector<HTMLElement>('h2, h3');
      if (heading) {
         heading.tabIndex = -1;
         heading.focus({ preventScroll: true });
      }
   });
}

/** Bring a table row into view with focus on its arrow. */
function jumpToRow(buttonId: string) {
   requestAnimationFrame(() => {
      const button = document.getElementById(buttonId);
      button?.closest('tr')?.scrollIntoView({ block: 'center' });
      button?.focus({ preventScroll: true });
   });
}

/** The numbers the tiles show, for the range and the one before it. */
function measure(rows: readonly RetroRow[], plans: readonly RoadmapItem[]) {
   let total = 0;
   let writing = 0;
   let planned = 0;
   let fires = 0;
   let unfiled = 0;
   for (const row of rows) {
      total += row.days;
      if (row.own) writing += row.days;
      const project = row.pr.project;
      if (!project) {
         unfiled += row.days;
         continue;
      }
      const plan = project === MISC_SLUG ? null : planFor(project, plans);
      if (plan && plan.status !== 'dropped') {
         planned += row.days;
         if (plan.origin === 'fire') fires += row.days;
      }
   }
   const spread = Math.round(median([...spreadByPerson(rows).values()]) * 10) / 10;
   return { total, writing, planned, fires, unfiled, spread };
}

/** A group's name in the last list, split another way. */
function splitLabel(split: Split, key: string): string {
   if (split === 'origin') {
      if (key === NOT_FILED) return NOT_IN_A_PROJECT;
      if (key === UNPLANNED) return NO_PLAN;
      if (key === UNSAID) return NOT_SAID;
      return ORIGIN_WORD[key as keyof typeof ORIGIN_WORD] ?? key;
   }
   if (split === 'author') return AUTHOR_WORDS[key] ?? key;
   if (split === 'team') return key === NO_TEAM ? 'No team' : key;
   return shortRepo(key);
}

/** One of Look back's table columns: its sort key (null for one that
 * doesn't sort), its head, the sentence that says what it counts, and its
 * width and the screens it shows on. */
interface Column<K extends string> {
   key: K | null;
   label: string;
   title: string;
   width: string;
   hide?: string;
}

type Sort<K extends string> = { key: K; reversed: boolean };

/** Blanks sink whichever way a column sorts. */
function nullsLast(a: number | null, b: number | null, dir: number): number {
   if (a == null) return b == null ? 0 : 1;
   if (b == null) return -1;
   return dir * (b - a);
}

/**
 * A column head; one that sorts holds the button that sorts by it, and a
 * second click reverses it. The head cell carries aria-sort, so a screen
 * reader hears how the table is sorted. Names sort A to Z first; every
 * number, most first.
 */
function Th<K extends string>({
   col,
   sort,
   onSort,
   first = false,
   last = false,
}: {
   col: Column<K>;
   sort?: Sort<K>;
   onSort?: (param: string) => void;
   /** the name column's head, over the names after each row's arrow */
   first?: boolean;
   last?: boolean;
}) {
   const key = col.key;
   const active = !!sort && key != null && sort.key === key;
   const ascending = key === 'name' ? !sort?.reversed : !!sort?.reversed;
   return (
      <th
         scope="col"
         aria-sort={active ? (ascending ? 'ascending' : 'descending') : undefined}
         title={key != null && onSort ? undefined : col.title}
         className={`py-[7px] align-bottom font-semibold text-ink-3 ${eyebrowText} ${HEAD} ${
            col.width
         } ${col.hide ?? ''} ${first ? 'pl-[34px] text-left' : 'pl-1.5 text-right'} ${
            last ? 'pr-3.5' : 'pr-1.5'
         }`}
      >
         {key != null && sort && onSort ? (
            <button
               type="button"
               title={col.title}
               onClick={() => onSort(active && !sort.reversed ? `-${key}` : key)}
               className={`pressable inline-flex items-center gap-1 rounded border-0 bg-transparent p-0 ${eyebrowText} ${
                  active ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
               }`}
            >
               {col.label}
               {active && <Icon icon={sort.reversed ? ArrowUp : ArrowDown} size={12} />}
            </button>
         ) : (
            col.label
         )}
      </th>
   );
}

/** What each column counts, where a touch or a screen reader finds it too,
 * not only in a head's hover. */
function ColumnWords({ cols }: { cols: Column<string>[] }) {
   return (
      <div className="flex flex-col gap-0.5">
         {cols.map(c => (
            <p key={c.label} className="m-0">
               <span className="font-semibold">{c.label}</span>: {c.title}
            </p>
         ))}
      </div>
   );
}

/** A number cell under its column's head: ink for the column that counts
 * the range's days, the paler ink for the rest. */
function Td({
   col,
   strong = false,
   last = false,
   children,
}: {
   col: Column<string>;
   strong?: boolean;
   last?: boolean;
   children: ReactNode;
}) {
   return (
      <td
         className={`py-2 pl-1.5 text-right whitespace-nowrap tabular-nums ${
            last ? 'pr-3.5' : 'pr-1.5'
         } ${strong ? 'text-ink' : ''} ${col.width} ${col.hide ?? ''}`}
      >
         {children}
      </td>
   );
}

/** the weeks column: each row's bars, shown where there's room for them */
const WEEKS_COL: Column<string> = {
   key: null,
   label: '',
   title: '',
   width: 'w-32',
   hide: 'hidden md:table-cell',
};

/** The weeks column's head: the first and last week, so the bars need no
 * axis, a week that's cut off saying how many of its days count, as the
 * chart's axis does; a screen reader hears what the column holds instead. */
function WeeksTh({ weeks }: { weeks: ChartWeek[] }) {
   const ends = weeks.length > 1 ? [weeks[0], weeks[weeks.length - 1]] : weeks;
   return (
      <th
         scope="col"
         className={`px-1.5 py-[7px] align-bottom font-semibold text-ink-3 ${eyebrowText} ${HEAD} ${WEEKS_COL.width} ${WEEKS_COL.hide}`}
      >
         <span aria-hidden className="flex justify-between">
            {ends.map((w, i) => (
               <span key={w.week} className={i ? 'text-right' : ''}>
                  {weekWords(w.week)}
                  {/* part of the head, in its size, on one line so a year
                      range's two ends still fit the column */}
                  {!w.before && w.counted < 7 && (
                     <span className="block font-normal tracking-normal whitespace-nowrap normal-case">
                        {w.counted} of 7 days
                     </span>
                  )}
               </span>
            ))}
         </span>
         <span className="sr-only">By week</span>
      </th>
   );
}

/** A week's days in words: "Week of Aug 31, 5 of 7 days in the range: 3
 * days, and 1 day before the range". */
function weekNote(w: ChartWeek, counted: number, before: number): string {
   if (w.before) return `${weekTitle(w)}: ${dayCount(before)}`;
   return `${weekTitle(w)}: ${dayCount(counted)}${
      before > 0 ? `, and ${dayCount(before)} before the range` : ''
   }`;
}

/** Each week's days as a bar, on the scale `top`, the oldest week first:
 * the range's own days in full, its days before the range paler on top of
 * them. A screen reader hears the weeks that had any. */
function WeeksTd({
   bars,
   weeks,
   top,
}: {
   bars: WeekBars | undefined;
   weeks: ChartWeek[];
   top: number;
}) {
   const at = (i: number) => [bars?.counted[i] ?? 0, bars?.before[i] ?? 0];
   const said = weeks.flatMap((w, i) => {
      const [c, b] = at(i);
      return c + b > 0 ? [weekNote(w, c, b)] : [];
   });
   const height = (d: number) => `${Math.max(d > 0 ? 8 : 0, (d / top) * 100)}%`;
   return (
      <td className={`px-1.5 py-2 ${WEEKS_COL.width} ${WEEKS_COL.hide}`}>
         <span aria-hidden className="flex h-5 items-end gap-px">
            {weeks.map((w, i) => {
               const [c, b] = at(i);
               return (
                  <span
                     key={w.week}
                     className="flex h-full min-w-0 flex-1 flex-col justify-end"
                     title={c + b > 0 ? weekNote(w, c, b) : undefined}
                  >
                     {b > 0 && (
                        <span
                           className="rounded-t-[1px] bg-ink-3 opacity-35"
                           style={{ height: height(b) }}
                        />
                     )}
                     {c > 0 && (
                        <span
                           className={`bg-ink-3 ${b > 0 ? '' : 'rounded-t-[1px]'}`}
                           style={{ height: height(c) }}
                        />
                     )}
                  </span>
               );
            })}
         </span>
         <span className="sr-only">{said.length ? `By week: ${said.join('; ')}` : 'No days'}</span>
      </td>
   );
}

/**
 * A table row that opens in place, in a body of its own with what it opens,
 * so j and k move by whole rows. Its arrow opens it, saying whether it's
 * open, and so does a click anywhere on the row that isn't a link or a
 * button. A keyboard gets one Tab stop a row, as on the Overview: the name
 * when the name goes somewhere (Enter goes there, Space opens the row here,
 * as `hint` says), else the arrow. The row's other controls leave the Tab
 * order; what it opens offers the same places. That spans the table under it.
 */
function TableRow({
   id,
   name,
   cols,
   open,
   onToggle,
   lead,
   hint,
   cells,
   detail,
}: {
   /** the arrow button's id, for a jump to the row */
   id: string;
   /** what the row is, for the arrow's name */
   name: string;
   /** how many columns the table has, for the detail to span */
   cols: number;
   open: boolean;
   onToggle: () => void;
   /** the name; a button in it is the row's Tab stop */
   lead: ReactNode;
   /** the id of the words saying what Enter and Space do on a name that
    * goes somewhere */
   hint?: string;
   cells: ReactNode;
   detail: ReactNode;
}) {
   const detailId = `${id}-detail`;
   const rowRef = useRef<HTMLTableRowElement>(null);
   const arrowRef = useRef<HTMLButtonElement>(null);
   // by hand, since the faces and the name are other components' buttons;
   // after every render, so a control that redraws stays out of the order
   useEffect(() => {
      const row = rowRef.current;
      const stop =
         row?.querySelector<HTMLElement>('[data-retro-lead] button, [data-retro-lead] a') ??
         arrowRef.current;
      if (!row || !stop) return;
      for (const el of row.querySelectorAll<HTMLElement>('button, a')) {
         el.tabIndex = el === stop ? 0 : -1;
         el.toggleAttribute('data-retro-focus', el === stop);
      }
      if (hint && stop !== arrowRef.current) stop.setAttribute('aria-describedby', hint);
   });
   return (
      // a row j or k lands on stops under the sticky title and column names
      <tbody
         data-retro-row
         className="scroll-mt-[calc(var(--header-h,0px)_+_var(--head-h,0px)_+_3rem)]"
      >
         <tr
            ref={rowRef}
            className="cursor-pointer border-t border-secondary text-ink-2 hover:bg-muted/40"
            onClick={(e: MouseEvent) => {
               if (!(e.target as HTMLElement).closest('a, button')) onToggle();
            }}
            onKeyDown={(e: KeyboardEvent) => {
               // Space on a name that goes somewhere opens the row here;
               // Enter, like a click, goes where the name goes
               const on = e.target as HTMLElement;
               if (e.key !== ' ' || on === arrowRef.current || !on.hasAttribute('data-retro-focus'))
                  return;
               e.preventDefault();
               onToggle();
            }}
         >
            <th scope="row" className="py-2 pr-1.5 pl-3 text-left font-normal">
               <span className="flex min-w-0 items-center gap-1.5">
                  <button
                     ref={arrowRef}
                     type="button"
                     id={id}
                     aria-expanded={open}
                     aria-controls={open ? detailId : undefined}
                     aria-label={`Details for ${name}`}
                     onClick={onToggle}
                     // a 16px box, which .hit widens to the 24px target floor
                     className="hit pressable inline-flex h-4 w-4 flex-none items-center justify-center rounded border-0 bg-transparent p-0 text-ink-3 hover:text-brand"
                  >
                     <Icon
                        icon={ChevronRight}
                        size={12}
                        className={`transition-[rotate] duration-150 ease-out motion-reduce:transition-none ${
                           open ? 'rotate-90' : ''
                        }`}
                     />
                  </button>
                  <span data-retro-lead className="min-w-0">
                     {lead}
                  </span>
               </span>
            </th>
            {cells}
         </tr>
         {open && (
            <tr id={detailId}>
               <td colSpan={cols} className="border-t border-secondary bg-muted/30 p-0">
                  {detail}
               </td>
            </tr>
         )}
      </tbody>
   );
}

/** The long-list rule in a table: "+ N more" under the rows that show, and
 * "Show fewer" once they all do. (Lane's Truncated draws its buttons between
 * the rows, where a table can't hold them.) */
function MoreRow({
   cols,
   more,
   all,
   onToggle,
   label,
}: {
   cols: number;
   more: number;
   all: boolean;
   onToggle: () => void;
   label: string;
}) {
   if (!more) return null;
   return (
      <tbody>
         <tr>
            <td colSpan={cols} className="border-t border-secondary p-0">
               <button
                  type="button"
                  onClick={onToggle}
                  // j and k open it on the way past, like Truncated's
                  data-row-more={all ? undefined : true}
                  className="pressable block w-full border-0 bg-muted/50 px-3.5 py-[9px] text-left text-xs font-medium text-ink-2 hover:text-brand"
               >
                  {all ? 'Show fewer' : `+ ${more} ${label}`}
               </button>
            </td>
         </tr>
      </tbody>
   );
}

/** A band of a table's rows under one word, a team or the tile word a
 * split's groups make up: the Fold's look and its remembered open state, as
 * a header row of its own, since a <details> can't hold rows. */
function Band({
   id,
   label,
   note,
   cols,
   children,
}: {
   /** where its open state is remembered */
   id: string;
   label: string;
   /** after the "·": how many rows, or the band's share */
   note: string;
   cols: number;
   children: ReactNode;
}) {
   const [open, setOpen] = useFoldState(id, true);
   return (
      <>
         <tbody>
            <tr>
               {/* inset by the ring's width, so the card's edge can't clip it */}
               <th
                  colSpan={cols}
                  className="border-t border-secondary bg-muted/40 p-0.5 text-left font-normal"
               >
                  <button
                     type="button"
                     aria-expanded={open}
                     onClick={() => setOpen(!open)}
                     className={`flex w-full items-center gap-2 rounded border-0 bg-transparent px-3 py-1 text-left text-ink-3 transition-[background-color] duration-150 ease-out hover:bg-muted motion-reduce:transition-none ${eyebrowText}`}
                  >
                     <Icon
                        icon={ChevronRight}
                        size={12}
                        className={`flex-none transition-[rotate] duration-150 ease-out motion-reduce:transition-none ${
                           open ? 'rotate-90' : ''
                        }`}
                     />
                     <span>
                        {label}
                        <span className="tabular-nums"> · {note}</span>
                     </span>
                  </button>
               </th>
            </tr>
         </tbody>
         {open && children}
      </>
   );
}

/**
 * A section holding one of Look back's tables. Its column names stay in
 * view: the head sticks under the section's own sticky title, whose height
 * (it wraps on a phone) this publishes as --head-h, the way the app header
 * publishes --header-h.
 */
function TableSection({
   id,
   header,
   caption,
   head,
   hint,
   children,
}: {
   id: string;
   /** the section's GroupHeader */
   header: ReactNode;
   caption: string;
   /** the head's one row */
   head: ReactNode;
   /** what Enter and Space do on a row's name, for a screen reader; its
    * rows point to it as `${id}-hint` */
   hint?: string;
   children: ReactNode;
}) {
   const ref = useRef<HTMLElement>(null);
   useLayoutEffect(() => {
      const section = ref.current;
      const title = section?.firstElementChild;
      if (!section || !title) return;
      const publish = () =>
         section.style.setProperty('--head-h', `${title.getBoundingClientRect().height}px`);
      publish();
      const watch = new ResizeObserver(publish);
      watch.observe(title);
      return () => watch.disconnect();
   }, []);
   return (
      <section id={id} ref={ref} className={SECTION}>
         {header}
         {hint && (
            <span id={`${id}-hint`} className="sr-only">
               {hint}
            </span>
         )}
         {/* clipped, not hidden: an overflow that hides would keep the head
             from sticking to the page */}
         <div className="overflow-clip rounded-2xl border border-line bg-surface">
            <table className="w-full border-collapse text-xs">
               <caption className="sr-only">{caption}</caption>
               <thead className="sticky top-[calc(var(--header-h,0px)_+_var(--head-h,0px))] z-[4]">
                  {head}
               </thead>
               {children}
            </table>
         </div>
      </section>
   );
}

/** Where a PR's board row comes from. */
interface PullSource {
   /** its live row, while the board holds it open */
   live: (pr: RetroPr) => DerivedPull | undefined;
   /** its closed row: the board's own for the last 14 days, else one made
    * from what Look back knows of it */
   closed: (pr: RetroPr) => PullData | undefined;
   opts: RowOptions;
}

/**
 * A closed PR the board no longer holds, as the closed row draws it: Look
 * back knows its title, its author and when it merged or closed, which is
 * all a closed row shows. A server older than the close date leaves an
 * unmerged one with only the range's last day to go by.
 */
function receipt(pr: RetroPr, rangeEnd: string): PullData {
   const iso = (at: number) => new Date(at * 1000).toISOString();
   const at = pr.closed ?? pr.merged;
   const closedAt = at != null ? iso(at) : `${rangeEnd}T23:59:59Z`;
   return {
      repo: pr.repo,
      number: pr.number,
      title: pr.title,
      body: '',
      state: 'closed',
      user: { login: pr.owner },
      merged_at: pr.merged != null ? iso(pr.merged) : null,
      closed_at: closedAt,
      updated_at: closedAt,
   } as PullData;
}

/**
 * PRs as the board draws them everywhere else, most days first, each with
 * its days under it, flush in the opened row rather than boxed inside the
 * table's own card. A PR still open that the board doesn't hold (only
 * while the two disagree for a moment) has nothing to draw it from, so it
 * waits; its days still count in every number.
 */
function PrList({
   prs,
   source,
   note,
}: {
   prs: [RetroPr, number][];
   source: PullSource;
   /** the line under a PR: its days, and anything else this list knows */
   note: (pr: RetroPr, days: number) => string;
}) {
   const shown = prs.flatMap(([pr, d]) => {
      const live = source.live(pr);
      const closed = live ? undefined : source.closed(pr);
      return live || closed ? [{ pr, d, live, closed }] : [];
   });
   if (!shown.length) return null;
   return (
      <div className="border-y border-secondary">
         <Truncated cap={8} label="more PRs">
            {shown.map(({ pr, d, live, closed }) => (
               // the divider rides on this wrapper, so a note stays with its row
               <div key={pullKey(pr)} className="border-t border-secondary first:border-t-0">
                  {live ? (
                     <Row pull={live} opts={source.opts} />
                  ) : (
                     closed && <ClosedRow pull={closed} lastSeen={source.opts.lastSeen} />
                  )}
                  <p className="m-0 pr-3.5 pb-1.5 pl-[45px] text-xs text-ink-3 tabular-nums">
                     {note(pr, d)}
                  </p>
               </div>
            ))}
         </Truncated>
      </div>
   );
}

/** Where a group's days went: every PR, most days first, and everyone who
 * spent them, then anything more the row offers. */
function SpentOn({
   group,
   source,
   me,
   onPerson,
   actions,
}: {
   group: RetroGroup;
   source: PullSource;
   me: string;
   onPerson: (login: string) => void;
   /** what else the opened row offers: counting only a team's days, a
    * split's plans on the roadmap */
   actions?: ReactNode;
}) {
   return (
      <div className="grid gap-4 px-3.5 py-3 text-xs sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
         <div className="min-w-0">
            <h4 className="m-0 mb-1.5 text-xs font-semibold text-ink-2">
               The PRs, most days first
            </h4>
            <PrList prs={group.prs} source={source} note={(_, d) => dayCount(d)} />
         </div>
         <div className="min-w-0">
            <h4 className="m-0 mb-1.5 text-xs font-semibold text-ink-2">Who spent them</h4>
            {group.people.map(([login, d]) => (
               <div key={login} className="flex items-center justify-between gap-3 py-0.5">
                  <PersonCell
                     login={login}
                     me={me}
                     onClick={() => onPerson(login)}
                     action="open on People"
                     size={16}
                  />
                  <span className="flex-none text-ink-3 tabular-nums">{dayCount(d)}</span>
               </div>
            ))}
            {actions && <div className="mt-3 flex flex-col items-start gap-2">{actions}</div>}
         </div>
      </div>
   );
}

/** A person's range opened in place: every project they worked on, what
 * they did there, then the PRs they worked on, most days first. */
function PersonDetail({
   load,
   group,
   source,
   nameOf,
   navigate,
   narrowedToThem,
}: {
   load: PersonLoad;
   group: RetroGroup | undefined;
   source: PullSource;
   nameOf: (slug: string) => string;
   navigate: Navigate;
   narrowedToThem: boolean;
}) {
   if (!load.days) {
      return <p className="m-0 px-3.5 py-3 text-xs text-ink-3">No PR activity in these days.</p>;
   }
   const filed = load.projects.reduce((sum, p) => sum + p.days, 0);
   const rest = [
      load.days - filed - load.unfiled >= 0.05
         ? `${dayCount(load.days - filed - load.unfiled)} on ${lower(ONE_OFFS)}`
         : null,
      load.unfiled >= 0.05 ? `${dayCount(load.unfiled)} not in a project` : null,
   ].filter(Boolean);
   const writing = (pr: RetroPr) => pr.owner.toLowerCase() === load.login.toLowerCase();
   return (
      <div className="grid gap-4 px-3.5 py-3 text-xs sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
         <div className="min-w-0">
            <h4 className="m-0 mb-1.5 text-xs font-semibold text-ink-2">Their projects</h4>
            {load.projects.map(p => (
               <div key={p.slug} className="flex items-baseline justify-between gap-3 py-0.5">
                  <FactLink
                     onClick={() => navigate({ project: p.slug })}
                     className="min-w-0 break-words"
                     title={`Open the ${nameOf(p.slug)} page`}
                  >
                     {nameOf(p.slug)}
                  </FactLink>
                  <span className="flex-none text-ink-3 tabular-nums">
                     {p.writing <= 0
                        ? 'reviewed'
                        : p.writing >= p.days - 0.005
                        ? 'wrote'
                        : 'wrote and reviewed'}
                     , {dayCount(p.days)}
                  </span>
               </div>
            ))}
            {!load.projects.length && <p className="m-0 text-ink-3">None in a project.</p>}
            {rest.length > 0 && <p className="m-0 mt-1.5 text-ink-3">Also {rest.join(' and ')}.</p>}
            {!narrowedToThem && (
               <div className="mt-3">
                  <QuietButton onClick={() => navigate({ who: load.login, team: null })}>
                     Count only {load.login}’s days on this page
                  </QuietButton>
               </div>
            )}
         </div>
         <div className="min-w-0">
            <h4 className="m-0 mb-1.5 text-xs font-semibold text-ink-2">
               The PRs they worked on, most days first
            </h4>
            <PrList
               prs={group?.prs ?? []}
               source={source}
               note={(pr, d) => `${dayCount(d)}, ${writing(pr) ? 'writing' : 'reviewing'}`}
            />
         </div>
      </div>
   );
}

type PersonKey =
   | 'name'
   | 'days'
   | 'reviewing'
   | 'wrote'
   | 'reviewed'
   | 'spread'
   | 'unfiled'
   | 'before';
const PERSON_KEYS: PersonKey[] = [
   'name',
   'days',
   'reviewing',
   'wrote',
   'reviewed',
   'spread',
   'unfiled',
   'before',
];
type ProjectKey = 'name' | 'days' | 'people' | 'length' | 'quiet' | 'last' | 'plan' | 'before';
const PROJECT_KEYS: ProjectKey[] = [
   'name',
   'days',
   'people',
   'length',
   'quiet',
   'last',
   'plan',
   'before',
];

/**
 * Look back: where the time went over the picked range, for a retro. The
 * unit is a developer-day, a day someone opened, merged, commented on,
 * stamped or reviewed a PR, split across the PRs they touched that day
 * (shared/model/retro.ts), so a month-long project outweighs a one-line fix
 * the way it did in people's weeks.
 *
 * The tiles say the few numbers a retro opens with, each against the same
 * number of days before, and each opens the list that explains it, over
 * every day as the tiles count them. Then everyone's weeks, whose switch
 * picks which days count from there down; who worked on what by team; every
 * project's days, length, pauses and plan; the days split one more way; and
 * whether the backlog grew. Each week's days are drawn in a row on one scale
 * per table over the chart's weeks, so a row is its own label. A person's
 * name opens People and a project's its page, as everywhere in the tab; the
 * arrow opens a row in place, its PRs drawn as the board's own rows, and
 * anything else the row offers sits in what it opens.
 */
export function Retro({
   range,
   plans,
   items,
   teams,
   teamOf,
   nameOf,
   nav,
   navigate,
   onPerson,
   opts,
}: {
   range: Range;
   plans: readonly RoadmapItem[];
   /** the project list for the range: each project's issue, plan and numbers */
   items: readonly PortfolioItem[];
   /** developer teams: team name to logins */
   teams: Record<string, string[]>;
   teamOf: (login: string) => string | null;
   nameOf: (slug: string) => string;
   nav: ProjectsNav;
   navigate: Navigate;
   /** to a person's row on People */
   onPerson: (login: string) => void;
   /** the tab's options for the board rows the PRs are drawn as; the rows
    * fall back to the board's own basics without them */
   opts?: RowOptions;
}) {
   const data = useRetroData(range);
   const before = useRetroData(previousRange(range));
   // the charts and each row's bars draw at least 90 days, the range's last
   // day at the end, so a short range still shows its trend
   const shown = chartWindow(range);
   const drawn = useRetroData(shown);
   const board = usePulldasher();
   const { keys: openKeys } = openRows.useValue();
   const [copied, setCopied] = useState<'copied' | 'failed' | null>(null);
   const [allProjects, setAllProjects] = useState(false);
   const [allSplit, setAllSplit] = useState(false);
   // j and k move through every table's rows, top to bottom
   useRowKeys('[data-retro-row]', '[data-retro-focus]');
   if (data === undefined) {
      return <p className="m-0 text-[13px] text-ink-3">Adding up the days…</p>;
   }
   if (data === null) return <LoadFailed what="the days" onRetry={retryRetroData} />;
   const open = new Set(openKeys);
   const toggle = (key: string) => {
      const keys = openRows.get().keys;
      openRows.set({ keys: keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key] });
   };
   const live = new Map(board.pulls.map(p => [pullKey(p.data), p]));
   const gone = new Map(board.closed.map(p => [pullKey(p), p]));
   const source: PullSource = {
      live: pr => live.get(pullKey(pr)),
      closed: pr =>
         gone.get(pullKey(pr)) ?? (pr.state === 'closed' ? receipt(pr, range.end) : undefined),
      opts: opts ?? { me: board.me, lastSeen: board.lastSeen, onPerson, noHide: true },
   };

   // a team or a person picked here narrows everything to their days
   const inScope = (r: RetroRow) =>
      (!nav.team || (teamOf(r.login) ?? NO_TEAM) === nav.team) && (!nav.who || r.login === nav.who);
   const inKind = (r: RetroRow) => nav.kind === 'all' || (nav.kind === 'writing') === r.own;
   const scoped = retroRows(data).filter(inScope);
   const rows = scoped.filter(inKind);
   const earlierScoped = before ? retroRows(before).filter(inScope) : null;
   const earlier = earlierScoped?.filter(inKind) ?? null;
   // the tiles count every day, whichever kind the lists below count
   const now = measure(scoped, plans);
   const then = earlierScoped && measure(earlierScoped, plans);
   const period = beforeWords(rangeDays(range));
   // a tile's comparison is a short mark ("was 6%"); the sentence is its title's
   const wasFull = (part: (m: ReturnType<typeof measure>) => number) =>
      !then
         ? null
         : then.total
         ? `${pct(part(then), then.total)} in the ${period}`
         : `no days in the ${period}`;
   const was = (part: (m: ReturnType<typeof measure>) => number) =>
      !then ? null : then.total ? `was ${pct(part(then), then.total)}` : 'no days before';
   const andWas = (title: string, full: string | null) =>
      full ? `${title} Before: ${full}.` : title;
   const total = rows.reduce((sum, r) => sum + r.days, 0);
   const earlierTotal = earlier?.reduce((sum, r) => sum + r.days, 0) ?? 0;
   const today = dayOf(new Date());
   const bySlug = new Map(items.map(i => [i.slug, i]));
   const narrowed =
      nav.who ?? (nav.team ? (nav.team === NO_TEAM ? 'people on no team' : nav.team) : null);
   const kindWords = nav.kind === 'all' ? '' : nav.kind === 'writing' ? ', writing' : ', reviewing';
   // on each list's sub-line while the switch narrows the days
   const kindOnly = nav.kind === 'all' ? '' : `, ${nav.kind} days only`;
   // the sort arrow says the order; the sub-line says only what the switch narrowed
   const readThis = kindOnly ? upper(kindOnly.slice(2)) : 'How to read this';
   const issues = items.flatMap(i => (i.project ? [i.project] : []));
   const allFinished = finishedIn(plans, issues, range);
   const allFinishedBefore = finishedIn(plans, issues, previousRange(range));
   // narrowed, the plans done are the ones they worked on
   const finished = narrowed ? finishedOn(allFinished, scoped) : allFinished;
   const finishedBefore = narrowed
      ? earlierScoped && finishedOn(allFinishedBefore, earlierScoped)
      : allFinishedBefore;
   const onTime = finished.filter(f => f.onTime === true).length;
   const late = finished.filter(f => f.onTime === false).length;
   const unjudged = finished.length - onTime - late;
   const plansNote = finished.length
      ? `${onTime} on time, ${late} late${unjudged ? `, ${unjudged} with no plan` : ''}`
      : null;
   const anyOrigin = plans.some(p => p.origin != null);
   const byDays = (list: RetroGroup[] | null) =>
      list ? new Map(list.map(g => [g.key, g.days])) : null;

   // every week of the chart's days. A row's bars draw the range's own days
   // in full and the chart's days before the range paler, so the week the
   // range starts in never counts days the numbers don't
   const weeks = chartWeeks(shown, range);
   const drawnRows = drawn ? retroRows(drawn).filter(inScope).filter(inKind) : null;
   const zeros = weeks.map(() => 0);
   const noBars: WeekBars = { counted: zeros, before: zeros };
   const barsBy = (keyOf: (r: RetroRow) => string) => {
      const bars = new Map<string, WeekBars>();
      // until the chart's days load the bars wait, so none jumps when they do
      if (!drawn || !drawnRows) return { bars, top: 1 };
      const inRange = weeklyBy(rows, keyOf, data, weeks);
      const whole = weeklyBy(drawnRows, keyOf, drawn, weeks);
      for (const key of new Set([...inRange.keys(), ...whole.keys()])) {
         bars.set(key, weekBars(whole.get(key), inRange.get(key) ?? zeros, weeks));
      }
      const top = Math.max(
         0.01,
         ...[...bars.values()].flatMap(b => b.counted.map((c, i) => c + b.before[i]))
      );
      return { bars, top };
   };
   const byKind = barsBy(r => (r.own ? 'writing' : 'reviewing'));
   const strips = [
      ...(nav.kind !== 'reviewing'
         ? [{ name: 'Writing', bars: byKind.bars.get('writing') ?? noBars }]
         : []),
      ...(nav.kind !== 'writing'
         ? [{ name: 'Reviewing', bars: byKind.bars.get('reviewing') ?? noBars }]
         : []),
   ];
   // the range's own weeks, for its pauses and its last week worked
   const rangeWeeks = chartWeeks(range, range);

   // who worked on what: every developer in scope, spelled the way their
   // PRs spell them, and anyone else with days in it
   const spelled = new Map(data.people.map(l => [l.toLowerCase(), l]));
   const members = nav.team
      ? nav.team === NO_TEAM
         ? []
         : teams[nav.team] ?? []
      : Object.values(teams).flat();
   const listed = nav.who
      ? [nav.who]
      : [
           ...new Map(
              [
                 ...members.map(l => spelled.get(l.toLowerCase()) ?? l),
                 ...rows.map(r => r.login),
              ].map(l => [l.toLowerCase(), l])
           ).values(),
        ];
   const personGroups = new Map(groupRows(rows, r => r.login).map(g => [g.key, g]));
   const personBefore = earlier ? byDays(groupRows(earlier, r => r.login)) : null;
   const personBars = barsBy(r => r.login);
   const spread = spreadByPerson(rows);
   const psort = readSort<PersonKey>(nav.psort, PERSON_KEYS, 'name');
   const share = (part: number, whole: number) => (whole ? part / whole : 0);
   const personValue = (l: PersonLoad, key: PersonKey): number | null =>
      key === 'days'
         ? l.days
         : key === 'reviewing'
         ? share(l.reviewing, l.days)
         : key === 'wrote'
         ? l.wrote
         : key === 'reviewed'
         ? l.reviewed
         : key === 'spread'
         ? spread.get(l.login) ?? null
         : key === 'unfiled'
         ? share(l.unfiled, l.days)
         : personBefore?.get(l.login) ?? null;
   const people = loadByPerson(rows, listed).sort((a, b) => {
      const dir = psort.reversed ? -1 : 1;
      const by =
         psort.key === 'name'
            ? dir * a.login.localeCompare(b.login)
            : nullsLast(personValue(a, psort.key), personValue(b, psort.key), dir);
      return by || a.login.localeCompare(b.login);
   });
   // by team, so a retro opens on the shape of the work, not a leaderboard:
   // the teams in their own order, then anyone on none
   const teamNames = Object.keys(teams);
   const bands: [string | null, PersonLoad[]][] = teamNames.length
      ? [...teamNames, NO_TEAM]
           .map((team): [string, PersonLoad[]] => [
              team,
              people.filter(p => (teamOf(p.login) ?? NO_TEAM) === team),
           ])
           .filter(([, list]) => list.length > 0)
      : [[null, people]];

   // every project's days in the range, with its length, pauses and plan
   const projectBefore = earlier ? byDays(groupRows(earlier, r => r.pr.project ?? '')) : null;
   const projectBars = barsBy(r => r.pr.project ?? '');
   const inRange = weeklyBy(rows, r => r.pr.project ?? '', data, rangeWeeks);
   const sort = readSort<ProjectKey>(nav.sort, PROJECT_KEYS, 'days');
   const projectRows = groupRows(rows, r => r.pr.project ?? '').map(g => {
      const item = g.key ? bySlug.get(g.key) : undefined;
      const filed = !!g.key && g.key !== MISC_SLUG;
      const planItem = filed ? item?.plan ?? planFor(g.key, plans) : null;
      const weekly = inRange.get(g.key) ?? rangeWeeks.map(() => 0);
      return {
         g,
         label: g.key ? nameOf(g.key) : NOT_IN_A_PROJECT,
         filed,
         length: filed ? projectLength(item?.window, range.end) : null,
         quiet: quietWeeks(weekly),
         last: lastWeek(weekly),
         planItem,
         plan: filed ? retroPlan(planItem, today) : null,
         before: projectBefore ? projectBefore.get(g.key) ?? 0 : null,
      };
   });
   type ProjectRow = typeof projectRows[number];
   const projectValue = (r: ProjectRow, key: ProjectKey): number | null =>
      key === 'days'
         ? r.g.days
         : key === 'people'
         ? r.g.people.length
         : key === 'length'
         ? r.length?.days ?? null
         : key === 'quiet'
         ? r.quiet
         : key === 'last'
         ? r.last
         : key === 'plan'
         ? r.plan
            ? // a retro reads what finished first
              -RETRO_PLAN_RANK[r.plan.kind]
            : null
         : r.before;
   // the days on no project sit apart, after every project, inside the cap
   // or out of it, so its tile always has a row to open
   const unfiledRow = projectRows.find(r => !r.g.key);
   const projects = projectRows
      .filter(r => r.g.key)
      .sort((a, b) => {
         const dir = sort.reversed ? -1 : 1;
         const by =
            sort.key === 'name'
               ? dir * a.label.localeCompare(b.label)
               : nullsLast(projectValue(a, sort.key), projectValue(b, sort.key), dir);
         return by || b.g.days - a.g.days || a.label.localeCompare(b.label);
      });
   const projectsShown = allProjects ? projects : projects.slice(0, LIST_CAP);
   const unfiledShare = share(unfiledRow?.g.days ?? 0, total);

   // the days split one more way
   const originOf = (r: RetroRow) => {
      const project = r.pr.project;
      if (!project) return NOT_FILED;
      // one-offs are in a project of their own, just never planned
      if (project === MISC_SLUG) return UNPLANNED;
      const plan = planFor(project, plans);
      return !plan || plan.status === 'dropped' ? UNPLANNED : plan.origin ?? UNSAID;
   };
   const keyOf: Record<Split, (r: RetroRow) => string> = {
      origin: originOf,
      author: r =>
         r.own ? 'own' : r.pr.bot ? 'bot' : teamOf(r.pr.owner) != null ? 'developer' : 'other',
      team: r => teamOf(r.login) ?? NO_TEAM,
      repo: r => r.pr.repo,
   };
   const splitGroups = groupRows(rows, keyOf[nav.by]);
   if (nav.by === 'team') {
      // the teams in their configured order, as the people are, and anyone
      // on none last
      const rank = (key: string) => {
         const at = teamNames.indexOf(key);
         return key === NO_TEAM ? teamNames.length + 1 : at < 0 ? teamNames.length : at;
      };
      splitGroups.sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
   }
   const splitBefore = earlier ? byDays(groupRows(earlier, keyOf[nav.by])) : null;
   const splitBars = barsBy(keyOf[nav.by]);
   const splitName = SPLIT_OPTIONS.find(([s]) => s === nav.by)?.[1] ?? '';
   const band = BANDS[nav.by];
   const splitShown = allSplit ? splitGroups : splitGroups.slice(0, LIST_CAP);
   /** What a split group's opened row offers beyond its PRs and people:
    * counting only that team's days here, or its plans on the roadmap. Its
    * name only opens the row, so a click on a name never leaves the view. */
   const splitAction = (key: string): ReactNode => {
      if (nav.by === 'team' && nav.team !== key) {
         return (
            <QuietButton onClick={() => navigate({ team: key, who: null })}>
               {key === NO_TEAM
                  ? 'Count only the days of people on no team'
                  : `Count only ${key}’s days on this page`}
            </QuietButton>
         );
      }
      // the roadmap filters its plans by where they came from; work with no
      // plan has none to show
      if (nav.by === 'origin' && key !== NOT_FILED && key !== UNPLANNED) {
         return (
            <FactLink
               onClick={() =>
                  navigate({ ...switchView('roadmap'), origin: key as ProjectsNav['origin'] })
               }
            >
               Show these plans on the roadmap
            </FactLink>
         );
      }
      return null;
   };

   // each week's days in the range, for the notes
   const rangeWeekly = weeklyBy(rows, () => '', data, rangeWeeks).get('') ?? [];
   const versusBefore = (prev: number | null | undefined) =>
      prev == null ? '' : `; ${dayCount(prev)} in the ${period}`;
   const shares = (m: ReturnType<typeof measure>) =>
      [
         `${pct(m.total - m.writing, m.total)} reviewing`,
         `${pct(m.planned, m.total)} on the roadmap`,
         anyOrigin ? `${pct(m.fires, m.total)} fires` : null,
         `${pct(m.unfiled, m.total)} not in a project`,
      ]
         .filter(Boolean)
         .join(', ');
   // the retro's notes, as plain text: everything the page lists, people
   // in their teams as the table has them
   const notes = () =>
      [
         `Where the time went${narrowed ? `, ${narrowed}` : ''}${kindWords}, ${rangeWords(
            range
         )}: ${n(devDays(total), 'developer-day')} from ${n(
            new Set(rows.map(r => r.login)).size,
            'person',
            'people'
         )}${earlier ? ` (${versus(Math.round(total), Math.round(earlierTotal), period)})` : ''}`,
         `${shares(now)}${then?.total ? `; in the ${period}, ${shares(then)}` : ''}`,
         `Plans done: ${finished.length}${plansNote ? ` (${plansNote})` : ''}`,
         `Week by week: ${rangeWeeks
            .map(
               (w, i) =>
                  `${dayWords(w.week)}${w.days < 7 ? ` (${w.days} of 7 days)` : ''} ${devDays(
                     rangeWeekly[i] ?? 0
                  )}`
            )
            .join(', ')}`,
         '',
         'Who worked on what:',
         ...bands
            .flatMap(([, list]) => list)
            .map(
               p =>
                  `- ${p.login}${teamOf(p.login) ? ` (${teamOf(p.login)})` : ''}: ${dayCount(
                     p.days
                  )}, ${pct(p.reviewing, p.days)} reviewing, wrote on ${n(
                     p.wrote,
                     'project'
                  )}, reviewed on ${p.reviewed}${versusBefore(
                     personBefore && (personBefore.get(p.login) ?? 0)
                  )}`
            ),
         '',
         'Projects:',
         ...[...projects, ...(unfiledRow ? [unfiledRow] : [])].map(
            r =>
               [
                  `- ${r.label}: ${dayCount(r.g.days)} (${pct(r.g.days, total)})`,
                  r.length ? `${r.length.open ? 'open' : 'took'} ${daysOf(r.length.days)}` : null,
                  r.plan ? lower(r.plan.text) : null,
               ]
                  .filter(Boolean)
                  .join(', ') + versusBefore(r.before)
         ),
         '',
         `${SPLIT_WORDS[nav.by]}:`,
         ...splitGroups.map(
            g =>
               `- ${splitLabel(nav.by, g.key)}: ${dayCount(g.days)} (${pct(
                  g.days,
                  total
               )})${versusBefore(splitBefore && (splitBefore.get(g.key) ?? 0))}`
         ),
      ].join('\n');
   const copy = () => {
      const done = (result: 'copied' | 'failed') => {
         setCopied(result);
         setTimeout(() => setCopied(null), 4000);
      };
      if (!navigator.clipboard) return done('failed');
      navigator.clipboard.writeText(notes()).then(
         () => done('copied'),
         () => done('failed')
      );
   };
   const download = () => {
      const url = URL.createObjectURL(
         new Blob([retroCsv(rows, data, teamOf, nameOf)], { type: 'text/csv' })
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `look-back-${range.start}-to-${range.end}.csv`;
      a.click();
      URL.revokeObjectURL(url);
   };

   // a tile opens the list that explains it, counting every day as the
   // tile does, so the switch below can't hide the tile's own number
   const go = (patch: Partial<ProjectsNav>, section: string) => {
      const all = nav.kind === 'all' ? patch : { ...patch, kind: 'all' as const };
      if (Object.keys(all).length) navigate(all);
      jumpTo(section);
   };
   const tiles = [
      <Tile
         key="days"
         value={Math.round(now.total)}
         label="Days of work"
         title={andWas(
            `Days people spent on PRs, ${rangeWords(
               range
            )}. A day counts once per person, split across the PRs they touched that day. Click to see who spent them.`,
            then ? versus(Math.round(now.total), Math.round(then.total), period) : null
         )}
         note={then ? deltaWords(Math.round(now.total), Math.round(then.total)) : null}
         onClick={() => go({}, 'retro-people')}
      />,
      <Tile
         key="reviewing"
         value={pct(now.total - now.writing, now.total)}
         label="Reviewing"
         title={andWas(
            'Of the days, the share on other people’s PRs. Click to split the days by whose PR it was.',
            wasFull(m => m.total - m.writing)
         )}
         note={was(m => m.total - m.writing)}
         onClick={() => go({ by: 'author' }, 'retro-split')}
      />,
      <Tile
         key="roadmap"
         value={pct(now.planned, now.total)}
         label="On the roadmap"
         title={andWas(
            'Of the days, the share on projects with a plan. Click to split the days by where the work came from.',
            wasFull(m => m.planned)
         )}
         note={was(m => m.planned)}
         onClick={() => go({ by: 'origin' }, 'retro-split')}
      />,
      anyOrigin && (
         <Tile
            key="fires"
            value={pct(now.fires, now.total)}
            label="Fires"
            title={andWas(
               'Of the days, the share on plans marked as a fire to put out. Click to split the days by where the work came from.',
               wasFull(m => m.fires)
            )}
            note={was(m => m.fires)}
            onClick={() => go({ by: 'origin' }, 'retro-split')}
         />
      ),
      <Tile
         key="unfiled"
         value={pct(now.unfiled, now.total)}
         label={NOT_IN_A_PROJECT}
         title={andWas(
            'Of the days, the share on PRs with no project label. Click for the PRs that took the most.',
            wasFull(m => m.unfiled)
         )}
         note={was(m => m.unfiled)}
         onClick={() => {
            if (nav.kind !== 'all') navigate({ kind: 'all' });
            if (!now.unfiled) return jumpTo('retro-projects');
            if (!open.has('project:')) toggle('project:');
            jumpToRow('retro-row-project:');
         }}
      />,
      <Tile
         key="spread"
         value={now.spread}
         // "per person" only while it counts more than one; "a week" is in
         // the title
         label={nav.who ? 'Projects' : 'Projects per person'}
         title={andWas(
            'The median, across people, of how many different projects each touched in a week they worked. A PR with no project counts on its own. Click to sort the people by it.',
            then ? `${then.spread} in the ${period}` : null
         )}
         note={then ? `was ${then.spread}` : null}
         onClick={() => go({ psort: 'spread' }, 'retro-people')}
      />,
      <Tile
         key="finished"
         value={finished.length}
         label="Plans done"
         title={`Plans marked done in these days, and project issues closed as completed, each judged against its plan’s end${
            narrowed ? `; only the ones ${narrowed} worked on` : ''
         }. Click to sort the projects by their plan.${
            finishedBefore
               ? ` ${upper(versus(finished.length, finishedBefore.length, period) ?? '')}.`
               : ''
         }`}
         note={
            plansNote ??
            (finishedBefore ? deltaWords(finished.length, finishedBefore.length) : null)
         }
         onClick={() => go({ sort: 'plan' }, 'retro-projects')}
      />,
   ].filter(Boolean);

   const personCols: (Column<PersonKey> & { key: PersonKey })[] = [
      { key: 'days', label: 'Days', title: 'Their days of work in the range', width: 'w-14' },
      {
         key: 'reviewing',
         label: 'Reviewing',
         title: 'The share of their days on other people’s PRs',
         width: 'w-20',
         hide: 'hidden lg:table-cell',
      },
      {
         key: 'wrote',
         label: 'Wrote on',
         title: 'Projects they wrote PRs for',
         width: 'w-16',
         hide: 'hidden lg:table-cell',
      },
      {
         key: 'reviewed',
         label: 'Reviewed on',
         title: 'Projects where they reviewed, stamped or commented on someone else’s PRs',
         width: 'w-20',
         hide: 'hidden lg:table-cell',
      },
      {
         key: 'spread',
         label: 'Projects a week',
         title: 'The median, over the weeks they worked, of how many different projects they touched that week. A PR with no project counts on its own.',
         width: 'w-24',
         hide: 'hidden xl:table-cell',
      },
      {
         key: 'unfiled',
         label: NOT_IN_A_PROJECT,
         title: 'The share of their days on PRs with no project label',
         width: 'w-28',
         hide: 'hidden xl:table-cell',
      },
      {
         key: 'before',
         label: 'Before',
         title: `Their days of work in the ${period}`,
         width: 'w-16',
         hide: 'hidden md:table-cell',
      },
   ];
   const projectCols: Column<ProjectKey>[] = [
      { key: 'days', label: 'Days', title: 'Days of work on it in the range', width: 'w-14' },
      {
         key: null,
         label: 'Share',
         title: 'Its share of all the days listed',
         width: 'w-12',
         hide: 'hidden sm:table-cell',
      },
      {
         key: 'people',
         label: 'People',
         title: 'Who wrote or reviewed PRs on it in the range. A face opens that person on People.',
         width: 'w-20',
         hide: 'hidden lg:table-cell',
      },
      {
         key: 'length',
         label: 'Length',
         title: 'From its first PR opening to its last merge or close (“took”), or, with a PR still open when the range ended, how long it had been open by then (“open”)',
         width: 'w-24',
         hide: 'hidden lg:table-cell',
      },
      {
         key: 'quiet',
         label: 'Longest pause',
         title: 'The most weeks in a row nobody worked on it, between its first and last week with any days in the range',
         width: 'w-24',
         hide: 'hidden xl:table-cell',
      },
      {
         key: 'last',
         label: 'Last worked',
         title: 'The week of its last day in the range',
         width: 'w-28',
         hide: 'hidden xl:table-cell',
      },
      {
         key: 'plan',
         label: 'Plan',
         title: 'How its plan on the roadmap turned out, as of today: done on time or late, still running past its end date, or no plan. A plan opens on the roadmap.',
         width: 'w-40',
         hide: 'hidden md:table-cell',
      },
      {
         key: 'before',
         label: 'Before',
         title: `Its days of work in the ${period}`,
         width: 'w-16',
         hide: 'hidden lg:table-cell',
      },
   ];
   const splitCols: Column<string>[] = [
      { key: null, label: 'Days', title: 'Days of work in the range', width: 'w-14' },
      {
         key: null,
         label: 'Share',
         title: 'Its share of all the days listed',
         width: 'w-12',
         hide: 'hidden sm:table-cell',
      },
      {
         key: null,
         label: 'Before',
         title: `Its days of work in the ${period}`,
         width: 'w-16',
         hide: 'hidden md:table-cell',
      },
   ];
   // every table: its name column, its bars, then its numbers
   const personSpan = personCols.length + 2;
   const projectSpan = projectCols.length + 2;
   const splitSpan = splitCols.length + 2;

   const personRow = (p: PersonLoad) => {
      const earlierDays = personBefore ? personBefore.get(p.login) ?? 0 : null;
      const spreadOf = spread.get(p.login);
      return (
         <TableRow
            key={p.login}
            id={`retro-row-person:${p.login}`}
            name={p.login}
            cols={personSpan}
            open={open.has(`person:${p.login}`)}
            onToggle={() => toggle(`person:${p.login}`)}
            hint="retro-people-hint"
            lead={
               <span className="min-w-0 text-[13px]">
                  <PersonCell
                     login={p.login}
                     me={board.me}
                     onClick={() => onPerson(p.login)}
                     action="open on People"
                  />
               </span>
            }
            cells={
               <>
                  <WeeksTd bars={personBars.bars.get(p.login)} weeks={weeks} top={personBars.top} />
                  <Td col={personCols[0]} strong>
                     {p.days ? devDays(p.days) : ZERO}
                  </Td>
                  <Td col={personCols[1]}>{p.reviewing ? pct(p.reviewing, p.days) : ZERO}</Td>
                  <Td col={personCols[2]}>{p.wrote || ZERO}</Td>
                  <Td col={personCols[3]}>{p.reviewed || ZERO}</Td>
                  <Td col={personCols[4]}>{spreadOf ? Math.round(spreadOf * 10) / 10 : ZERO}</Td>
                  <Td col={personCols[5]}>{p.unfiled ? pct(p.unfiled, p.days) : ZERO}</Td>
                  <Td col={personCols[6]} last>
                     {earlierDays == null ? '' : earlierDays ? devDays(earlierDays) : ZERO}
                  </Td>
               </>
            }
            detail={
               <PersonDetail
                  load={p}
                  group={personGroups.get(p.login)}
                  source={source}
                  nameOf={nameOf}
                  navigate={navigate}
                  narrowedToThem={nav.who === p.login}
               />
            }
         />
      );
   };

   const projectRow = (r: ProjectRow) => {
      const planId = r.planItem?.id;
      // the plan's outcome opens it on the roadmap; one still running past
      // its end is owed a call, so it wears the amber the Overview gives it
      const planWords =
         r.plan && planId != null ? (
            <FactLink
               onClick={() =>
                  navigate({ ...switchView('roadmap'), ...openPlan(nav, planId) }, { push: true })
               }
               title={`Open the plan for ${r.label} on the roadmap`}
               className="text-right"
            >
               {r.plan.kind === 'past_end' ? (
                  <span className="text-warn">{r.plan.text}</span>
               ) : (
                  r.plan.text
               )}
            </FactLink>
         ) : (
            // a fact, not a call: quieter than the outcomes a retro reads
            r.plan && <span className="text-ink-3">{r.plan.text}</span>
         );
      return (
         <TableRow
            key={r.g.key || 'not-in-a-project'}
            id={`retro-row-project:${r.g.key}`}
            name={r.label}
            cols={projectSpan}
            open={open.has(`project:${r.g.key}`)}
            onToggle={() => toggle(`project:${r.g.key}`)}
            hint="retro-projects-hint"
            lead={
               r.filed ? (
                  <FactLink
                     onClick={() => navigate({ project: r.g.key })}
                     title="Open the project page"
                     className="min-w-0 text-[13px] font-medium break-words"
                  >
                     {r.label}
                  </FactLink>
               ) : (
                  <span className="min-w-0 text-[13px] font-medium break-words text-ink">
                     {r.label}
                  </span>
               )
            }
            cells={
               <>
                  <WeeksTd
                     bars={projectBars.bars.get(r.g.key)}
                     weeks={weeks}
                     top={projectBars.top}
                  />
                  <Td col={projectCols[0]} strong>
                     {devDays(r.g.days)}
                  </Td>
                  <Td col={projectCols[1]}>{pct(r.g.days, total)}</Td>
                  <Td col={projectCols[2]}>
                     <span className="inline-flex">
                        <PeopleStack
                           logins={r.g.people.map(([login]) => login)}
                           onPerson={onPerson}
                           me={board.me}
                        />
                     </span>
                  </Td>
                  <Td col={projectCols[3]}>
                     {r.length
                        ? `${r.length.open ? 'open' : 'took'} ${daysShort(r.length.days)}`
                        : ''}
                  </Td>
                  <Td col={projectCols[4]}>{r.quiet ? `${r.quiet} wk` : ZERO}</Td>
                  <Td col={projectCols[5]}>
                     {r.last >= 0 ? `week of ${dayWords(rangeWeeks[r.last].week)}` : ''}
                  </Td>
                  <Td col={projectCols[6]}>{planWords}</Td>
                  <Td col={projectCols[7]} last>
                     {r.before == null ? '' : r.before ? devDays(r.before) : ZERO}
                  </Td>
               </>
            }
            detail={
               <SpentOn
                  group={r.g}
                  source={source}
                  me={board.me}
                  onPerson={onPerson}
                  // the plan once more, for a keyboard (the row's own plan
                  // words are out of its Tab order) and a phone, whose
                  // narrow table drops the Plan column
                  actions={
                     planId != null &&
                     planWords && <span className="text-ink-3">Plan: {planWords}</span>
                  }
               />
            }
         />
      );
   };

   const splitRow = (g: RetroGroup) => {
      const label = splitLabel(nav.by, g.key);
      const prev = splitBefore ? splitBefore.get(g.key) ?? 0 : null;
      return (
         <TableRow
            key={g.key}
            id={`retro-row-split:${nav.by}:${g.key}`}
            name={label}
            cols={splitSpan}
            open={open.has(`split:${nav.by}:${g.key}`)}
            onToggle={() => toggle(`split:${nav.by}:${g.key}`)}
            lead={
               <span className="min-w-0 text-[13px] font-medium break-words text-ink">{label}</span>
            }
            cells={
               <>
                  <WeeksTd bars={splitBars.bars.get(g.key)} weeks={weeks} top={splitBars.top} />
                  <Td col={splitCols[0]} strong>
                     {devDays(g.days)}
                  </Td>
                  <Td col={splitCols[1]}>{pct(g.days, total)}</Td>
                  <Td col={splitCols[2]} last>
                     {prev == null ? '' : prev ? devDays(prev) : ZERO}
                  </Td>
               </>
            }
            detail={
               <SpentOn
                  group={g}
                  source={source}
                  me={board.me}
                  onPerson={onPerson}
                  actions={splitAction(g.key)}
               />
            }
         />
      );
   };

   const nameTh = (
      label: string,
      title: string,
      sortable?: { sort: Sort<string>; onSort: (s: string) => void }
   ) => (
      <Th
         col={{ key: sortable ? 'name' : null, label, title, width: '' }}
         sort={sortable?.sort}
         onSort={sortable?.onSort}
         first
      />
   );
   const whose = nav.who
      ? `${nav.who}’s`
      : nav.team === NO_TEAM
      ? 'No team’s'
      : nav.team
      ? `${nav.team}’s`
      : 'Everyone’s';
   // a narrowing's subject, for the sentences that say nothing happened
   const nobody = nav.who
      ? `${nav.who} didn’t work on a PR`
      : nav.team === NO_TEAM
      ? 'No one outside the developer teams worked on a PR'
      : nav.team
      ? `No one on ${nav.team} worked on a PR`
      : 'No one worked on a PR';

   return (
      <div className="flex flex-col gap-7">
         <section>
            <GroupHeader
               title="Where the time went"
               sub={
                  <SubDoor label="What a developer-day is" text="In days of work">
                     <p className="m-0">
                        A developer-day is a day someone opened, merged, commented on, stamped or
                        reviewed a PR, split evenly across the PRs they touched that day. A day on
                        their own PR is writing; on anyone else’s, reviewing.
                     </p>
                     <p className="m-0">
                        So a person’s week adds up to the days they worked, and a month of work
                        outweighs a one-line fix, which PR counts can’t show.
                     </p>
                     <p className="m-0">
                        Commits aren’t counted, since Pulldasher doesn’t keep them. In one sample of
                        60 merged PRs, their commit days would have added about 4%.
                     </p>
                     <p className="m-0">Each tile counts every day, compared with the {period}.</p>
                     <p className="m-0">
                        The weekly chart draws at least 90 days, ending on the range’s last day, so
                        a short range still shows its trend. The days before {dayWords(range.start)}{' '}
                        are shown lighter, the week the range starts in split in two; only the
                        range’s days count in the numbers. A week the chart’s days cut off, such as
                        this one so far, says how many of its days count.
                     </p>
                     <p className="m-0">
                        Writing is days on their own PRs, reviewing days on others’. The switch
                        above the chart counts only those days there and in every list below; the
                        tiles always count every day.
                     </p>
                  </SubDoor>
               }
               headerExtra={
                  (narrowed || rows.length > 0) && (
                     <span className="flex flex-wrap items-center gap-2">
                        {narrowed && (
                           <NarrowChip
                              label={nav.who ?? (nav.team === NO_TEAM ? 'No team' : narrowed)}
                              clear="Show everyone’s days"
                              onClear={() => navigate({ who: null, team: null })}
                           />
                        )}
                        {rows.length > 0 && (
                           <>
                              <QuietButton
                                 onClick={copy}
                                 title="Copy everything below as plain text, for the retro’s notes"
                              >
                                 {copied === 'copied'
                                    ? 'Copied'
                                    : copied === 'failed'
                                    ? 'Couldn’t copy'
                                    : COPY_AS_TEXT}
                              </QuietButton>
                              <QuietButton
                                 onClick={download}
                                 title="Download these days as a spreadsheet file (CSV): one line per person, PR and week"
                              >
                                 CSV
                              </QuietButton>
                           </>
                        )}
                        <span role="status" className="sr-only">
                           {copied === 'copied'
                              ? 'Copied the retro’s notes'
                              : copied === 'failed'
                              ? 'Couldn’t copy: the browser didn’t allow it'
                              : ''}
                        </span>
                     </span>
                  )
               }
            />
            {now.total > 0 ? (
               <StatsCard>
                  <div
                     className={`grid grid-cols-2 items-start gap-x-6 gap-y-4 sm:grid-cols-3 ${
                        tiles.length > 6 ? 'lg:grid-cols-7' : 'lg:grid-cols-6'
                     }`}
                  >
                     {tiles}
                  </div>
               </StatsCard>
            ) : (
               <div className="flex flex-col items-start gap-1.5">
                  <p className="m-0 max-w-[70ch] text-[13px] text-ink-3">
                     {nobody} in these days
                     {then?.total
                        ? `; the ${period} had ${n(devDays(then.total), 'developer-day')}.`
                        : '.'}
                  </p>
                  {/* narrowed, the chip is the way out; else a longer look */}
                  {!narrowed && rangeDays(range) < 90 && (
                     <QuietButton onClick={() => navigate({ range: '90d' })}>
                        Look back over the last 90 days
                     </QuietButton>
                  )}
               </div>
            )}
         </section>

         {now.total > 0 && (
            <section id="retro-days" className={SECTION}>
               <GroupHeader
                  level={3}
                  title={`${whose} ${nav.kind === 'all' ? '' : `${nav.kind} `}days, week by week`}
                  // the switch sits over what it changes: the weeks and the
                  // lists below, never the tiles above
                  headerExtra={
                     <Segmented
                        ariaLabel="which days count, from here down"
                        value={nav.kind}
                        options={KIND_OPTIONS}
                        onChange={kind => navigate({ kind })}
                     />
                  }
               />
               <StatsCard>
                  {!rows.length ? (
                     <p className="m-0 max-w-[70ch] text-[13px] text-ink-3">
                        {nav.kind === 'writing'
                           ? 'No writing days in these days: every one went to reviewing.'
                           : 'No reviewing days in these days: every one went to writing.'}
                     </p>
                  ) : drawn === null ? (
                     <LoadFailed what="the weeks" onRetry={retryRetroData} />
                  ) : (
                     <ChartSlot height={strips.length > 1 ? 240 : 220}>
                        {drawn && (
                           <StripsChart
                              weeks={weeks}
                              strips={strips}
                              unit=""
                              ariaLabel="Days of work each week"
                              total="All days"
                              format={devDays}
                              height={180}
                           />
                        )}
                     </ChartSlot>
                  )}
               </StatsCard>
            </section>
         )}

         {rows.length > 0 && (
            <>
               <TableSection
                  id="retro-people"
                  hint="Enter opens them on People; Space shows their details here."
                  header={
                     <GroupHeader
                        level={3}
                        title="Who worked on what"
                        sub={
                           <SubDoor label="How to read who worked on what" text={readThis}>
                              <p className="m-0">
                                 Every developer, and anyone else with days in the range. A name
                                 opens that person on People; the arrow opens their projects and PRs
                                 here.
                              </p>
                              <p className="m-0">
                                 The bars are each week’s days, every row on one scale, the days
                                 before the range lighter. A column’s head sorts by it.
                              </p>
                              <ColumnWords cols={personCols} />
                           </SubDoor>
                        }
                     />
                  }
                  caption={`Who worked on what, ${rangeWords(range)}`}
                  head={
                     <tr>
                        {nameTh('Person', 'Developers, and anyone else with days in the range', {
                           sort: psort,
                           onSort: s => navigate({ psort: s }),
                        })}
                        <WeeksTh weeks={weeks} />
                        {personCols.map((c, i) => (
                           <Th
                              key={c.key}
                              col={c}
                              sort={psort}
                              onSort={s => navigate({ psort: s })}
                              last={i === personCols.length - 1}
                           />
                        ))}
                     </tr>
                  }
               >
                  {bands.map(([team, list]) =>
                     team == null ? (
                        list.map(personRow)
                     ) : (
                        <Band
                           key={team}
                           id={`retro-team:${team}`}
                           label={team === NO_TEAM ? 'No team' : team}
                           note={String(list.length)}
                           cols={personSpan}
                        >
                           {list.map(personRow)}
                        </Band>
                     )
                  )}
               </TableSection>

               <TableSection
                  id="retro-projects"
                  hint="Enter opens its page; Space shows its details here."
                  header={
                     <GroupHeader
                        level={3}
                        title="Projects in this range"
                        sub={
                           <SubDoor label="How to read the projects" text={readThis}>
                              <p className="m-0">
                                 Every project’s days of work, how long its PRs ran, its longest
                                 pause, and how its plan turned out. The days on PRs with no project
                                 come last, as {NOT_IN_A_PROJECT}.
                              </p>
                              <p className="m-0">
                                 A name opens the project’s page; the arrow opens its PRs and who
                                 spent the days here. A column’s head sorts by it.
                              </p>
                              {unfiledShare > 0.5 && (
                                 <p className="m-0">
                                    Most of these days ({pct(unfiledShare, 1)}) went to PRs with no
                                    project label, so the project rows undercount.
                                 </p>
                              )}
                              <ColumnWords cols={projectCols} />
                           </SubDoor>
                        }
                     />
                  }
                  caption={`Projects in this range, ${rangeWords(range)}`}
                  head={
                     <tr>
                        {nameTh('Project', 'The project’s name', {
                           sort,
                           onSort: s => navigate({ sort: s }),
                        })}
                        <WeeksTh weeks={weeks} />
                        {projectCols.map((c, i) => (
                           <Th
                              key={c.key ?? c.label}
                              col={c}
                              sort={sort}
                              onSort={c.key ? s => navigate({ sort: s }) : undefined}
                              last={i === projectCols.length - 1}
                           />
                        ))}
                     </tr>
                  }
               >
                  {projectsShown.map(projectRow)}
                  <MoreRow
                     cols={projectSpan}
                     more={Math.max(0, projects.length - LIST_CAP)}
                     all={allProjects}
                     onToggle={() => setAllProjects(!allProjects)}
                     label="more projects"
                  />
                  {unfiledRow && projectRow(unfiledRow)}
               </TableSection>

               <TableSection
                  id="retro-split"
                  header={
                     <GroupHeader
                        level={3}
                        title="Split another way"
                        sub={
                           <SubDoor label="How to read the split" text={readThis}>
                              <p className="m-0">
                                 The same days, split one more way. A name opens its PRs and who
                                 spent the days here, with anything more it offers, such as counting
                                 only a team’s days.
                              </p>
                              {band && (
                                 <p className="m-0">
                                    Its groups sit under the tile words they add up to, each with
                                    its share.
                                 </p>
                              )}
                              <ColumnWords cols={splitCols} />
                           </SubDoor>
                        }
                        headerExtra={
                           <Segmented
                              ariaLabel="split the days by"
                              value={nav.by}
                              options={SPLIT_OPTIONS}
                              onChange={by => navigate({ by })}
                           />
                        }
                     />
                  }
                  caption={`The days ${lower(SPLIT_WORDS[nav.by])}, ${rangeWords(range)}`}
                  head={
                     <tr>
                        {nameTh(splitName, SPLIT_WORDS[nav.by])}
                        <WeeksTh weeks={weeks} />
                        {splitCols.map((c, i) => (
                           <Th key={c.label} col={c} last={i === splitCols.length - 1} />
                        ))}
                     </tr>
                  }
               >
                  {band ? (
                     band.names.map(name => {
                        const list = splitGroups.filter(g => band.of(g.key) === name);
                        if (!list.length) return null;
                        const days = list.reduce((sum, g) => sum + g.days, 0);
                        return (
                           <Band
                              key={name}
                              id={`retro-band:${nav.by}:${name}`}
                              label={name}
                              note={pct(days, total)}
                              cols={splitSpan}
                           >
                              {list.map(splitRow)}
                           </Band>
                        );
                     })
                  ) : (
                     <>
                        {splitShown.map(splitRow)}
                        <MoreRow
                           cols={splitSpan}
                           more={Math.max(0, splitGroups.length - LIST_CAP)}
                           all={allSplit}
                           onToggle={() => setAllSplit(!allSplit)}
                           label="more"
                        />
                     </>
                  )}
               </TableSection>
            </>
         )}

         <BacklogSection
            range={range}
            id="retro-backlog"
            title="Is the backlog growing?"
            everyone={!!narrowed}
         />
      </div>
   );
}
