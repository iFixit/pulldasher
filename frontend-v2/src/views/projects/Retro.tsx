import { useState, type MouseEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react';
import { n, pullKey, shortRepo } from '../../../../shared/format';
import { MISC_SLUG } from '../../../../shared/model/projects';
import { ORIGIN_WORD, planFor, type RoadmapItem } from '../../../../shared/model/roadmap';
import type { DerivedPull } from '../../../../shared/model/status';
import type { PullData } from '../../../../shared/types';
import { LoadFailed, QuietButton, Segmented } from '../../components/bits';
import { ClosedRow } from '../../components/ClosedRow';
import { Icon } from '../../components/Icon';
import { Avatar } from '../../components/identity';
import {
   eyebrowText,
   GroupHeader,
   Rows,
   SubDoor,
   Truncated,
   useFoldState,
} from '../../components/Lane';
import { Row, type RowOptions } from '../../components/Row';
import type { PortfolioItem } from '../../model/portfolio';
import {
   chartWindow,
   dayOf,
   dayWords,
   previousRange,
   rangeDays,
   rangeWords,
   refreshProjectsData,
   useProjectsData,
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
   mergeSpeed,
   projectLength,
   quietWeeks,
   RETRO_PLAN_RANK,
   retroCsv,
   retroPlan,
   retroRows,
   spreadByPerson,
   weeklyBy,
   type ChartWeek,
   type PersonLoad,
   type RetroGroup,
   type RetroRow,
} from '../../model/retro';
import { retryRetroData, useRetroData, type RetroPr } from '../../model/retroData';
import { days as daysOf, daysShort, NO_PLAN, NOT_IN_A_PROJECT } from '../../model/words';
import { usePulldasher } from '../../store';
import { StatsCard } from '../stats/parts';
import { ChartSlot, DaysWeeksChart, FlowWeeksChart, OpenPrsChart } from './lazyCharts';
import {
   openPlan,
   PeopleStack,
   readSort,
   switchView,
   Tile,
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

/** the long-list rule: this many rows, then "+ N more" */
const LIST_CAP = 40;

/** Another view, opened the way the view switch opens it, Look back's own
 * split and kind left behind with the rest of its picks. */
const leaveFor = (view: ProjectsNav['view']): Partial<ProjectsNav> => ({
   ...switchView(view),
   by: 'team',
   kind: 'all',
});

/** Days as the tables print them: a tenth under 10, whole above. */
const num = (d: number) => (d < 10 ? Math.round(d * 10) / 10 : Math.round(d));
/** "2.5 days", in a sentence */
const dayCount = (d: number) => daysOf(num(d));
const pct = (part: number, whole: number) => `${whole ? Math.round((100 * part) / whole) : 0}%`;
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

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
      if (key === UNSAID) return 'Not said';
      return ORIGIN_WORD[key as keyof typeof ORIGIN_WORD] ?? key;
   }
   if (split === 'author') return AUTHOR_WORDS[key] ?? key;
   if (split === 'team') return key === NO_TEAM ? 'No team' : key;
   return shortRepo(key);
}

/** One of Look back's table columns: its sort key (null for one that
 * doesn't sort), its head, the sentence its head explains it with, and
 * its width and the screens it shows on. */
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
         className={`py-[7px] align-bottom font-semibold text-ink-3 ${eyebrowText} ${col.width} ${
            col.hide ?? ''
         } ${first ? 'pl-[34px] text-left' : 'pl-1.5 text-right'} ${last ? 'pr-3.5' : 'pr-1.5'}`}
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
 * axis, a week of the range that's cut off saying how many of its days
 * count, as the chart's axis does; a screen reader hears what the column
 * holds instead. */
function WeeksTh({ weeks, top }: { weeks: ChartWeek[]; top: number }) {
   const ends = weeks.length > 1 ? [weeks[0], weeks[weeks.length - 1]] : weeks;
   return (
      <th
         scope="col"
         className={`px-1.5 py-[7px] align-bottom font-semibold text-ink-3 ${eyebrowText} ${WEEKS_COL.width} ${WEEKS_COL.hide}`}
         title={`Each week’s days, oldest first, every row on one scale: the tallest bar is ${dayCount(
            top
         )}. The weeks before the range are paler.`}
      >
         <span aria-hidden className="flex justify-between">
            {ends.map((w, i) => (
               <span key={w.week} className={i ? 'text-right' : ''}>
                  {dayWords(w.week)}
                  {w.days < 7 && !w.before && (
                     <span className="block font-normal tracking-normal normal-case">
                        {w.days} of 7 days
                     </span>
                  )}
               </span>
            ))}
         </span>
         <span className="sr-only">By week</span>
      </th>
   );
}

/** Each week's days as a bar, on the scale `top`, the oldest week first; a
 * screen reader hears the weeks that had any. */
function WeeksTd({
   weekly,
   weeks,
   top,
}: {
   weekly: number[] | undefined;
   weeks: ChartWeek[];
   top: number;
}) {
   const values = weekly ?? weeks.map(() => 0);
   const said = weeks.flatMap((w, i) =>
      values[i] > 0
         ? [
              `${dayWords(w.week)}${w.days < 7 ? `, ${w.days} of 7 days` : ''}${
                 w.before ? ', before the range' : ''
              }: ${num(values[i])}`,
           ]
         : []
   );
   return (
      <td className={`px-1.5 py-2 ${WEEKS_COL.width} ${WEEKS_COL.hide}`}>
         <span aria-hidden className="flex h-5 items-end gap-px">
            {values.map((d, i) => (
               <span
                  key={weeks[i].week}
                  className="min-w-0 flex-1 rounded-t-[1px] bg-ink-3"
                  style={{
                     height: `${Math.max(d > 0 ? 8 : 0, (d / top) * 100)}%`,
                     opacity: d ? (weeks[i].before ? 0.35 : 1) : 0,
                  }}
                  title={`Week of ${dayWords(weeks[i].week)}${
                     weeks[i].days < 7 ? `, ${weeks[i].days} of 7 days` : ''
                  }: ${dayCount(d)}`}
               />
            ))}
         </span>
         <span className="sr-only">{said.length ? `By week: ${said.join('; ')}` : 'No days'}</span>
      </td>
   );
}

/**
 * A table row that opens in place. Its arrow is the button, saying whether
 * it's open; a click anywhere else on the row that isn't a link or a button
 * does the same, for the mouse. What opens spans the table under it.
 */
function TableRow({
   id,
   name,
   cols,
   open,
   onToggle,
   lead,
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
   lead: ReactNode;
   cells: ReactNode;
   detail: ReactNode;
}) {
   const detailId = `${id}-detail`;
   return (
      <>
         <tr
            className="cursor-pointer border-t border-secondary text-ink-2 hover:bg-muted/40"
            onClick={(e: MouseEvent) => {
               if (!(e.target as HTMLElement).closest('a, button')) onToggle();
            }}
         >
            <th scope="row" className="py-2 pr-1.5 pl-3.5 text-left font-normal">
               <span className="flex min-w-0 items-center gap-2">
                  <button
                     type="button"
                     id={id}
                     aria-expanded={open}
                     aria-controls={open ? detailId : undefined}
                     aria-label={`Details for ${name}`}
                     onClick={onToggle}
                     className="hit pressable flex-none rounded border-0 bg-transparent p-0 text-ink-3 hover:text-brand"
                  >
                     <Icon
                        icon={ChevronRight}
                        size={12}
                        className={`transition-[rotate] duration-150 ease-out motion-reduce:transition-none ${
                           open ? 'rotate-90' : ''
                        }`}
                     />
                  </button>
                  {lead}
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
      </>
   );
}

/** Words in a row that go somewhere of their own: a project's page, a
 * person on People, a team narrowing the page. */
function LeadButton({
   onClick,
   title,
   label,
   children,
}: {
   onClick: () => void;
   title: string;
   /** the button's name, when its words alone don't say where it goes */
   label?: string;
   children: ReactNode;
}) {
   return (
      <button
         type="button"
         onClick={onClick}
         title={title}
         aria-label={label}
         className="hit pressable inline-flex min-w-0 items-center gap-2 rounded border-0 bg-transparent p-0 text-left text-[13px] font-medium break-words text-ink hover:text-brand hover:underline"
      >
         {children}
      </button>
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
      <tr>
         <td colSpan={cols} className="border-t border-secondary p-0">
            <button
               type="button"
               onClick={onToggle}
               className="pressable block w-full border-0 bg-muted/50 px-3.5 py-[9px] text-left text-xs font-medium text-ink-2 hover:text-brand"
            >
               {all ? 'Show fewer' : `+ ${more} ${label}`}
            </button>
         </td>
      </tr>
   );
}

/** A team's band in the people table: the Fold's look and its remembered
 * open state, as a row of the table, since a <details> can't hold rows. */
function TeamBody({
   team,
   count,
   cols,
   children,
}: {
   team: string;
   count: number;
   cols: number;
   children: ReactNode;
}) {
   const [open, setOpen] = useFoldState(`retro-team:${team}`, true);
   return (
      <tbody>
         <tr>
            {/* inset by the ring's width, so the card's edge can't clip it */}
            <th
               scope="rowgroup"
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
                     {team === NO_TEAM ? 'No team' : team}
                     <span className="tabular-nums"> · {count}</span>
                  </span>
               </button>
            </th>
         </tr>
         {open && children}
      </tbody>
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
 * its days under it. A PR still open that the board doesn't hold (only
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
      <Rows>
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
      </Rows>
   );
}

/** A person's name and face, opening them on People like every person in
 * the tab. */
function PersonButton({
   login,
   me,
   onPerson,
   size = 20,
}: {
   login: string;
   me: string;
   onPerson: (login: string) => void;
   size?: number;
}) {
   const you = login.toLowerCase() === me.toLowerCase();
   return (
      <LeadButton
         onClick={() => onPerson(login)}
         title={`Open ${login} on People`}
         label={`${login}${you ? ' (you)' : ''}: open on People`}
      >
         <Avatar login={login} size={size} you={you} />
         <span className="min-w-0 break-words">{login}</span>
      </LeadButton>
   );
}

/** Where a group's days went: every PR, most days first, and everyone who
 * spent them. */
function SpentOn({
   group,
   source,
   me,
   onPerson,
}: {
   group: RetroGroup;
   source: PullSource;
   me: string;
   onPerson: (login: string) => void;
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
                  <PersonButton login={login} me={me} onPerson={onPerson} size={16} />
                  <span className="flex-none text-ink-3 tabular-nums">{dayCount(d)}</span>
               </div>
            ))}
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
         ? `${dayCount(load.days - filed - load.unfiled)} on one-offs`
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
                  <button
                     type="button"
                     onClick={() => navigate({ project: p.slug })}
                     className="hit pressable min-w-0 rounded border-0 bg-transparent p-0 text-left text-xs break-words text-ink hover:text-brand hover:underline"
                     title={`Open the ${nameOf(p.slug)} page`}
                  >
                     {nameOf(p.slug)}
                  </button>
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
               <button
                  type="button"
                  onClick={() => navigate({ who: load.login, team: null })}
                  className="hit pressable mt-3 rounded border-0 bg-transparent p-0 text-left text-xs font-medium text-brand hover:underline"
               >
                  Count only {load.login}’s days on this page
               </button>
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
/** each person column's order in words, after "by team, then": [its
 * first sort, reversed] */
const PERSON_ORDER: Record<PersonKey, [string, string]> = {
   name: ['by name', 'by name, Z to A'],
   days: ['most days first', 'fewest days first'],
   reviewing: ['most of their days reviewing first', 'least of their days reviewing first'],
   wrote: ['most projects written on first', 'fewest projects written on first'],
   reviewed: ['most projects reviewed on first', 'fewest projects reviewed on first'],
   spread: ['most projects a week first', 'fewest projects a week first'],
   unfiled: [
      'most of their days not in a project first',
      'least of their days not in a project first',
   ],
   before: ['most days before first', 'fewest days before first'],
};

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
const PROJECT_ORDER: Record<ProjectKey, [string, string]> = {
   name: ['By name', 'By name, Z to A'],
   days: ['Most days first', 'Fewest days first'],
   people: ['Most people first', 'Fewest people first'],
   length: ['Longest first', 'Shortest first'],
   quiet: ['Longest pause first', 'Shortest pause first'],
   last: ['Most recently worked on first', 'Longest since worked on first'],
   plan: ['Finished plans first', 'No plan first'],
   before: ['Most days before first', 'Fewest days before first'],
};

/**
 * Look back: where the time went over the picked range, for a retro. The
 * unit is a developer-day, a day someone opened, merged, commented on,
 * stamped or reviewed a PR, split across the PRs they touched that day
 * (shared/model/retro.ts), so a month-long project outweighs a one-line fix
 * the way it did in people's weeks.
 *
 * The tiles say the few numbers a retro opens with, each against the same
 * number of days before, and each opens the list that explains it. Then
 * everyone's weeks, who worked on what by team, every project's days,
 * length, pauses and plan, the days split one more way, and whether the
 * backlog grew. Each week's days are drawn in a row on one scale per table
 * over the chart's weeks, so a row is its own label. A name does what it
 * does everywhere in the tab (a person opens People, a project its page);
 * the arrow opens a row in place, its PRs drawn as the board's own rows.
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
   // the rows opened in place, by "person:", "project:" or "split:" and key
   const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
   const [copied, setCopied] = useState<'copied' | 'failed' | null>(null);
   const [allProjects, setAllProjects] = useState(false);
   const [allSplit, setAllSplit] = useState(false);
   if (data === undefined) {
      return <p className="m-0 text-[13px] text-ink-3">Adding up the days…</p>;
   }
   if (data === null) return <LoadFailed what="the days" onRetry={retryRetroData} />;
   const toggle = (key: string) =>
      setOpen(was => {
         const next = new Set(was);
         if (!next.delete(key)) next.add(key);
         return next;
      });
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
   const now = measure(scoped, plans);
   const then = earlierScoped && measure(earlierScoped, plans);
   const period = beforeWords(rangeDays(range));
   const was = (part: (m: ReturnType<typeof measure>) => number) =>
      !then
         ? null
         : then.total
         ? `${pct(part(then), then.total)} in the ${period}`
         : `no days in the ${period}`;
   const total = rows.reduce((sum, r) => sum + r.days, 0);
   const earlierTotal = earlier?.reduce((sum, r) => sum + r.days, 0) ?? 0;
   const today = dayOf(new Date());
   const bySlug = new Map(items.map(i => [i.slug, i]));
   const narrowed =
      nav.who ?? (nav.team ? (nav.team === NO_TEAM ? 'people on no team' : nav.team) : null);
   const kindWords = nav.kind === 'all' ? '' : nav.kind === 'writing' ? ', writing' : ', reviewing';
   const allFinished = finishedIn(
      plans,
      items.flatMap(i => (i.project ? [i.project] : [])),
      range
   );
   // narrowed, the plans finished are the ones they worked on
   const finished = narrowed ? finishedOn(allFinished, scoped) : allFinished;
   const onTime = finished.filter(f => f.onTime === true).length;
   const late = finished.filter(f => f.onTime === false).length;
   const unjudged = finished.length - onTime - late;
   const plansNote = finished.length
      ? `${onTime} on time, ${late} late${unjudged ? `, ${unjudged} with no plan` : ''}`
      : null;
   const anyOrigin = plans.some(p => p.origin != null);
   const byDays = (list: RetroGroup[] | null) =>
      list ? new Map(list.map(g => [g.key, g.days])) : null;

   // every week of the chart's days, and each row's days in them
   const weeks = chartWeeks(shown, range);
   const drawnRows = drawn ? retroRows(drawn).filter(inScope).filter(inKind) : null;
   const weeklyOf = (keyOf: (r: RetroRow) => string) =>
      drawn && drawnRows ? weeklyBy(drawnRows, keyOf, drawn, weeks) : null;
   const byKind = weeklyOf(r => (r.own ? 'writing' : 'reviewing'));
   const kindWeeks = (kind: 'writing' | 'reviewing') =>
      nav.kind !== 'all' && nav.kind !== kind ? undefined : byKind?.get(kind) ?? weeks.map(() => 0);
   const topOf = (weekly: Map<string, number[]> | null) =>
      Math.max(0.01, ...[...(weekly?.values() ?? [])].flat());
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
   const personWeekly = weeklyOf(r => r.login);
   const personTop = topOf(personWeekly);
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
   const projectWeekly = weeklyOf(r => r.pr.project ?? '');
   const projectTop = topOf(projectWeekly);
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
   const splitBefore = earlier ? byDays(groupRows(earlier, keyOf[nav.by])) : null;
   const splitWeekly = weeklyOf(keyOf[nav.by]);
   const splitTop = topOf(splitWeekly);
   const splitName = SPLIT_OPTIONS.find(([s]) => s === nav.by)?.[1] ?? '';
   const splitShown = allSplit ? splitGroups : splitGroups.slice(0, LIST_CAP);
   /** What clicking a split group's name does, or null when there's
    * nowhere natural to go and the row only opens in place. */
   const openSplit = (key: string): [() => void, string] | null => {
      if (nav.by === 'origin') {
         // the roadmap filters its plans by where they came from; work with
         // no plan has none to show
         if (key === NOT_FILED || key === UNPLANNED) return null;
         return [
            () => navigate({ ...leaveFor('roadmap'), origin: key as ProjectsNav['origin'] }),
            'Show these plans on the roadmap',
         ];
      }
      if (nav.by === 'team') {
         return [
            () => navigate({ team: key, who: null }),
            'Count only this team’s days on this page',
         ];
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
   // the retro's notes, as plain text: everything the page lists
   const notes = () =>
      [
         `Where the time went${narrowed ? `, ${narrowed}` : ''}${kindWords}, ${rangeWords(
            range
         )}: ${n(num(total), 'developer-day')} from ${n(
            new Set(rows.map(r => r.login)).size,
            'person',
            'people'
         )}${earlier ? ` (${versus(Math.round(total), Math.round(earlierTotal), period)})` : ''}`,
         `${shares(now)}${then?.total ? `; in the ${period}, ${shares(then)}` : ''}`,
         `Plans finished: ${finished.length}${plansNote ? ` (${plansNote})` : ''}`,
         `Week by week: ${rangeWeeks
            .map(
               (w, i) =>
                  `${dayWords(w.week)}${w.days < 7 ? ` (${w.days} of 7 days)` : ''} ${num(
                     rangeWeekly[i] ?? 0
                  )}`
            )
            .join(', ')}`,
         '',
         'Who worked on what:',
         ...people.map(
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

   const tiles = [
      <Tile
         key="days"
         value={Math.round(now.total)}
         label="Developer-days"
         title={`Days people spent on PRs, ${rangeWords(
            range
         )}. A day counts once per person, split across the PRs they touched that day. Click to see who spent them.`}
         note={then ? versus(Math.round(now.total), Math.round(then.total), period) : null}
         onClick={() => jumpTo('retro-people')}
      />,
      <Tile
         key="reviewing"
         value={pct(now.total - now.writing, now.total)}
         label="Reviewing"
         title="Of the days, the share on other people’s PRs. Click to split the days by whose PR it was."
         note={was(m => m.total - m.writing)}
         onClick={() => {
            navigate({ by: 'author' });
            jumpTo('retro-split');
         }}
      />,
      <Tile
         key="roadmap"
         value={pct(now.planned, now.total)}
         label="On the roadmap"
         title="Of the days, the share on projects with a plan. Click to split the days by where the work came from."
         note={was(m => m.planned)}
         onClick={() => {
            navigate({ by: 'origin' });
            jumpTo('retro-split');
         }}
      />,
      anyOrigin && (
         <Tile
            key="fires"
            value={pct(now.fires, now.total)}
            label="Fires"
            title="Of the days, the share on plans marked as a fire to put out. Click to split the days by where the work came from."
            note={was(m => m.fires)}
            onClick={() => {
               navigate({ by: 'origin' });
               jumpTo('retro-split');
            }}
         />
      ),
      <Tile
         key="unfiled"
         value={pct(now.unfiled, now.total)}
         label={NOT_IN_A_PROJECT}
         title="Of the days, the share on PRs with no project label. Click for the PRs that took the most."
         note={was(m => m.unfiled)}
         onClick={() => {
            if (!unfiledRow) return jumpTo('retro-projects');
            setOpen(o => new Set(o).add('project:'));
            jumpToRow('retro-row-project:');
         }}
      />,
      <Tile
         key="spread"
         value={now.spread}
         label="Projects per person, a week"
         title="The median, across people, of how many different projects each touched in a week they worked. A PR with no project counts on its own. Click to sort the people by it."
         note={then ? `${then.spread} in the ${period}` : null}
         onClick={() => {
            navigate({ psort: 'spread' });
            jumpTo('retro-people');
         }}
      />,
      <Tile
         key="finished"
         value={finished.length}
         label="Plans finished"
         title={`Plans marked done in these days, and project issues closed as completed, each judged against its plan’s end${
            narrowed ? `; only the ones ${narrowed} worked on` : ''
         }. Click to sort the projects by their plan.`}
         note={plansNote}
         onClick={() => {
            navigate({ sort: 'plan' });
            jumpTo('retro-projects');
         }}
      />,
   ].filter(Boolean);

   const personCols: (Column<PersonKey> & { key: PersonKey })[] = [
      { key: 'days', label: 'Days', title: 'Their developer-days in the range', width: 'w-14' },
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
         title: `Their developer-days in the ${period}`,
         width: 'w-16',
         hide: 'hidden md:table-cell',
      },
   ];
   const projectCols: Column<ProjectKey>[] = [
      { key: 'days', label: 'Days', title: 'Developer-days on it in the range', width: 'w-14' },
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
         label: 'Longest quiet',
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
         title: 'How its plan on the roadmap turned out, as of today: done on time or late, still running past its end, or no plan. A plan opens on the roadmap.',
         width: 'w-40',
         hide: 'hidden md:table-cell',
      },
      {
         key: 'before',
         label: 'Before',
         title: `Its developer-days in the ${period}`,
         width: 'w-16',
         hide: 'hidden lg:table-cell',
      },
   ];
   const splitCols: Column<string>[] = [
      { key: null, label: 'Days', title: 'Developer-days in the range', width: 'w-14' },
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
         title: `Its developer-days in the ${period}`,
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
      return (
         <TableRow
            key={p.login}
            id={`retro-row-person:${p.login}`}
            name={p.login}
            cols={personSpan}
            open={open.has(`person:${p.login}`)}
            onToggle={() => toggle(`person:${p.login}`)}
            lead={<PersonButton login={p.login} me={board.me} onPerson={onPerson} />}
            cells={
               <>
                  <WeeksTd weekly={personWeekly?.get(p.login)} weeks={weeks} top={personTop} />
                  <Td col={personCols[0]} strong>
                     {num(p.days)}
                  </Td>
                  <Td col={personCols[1]}>{p.days ? pct(p.reviewing, p.days) : ''}</Td>
                  <Td col={personCols[2]}>{p.days ? p.wrote : ''}</Td>
                  <Td col={personCols[3]}>{p.days ? p.reviewed : ''}</Td>
                  <Td col={personCols[4]}>
                     {spread.has(p.login) ? Math.round((spread.get(p.login) ?? 0) * 10) / 10 : ''}
                  </Td>
                  <Td col={personCols[5]}>{p.days ? pct(p.unfiled, p.days) : ''}</Td>
                  <Td col={personCols[6]} last>
                     {earlierDays != null ? num(earlierDays) : ''}
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

   const projectRow = (r: ProjectRow) => (
      <TableRow
         key={r.g.key || 'not-in-a-project'}
         id={`retro-row-project:${r.g.key}`}
         name={r.label}
         cols={projectSpan}
         open={open.has(`project:${r.g.key}`)}
         onToggle={() => toggle(`project:${r.g.key}`)}
         lead={
            r.filed ? (
               <LeadButton
                  onClick={() => navigate({ project: r.g.key })}
                  title="Open the project page"
               >
                  {r.label}
               </LeadButton>
            ) : (
               <span className="min-w-0 text-[13px] font-medium break-words text-ink">
                  {r.label}
               </span>
            )
         }
         cells={
            <>
               <WeeksTd weekly={projectWeekly?.get(r.g.key)} weeks={weeks} top={projectTop} />
               <Td col={projectCols[0]} strong>
                  {num(r.g.days)}
               </Td>
               <Td col={projectCols[1]}>{pct(r.g.days, total)}</Td>
               <Td col={projectCols[2]}>
                  <span className="inline-flex">
                     <PeopleStack logins={r.g.people.map(([login]) => login)} onPerson={onPerson} />
                  </span>
               </Td>
               <Td col={projectCols[3]}>
                  {r.length ? `${r.length.open ? 'open' : 'took'} ${daysShort(r.length.days)}` : ''}
               </Td>
               <Td col={projectCols[4]}>{r.quiet ? `${r.quiet} wk` : ''}</Td>
               <Td col={projectCols[5]}>
                  {r.last >= 0 ? `week of ${dayWords(rangeWeeks[r.last].week)}` : ''}
               </Td>
               <Td col={projectCols[6]}>
                  {r.plan && r.planItem ? (
                     <button
                        type="button"
                        onClick={() =>
                           navigate(
                              {
                                 ...leaveFor('roadmap'),
                                 ...openPlan(nav, (r.planItem as RoadmapItem).id),
                              },
                              { push: true }
                           )
                        }
                        title={`Open the plan for ${r.label} on the roadmap`}
                        className="hit pressable rounded border-0 bg-transparent p-0 text-right text-xs text-ink-2 hover:text-brand hover:underline"
                     >
                        {r.plan.text}
                     </button>
                  ) : (
                     // a fact, not a call: quieter than the outcomes a retro reads
                     r.plan && <span className="text-ink-3">{r.plan.text}</span>
                  )}
               </Td>
               <Td col={projectCols[7]} last>
                  {r.before != null ? num(r.before) : ''}
               </Td>
            </>
         }
         detail={<SpentOn group={r.g} source={source} me={board.me} onPerson={onPerson} />}
      />
   );

   const splitRow = (g: RetroGroup) => {
      const go = openSplit(g.key);
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
               go ? (
                  <LeadButton onClick={go[0]} title={go[1]}>
                     {label}
                  </LeadButton>
               ) : (
                  <span className="min-w-0 text-[13px] font-medium break-words text-ink">
                     {label}
                  </span>
               )
            }
            cells={
               <>
                  <WeeksTd weekly={splitWeekly?.get(g.key)} weeks={weeks} top={splitTop} />
                  <Td col={splitCols[0]} strong>
                     {num(g.days)}
                  </Td>
                  <Td col={splitCols[1]}>{pct(g.days, total)}</Td>
                  <Td col={splitCols[2]} last>
                     {prev != null ? num(prev) : ''}
                  </Td>
               </>
            }
            detail={<SpentOn group={g} source={source} me={board.me} onPerson={onPerson} />}
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
   // the number columns keep their widths and the name column, with none,
   // takes what's left; a fixed layout can't, since a band's or a detail's
   // span over the columns a phone hides would count them as real ones
   const tableClass = 'w-full border-collapse text-xs';
   const sectionClass = 'scroll-mt-[var(--header-h,0px)]';
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
               title={`Where the time went${narrowed ? `, ${narrowed}` : ''}`}
               sub={
                  <SubDoor label="What a developer-day is" text="Counted in developer-days">
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
                     <p className="m-0">Each tile compares with the {period}.</p>
                  </SubDoor>
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
               <p className="m-0 text-[13px] text-ink-3">
                  {nobody} in these days
                  {then?.total
                     ? `; the ${period} had ${n(num(then.total), 'developer-day')}.`
                     : '.'}
               </p>
            )}
            {(now.total > 0 || narrowed) && (
               <div className="mt-4 flex flex-wrap items-center gap-3">
                  {now.total > 0 && (
                     <Segmented
                        ariaLabel="which days count"
                        value={nav.kind}
                        options={KIND_OPTIONS}
                        onChange={kind => navigate({ kind })}
                     />
                  )}
                  {narrowed && (
                     <QuietButton onClick={() => navigate({ who: null, team: null })}>
                        Show everyone’s days
                     </QuietButton>
                  )}
                  <span className="flex-1" />
                  {rows.length > 0 && (
                     // the two ways out wrap together on a phone
                     <span className="flex gap-2">
                        <QuietButton
                           onClick={download}
                           title="Download these days as a spreadsheet file (CSV): one line per person, PR and week"
                        >
                           CSV
                        </QuietButton>
                        <QuietButton
                           onClick={copy}
                           title="Copy everything below as plain text, for the retro’s notes"
                        >
                           {copied === 'copied'
                              ? 'Copied'
                              : copied === 'failed'
                              ? 'Couldn’t copy'
                              : 'Copy as text'}
                        </QuietButton>
                     </span>
                  )}
                  <span role="status" className="sr-only">
                     {copied === 'copied'
                        ? 'Copied the retro’s notes'
                        : copied === 'failed'
                        ? 'Couldn’t copy: the browser didn’t allow it'
                        : ''}
                  </span>
               </div>
            )}
         </section>

         {now.total > 0 && !rows.length && (
            <p className="m-0 text-[13px] text-ink-3">
               {nav.kind === 'writing'
                  ? 'No writing days in these days: every one went to reviewing.'
                  : 'No reviewing days in these days: every one went to writing.'}
            </p>
         )}

         {rows.length > 0 && (
            <>
               <section id="retro-days" className={sectionClass}>
                  <GroupHeader
                     level={3}
                     title={`${whose} days, week by week${kindWords}`}
                     sub={
                        <SubDoor
                           label="How the weeks are drawn"
                           text={`${n(num(total), 'developer-day')}, ${rangeWords(range)}`}
                        >
                           <p className="m-0">
                              The chart draws at least 90 days, ending on the range’s last day, so a
                              short range still shows its trend. The weeks before{' '}
                              {dayWords(range.start)} are paler; only the range’s days count in the
                              numbers.
                           </p>
                           <p className="m-0">
                              A week the chart’s days cut off, such as this one so far, says how
                              many of its days it holds.
                           </p>
                        </SubDoor>
                     }
                  />
                  <StatsCard>
                     {drawn === null ? (
                        <LoadFailed what="the weeks" onRetry={retryRetroData} />
                     ) : (
                        <ChartSlot height={200}>
                           {drawn && (
                              <DaysWeeksChart
                                 weeks={weeks}
                                 writing={kindWeeks('writing')}
                                 reviewing={kindWeeks('reviewing')}
                              />
                           )}
                        </ChartSlot>
                     )}
                  </StatsCard>
               </section>

               <section id="retro-people" className={sectionClass}>
                  <GroupHeader
                     level={3}
                     title="Who worked on what"
                     sub={
                        <SubDoor
                           label="How to read who worked on what"
                           text={upper(
                              `${teamNames.length ? 'by team, then ' : ''}${
                                 PERSON_ORDER[psort.key][psort.reversed ? 1 : 0]
                              }`
                           )}
                        >
                           <p className="m-0">
                              Every developer, and anyone else with days in the range. A name opens
                              that person on People; the arrow opens their projects and PRs here.
                           </p>
                           <p className="m-0">
                              The bars are each week’s days, every row on one scale. A column’s head
                              sorts by it; hovering a head says what it counts.
                           </p>
                        </SubDoor>
                     }
                  />
                  <Rows>
                     <table className={tableClass}>
                        <caption className="sr-only">
                           Who worked on what, {rangeWords(range)}
                        </caption>
                        <thead className="border-b border-line bg-muted/40">
                           <tr>
                              {nameTh(
                                 'Person',
                                 'Developers, and anyone else with days in the range',
                                 {
                                    sort: psort,
                                    onSort: s => navigate({ psort: s }),
                                 }
                              )}
                              <WeeksTh weeks={weeks} top={personTop} />
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
                        </thead>
                        {bands.map(([team, list]) =>
                           team == null ? (
                              <tbody key="everyone">{list.map(personRow)}</tbody>
                           ) : (
                              <TeamBody
                                 key={team}
                                 team={team}
                                 count={list.length}
                                 cols={personSpan}
                              >
                                 {list.map(personRow)}
                              </TeamBody>
                           )
                        )}
                     </table>
                  </Rows>
               </section>

               <section id="retro-projects" className={sectionClass}>
                  <GroupHeader
                     level={3}
                     title="Projects in this range"
                     sub={
                        <SubDoor
                           label="How to read the projects"
                           text={PROJECT_ORDER[sort.key][sort.reversed ? 1 : 0]}
                        >
                           <p className="m-0">
                              Every project’s developer-days, how long its PRs ran, its longest
                              pause, and how its plan turned out. The days on PRs with no project
                              come last, as {NOT_IN_A_PROJECT}.
                           </p>
                           <p className="m-0">
                              A name opens the project’s page; the arrow opens its PRs and who spent
                              the days here. A column’s head sorts by it.
                           </p>
                           {unfiledShare > 0.5 && (
                              <p className="m-0">
                                 Most of these days ({pct(unfiledShare, 1)}) went to PRs with no
                                 project label, so the project rows undercount.
                              </p>
                           )}
                        </SubDoor>
                     }
                  />
                  <Rows>
                     <table className={tableClass}>
                        <caption className="sr-only">
                           Projects in this range, {rangeWords(range)}
                        </caption>
                        <thead className="border-b border-line bg-muted/40">
                           <tr>
                              {nameTh('Project', 'The project’s name', {
                                 sort,
                                 onSort: s => navigate({ sort: s }),
                              })}
                              <WeeksTh weeks={weeks} top={projectTop} />
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
                        </thead>
                        <tbody>
                           {projectsShown.map(projectRow)}
                           {unfiledRow && projectRow(unfiledRow)}
                           <MoreRow
                              cols={projectSpan}
                              more={Math.max(0, projects.length - LIST_CAP)}
                              all={allProjects}
                              onToggle={() => setAllProjects(!allProjects)}
                              label="more projects"
                           />
                        </tbody>
                     </table>
                  </Rows>
               </section>

               <section id="retro-split" className={sectionClass}>
                  <GroupHeader
                     level={3}
                     title="Split another way"
                     sub={SPLIT_WORDS[nav.by]}
                     headerExtra={
                        <Segmented
                           ariaLabel="split the days by"
                           value={nav.by}
                           options={SPLIT_OPTIONS}
                           onChange={by => navigate({ by })}
                        />
                     }
                  />
                  <Rows>
                     <table className={tableClass}>
                        <caption className="sr-only">
                           The days {lower(SPLIT_WORDS[nav.by])}, {rangeWords(range)}
                        </caption>
                        <thead className="border-b border-line bg-muted/40">
                           <tr>
                              {nameTh(splitName, SPLIT_WORDS[nav.by])}
                              <WeeksTh weeks={weeks} top={splitTop} />
                              {splitCols.map((c, i) => (
                                 <Th key={c.label} col={c} last={i === splitCols.length - 1} />
                              ))}
                           </tr>
                        </thead>
                        <tbody>
                           {splitShown.map(splitRow)}
                           <MoreRow
                              cols={splitSpan}
                              more={Math.max(0, splitGroups.length - LIST_CAP)}
                              all={allSplit}
                              onToggle={() => setAllSplit(!allSplit)}
                              label="more"
                           />
                        </tbody>
                     </table>
                  </Rows>
               </section>
            </>
         )}

         <BacklogSection range={range} everyone={!!narrowed} />
      </div>
   );
}

/**
 * Is the backlog growing: the PRs open at the end of each day, and what
 * arrived and what merged each week, over at least 90 days ending on the
 * range's last day, with the days before the range faded. The line over the
 * charts counts the picked range's PRs. It counts every PR, whoever the
 * page is narrowed to, and says so then.
 */
function BacklogSection({ range, everyone }: { range: Range; everyone: boolean }) {
   const shown = chartWindow(range);
   const data = useProjectsData(shown);
   const t = useProjectsData(range)?.window.totals;
   const speed = t ? mergeSpeed(t.merged, t.median_days_to_merge) : null;
   return (
      <section id="retro-backlog" className="scroll-mt-[var(--header-h,0px)]">
         <GroupHeader
            level={3}
            title="Is the backlog growing?"
            sub={`${everyone ? 'Everyone’s PRs, ' : ''}${rangeWords(shown)}`}
         />
         <StatsCard>
            {t && (
               <p className="m-0 mb-3 text-xs text-ink-3">
                  {rangeWords(range)}: {n(t.opened, 'PR')} opened and {t.merged} merged
                  {speed ? `. ${speed}` : ''}.
               </p>
            )}
            {data === null ? (
               <LoadFailed what="the charts" onRetry={refreshProjectsData} />
            ) : (
               <div className="flex flex-col gap-4">
                  <ChartSlot height={200}>
                     {data && <OpenPrsChart days={data.window.days} picked={range} />}
                  </ChartSlot>
                  <ChartSlot height={210}>
                     {data && (
                        <FlowWeeksChart
                           weeks={data.window.weeks}
                           picked={range}
                           shown={data.window}
                        />
                     )}
                  </ChartSlot>
               </div>
            )}
         </StatsCard>
      </section>
   );
}
