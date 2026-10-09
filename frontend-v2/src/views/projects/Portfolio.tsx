import {
   useEffect,
   useId,
   useLayoutEffect,
   useRef,
   useState,
   type MouseEvent,
   type ReactNode,
} from 'react';
import { ChevronRight } from 'lucide-react';
import { issueUrl, pullKey, shortRepo } from '../../../../shared/format';
import { STALL_DAYS, type DecideRow } from '../../../../shared/model/decide';
import { utcDay } from '../../../../shared/model/projects';
import { FactLink, QuietButton, Segmented, textInputClass } from '../../components/bits';
import { ClosedRow } from '../../components/ClosedRow';
import { Icon } from '../../components/Icon';
import { Fold, FoldRows, GroupHeader, laneShown, SubDoor, Truncated } from '../../components/Lane';
import type { RowOptions } from '../../components/Row';
import { useRowKeys } from '../../components/useRowKeys';
import { DEFAULT_SORT } from '../../lens';
import {
   GROUPINGS,
   groupItems,
   matchesFind,
   matchesOnly,
   matchesStatus,
   onlyWords,
   parseSort,
   portfolioCsv,
   portfolioText,
   sortItems,
   STATUS_FILTERS,
   upperFirst,
   type Ask,
   type PortfolioItem,
   type PrRef,
   type SortKey,
} from '../../model/portfolio';
import { dayOf, dayWords } from '../../model/projectData';
import { useRoadmap } from '../../model/roadmapData';
import {
   andList,
   BEING_WORKED_ON,
   COPY_AS_TEXT,
   days,
   daysShort,
   devDays,
   LAST_14_DAYS,
   NO_PLAN,
} from '../../model/words';
import { DecideCall, planRow, reasonWords } from './Decide';
import {
   BY_PRS_WHY,
   ByPrs,
   FlagWords,
   NarrowChip,
   openPlan,
   PageLink,
   PeopleStack,
   ProjectFacts,
   type FactLinks,
   SortHeader,
   type Navigate,
   type ProjectsNav,
} from './parts';
import { PlanFacts, planWords } from './roadmapHealth';

/** the long-list rule: this many rows, then "+ N more" */
const LIST_CAP = 40;

/** The list as the Overview opens it: the projects being worked on, with
 * nothing narrowing them. Letting a tile's or a bar's pick go comes back
 * here, since the pick may have moved the tab. */
export const AS_OPENED: Partial<ProjectsNav> = { status: 'live', only: null };

/** Whether who worked on what in the last 14 days has come in. */
export type Workers = 'loading' | 'loaded' | 'failed';

interface Column {
   key: SortKey;
   label: string;
   /** what the column counts, for its header's hover */
   title: string;
   width: string;
   /** narrow screens drop the columns a planner reads least */
   hide?: string;
   /** an empty slot that keeps the column's room, so two tables line up */
   blank?: boolean;
   /** the first click's order, when it isn't biggest first */
   order?: 'ascending';
   /** `repeat`: an earlier band already showed the row */
   cell: (item: PortfolioItem, act: CellActions, repeat: boolean) => ReactNode;
}

/** What a cell's words do when clicked. */
interface CellActions {
   openPlan: (id: number) => void;
   findTeam: (team: string) => void;
   onPerson: (login: string) => void;
   /** the viewer's login, so their face wears their star */
   me: string;
   /** the roadmap's list of work with no plan, where a plan starts, narrowed
    * to this project when the list has it (work in flight) */
   unplanned: (item: PortfolioItem) => void;
   workers: Workers;
   openProject: (slug: string) => void;
   /** where a row's facts line goes: its lead and its related projects */
   factLinks: (item: PortfolioItem) => FactLinks;
   /** open the row in place, on the calls it's asked: set by each row */
   openDetail?: () => void;
   /** every lead in this table is a guess, so its column head says so once */
   leadsGuessed: boolean;
}

const prWords = (pr: PrRef) => `${shortRepo(pr.repo)}#${pr.number} ${pr.title}`;

function targetCell(item: PortfolioItem): ReactNode {
   if (!item.target) return '';
   // a milestone by its title; a Target date on the issue is just a date
   const name = item.target.title ?? 'the target date';
   const due = item.target.due_on ? dayWords(item.target.due_on) : name;
   const late = item.stage !== 'closed' && item.dueInDays != null && item.dueInDays < 0;
   const when =
      item.dueInDays == null
         ? name
         : late
         ? `${days(-item.dueInDays)} past ${name}`
         : `${name}, in ${days(item.dueInDays)}`;
   // a fact, so ink: when the date passing is owed a call, the Plan cell says so
   return <span title={when}>{due}</span>;
}

/** Calls Decide asks, in Decide's own words, as one sentence: "Is it
 * done?" already ends one. */
function askedWords(asks: readonly Ask[]): string {
   // each reason is a sentence ending in its question
   const said = asks.map(a => reasonWords(a.reason, a.item)).join(' ');
   return /[.?!]$/.test(said) ? said : `${said}.`;
}

/** Whether the plan's own line in an opened row (PlanFacts) already says
 * what a call is about: that there's no plan (or the one a call just made),
 * the plan's health and its update, or its weeks past the end. Said once is
 * enough, and the strip under it is the way to answer. */
function toldByPlan(a: Ask, item: PortfolioItem): boolean {
   if (a.reason.kind === 'new') return true;
   if ((a.item?.id ?? null) !== (item.plan?.id ?? null)) return false;
   switch (a.reason.kind) {
      case 'at_risk':
      case 'off_track':
         return true;
      case 'over':
      case 'ended':
         // it counts the weeks over only while the project has work in flight
         return item.status === 'live';
      default:
         return false;
   }
}

function planTitle(item: PortfolioItem): string {
   const plan = item.plan;
   if (item.asks.length) {
      return `Decide asks: ${askedWords(item.asks)} Click to decide here.`;
   }
   if (plan) return `${plan.name}, ${planWords(plan)}. Click to open the plan.`;
   return '';
}

/** The Plan cell's words as the link they are: a call Decide asks opens
 * the row in place, on the calls that answer it, and a plan opens on the
 * roadmap. A project an earlier band already showed draws them in ink, so
 * one call wears one amber mark. */
function PlanButton({
   item,
   act,
   repeat,
}: {
   item: PortfolioItem;
   act: CellActions;
   repeat: boolean;
}) {
   const cell = item.planCell;
   if (!cell.text) return null;
   const tone = cell.warn && !repeat ? 'text-warn' : '';
   // words, not a link, when they open the row in place: the row's own click does that
   if (item.asks.length && act.openDetail)
      return (
         <span className={`md:text-right ${tone}`} title={planTitle(item)}>
            {cell.text}
         </span>
      );
   return (
      <FactLink
         onClick={() =>
            item.asks.length && act.openDetail
               ? act.openDetail()
               : cell.planId != null
               ? act.openPlan(cell.planId)
               : act.unplanned(item)
         }
         className={`md:text-right ${tone}`}
         title={planTitle(item)}
      >
         {cell.text}
      </FactLink>
   );
}

const COLUMNS: Column[] = [
   {
      key: 'lead',
      label: 'Lead',
      title: 'Who leads it: the assignee on its issue, or else its plan’s lead, or else whoever has the most PRs in it (guessed from PRs). Click a lead to open their row on People.',
      width: 'w-40',
      hide: 'hidden md:block',
      order: 'ascending',
      cell: (i, act) => {
         const lead = i.lead;
         return lead ? (
            <>
               <FactLink
                  onClick={() => act.onPerson(lead)}
                  className="break-words"
                  title={`Open ${lead}’s row on People`}
               >
                  {lead}
               </FactLink>
               {i.leadByPrs && !act.leadsGuessed && (
                  <>
                     {' '}
                     <ByPrs />
                  </>
               )}
            </>
         ) : (
            ''
         );
      },
   },
   {
      key: 'team',
      label: 'Team',
      title: 'Its plan’s team, or else the team most of its developers are on',
      width: 'w-20',
      hide: 'hidden 2xl:block',
      order: 'ascending',
      cell: i => i.team ?? '',
   },
   {
      key: 'age',
      label: 'Time open',
      title: 'How long its oldest open PR has been open',
      width: 'w-16',
      cell: i =>
         i.ageDays == null || !i.openSince ? (
            ''
         ) : (
            <span title={`Its oldest open PR opened on ${dayWords(i.openSince)}`}>
               {daysShort(i.ageDays)}
            </span>
         ),
   },
   {
      key: 'last',
      label: 'Last activity',
      title: 'When anyone last worked on one of its PRs: opened, pushed to, commented on, reviewed, stamped or merged',
      width: 'w-20 sm:w-24',
      cell: i => {
         const last = i.lastActivity;
         if (!last) return '';
         return (
            <span title={`${dayWords(utcDay(last.at))}, on ${prWords(last.pr)}`}>
               {last.days ? `${daysShort(last.days)} ago` : 'today'}
            </span>
         );
      },
   },
   {
      key: 'people',
      label: 'People',
      title: `Developers who wrote or reviewed PRs on it in the ${LAST_14_DAYS}. Click a face to open their row on People.`,
      width: 'w-20',
      hide: 'hidden lg:block',
      cell: (i, act) =>
         act.workers === 'loading' ? (
            '…'
         ) : i.workers.length ? (
            <PeopleStack logins={i.workers.map(w => w.login)} onPerson={act.onPerson} me={act.me} />
         ) : (
            ''
         ),
   },
   {
      key: 'open',
      label: 'Open',
      title: 'Its open PRs now, drafts included',
      width: 'w-12',
      hide: 'hidden sm:block',
      cell: i => i.open || '',
   },
   {
      key: 'waiting',
      label: 'In review',
      title: 'Waiting on review: its open PRs waiting on a CR or QA',
      width: 'w-14',
      hide: 'hidden 2xl:block',
      cell: i => i.waiting || '',
   },
   {
      key: 'merged',
      label: 'Merged',
      title: `Its PRs merged in the ${LAST_14_DAYS}`,
      width: 'w-14',
      hide: 'hidden 2xl:block',
      cell: i => i.merged || '',
   },
   {
      key: 'plan',
      label: 'Plan',
      title: 'The decision Decide asks for, or else what its plan says. Amber when someone owes something: a decision Decide asks for, or an update its lead owes. Blank when it has no plan and needs none yet. Sorting by it, the default, puts amber first.',
      width: 'w-36',
      hide: 'hidden md:block',
      cell: (i, act, repeat) => <PlanButton item={i} act={act} repeat={repeat} />,
   },
];

const ISSUES: Column = {
   key: 'issues',
   label: 'Issues open',
   title: 'How many of its issues are still open: the ones with its label and the ones added on its page',
   width: 'w-16',
   hide: 'hidden lg:block',
   cell: (i, act) => {
      const s = i.issues;
      if (!s?.total) return '';
      return (
         <FactLink
            onClick={() => act.openProject(i.slug)}
            title={`${s.open} open, ${s.done} done${
               s.dropped ? `, ${s.dropped} dropped` : ''
            }. Click for the list.`}
         >
            {`${s.open} of ${s.total}`}
         </FactLink>
      );
   },
};

const TARGET: Column = {
   key: 'target',
   label: 'Target',
   title: 'The date on its issue: the Target date field, or else its milestone’s due date',
   width: 'w-20',
   hide: 'hidden lg:block',
   order: 'ascending',
   cell: targetCell,
};

/** Who worked on a project lately, in words: its developers, or else that
 * none did, and whose PRs are there instead, so a Last activity of today
 * beside it never reads as a contradiction. */
function workedOnWords(item: PortfolioItem, onPerson: (login: string) => void): ReactNode {
   if (item.workers.length) {
      return (
         <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Worked on it in the {LAST_14_DAYS}:</span>
            {item.workers.map(w => (
               <span key={w.login}>
                  <FactLink
                     onClick={() => onPerson(w.login)}
                     title={`Open ${w.login}’s row on People`}
                  >
                     {w.login}
                  </FactLink>{' '}
                  {w.writing <= 0
                     ? 'reviewed'
                     : w.writing >= w.days - 0.005
                     ? 'wrote'
                     : 'wrote and reviewed'}
                  , {days(devDays(w.days))}
               </span>
            ))}
         </span>
      );
   }
   const others = item.nonDevelopers;
   return `No developer worked on it in the ${LAST_14_DAYS}.${
      others.length
         ? ` Its PRs are by ${andList(others)}, ${
              others.length > 1 ? 'non-developers' : 'a non-developer'
           }.`
         : ''
   }`;
}

/** Everything a project row opens to: its facts and plan, the calls Decide
 * asks of it, made right here, who worked on it lately, the open PR gone
 * longest without activity, and its PRs. Each fact is said once: the row's
 * Plan cell names the call, the plan's line says its state, and the Decide
 * line only what those two don't. */
function RowDetail({
   item,
   calls,
   prefix,
   opts,
   nav,
   navigate,
   onPerson,
   links,
   workers,
}: {
   item: PortfolioItem;
   /** its rows on Decide: asked, or answered here */
   calls: readonly DecideRow[];
   prefix: string;
   opts: RowOptions;
   nav: ProjectsNav;
   navigate: Navigate;
   onPerson: (login: string) => void;
   links: FactLinks;
   workers: Workers;
}) {
   const { items: plans } = useRoadmap();
   const whyId = useId();
   const stalest = item.stalest;
   const line = 'm-0 border-t border-secondary px-3.5 py-2 text-xs';
   // the band runs the row's width; its sentence stops at a readable length
   const prose = 'block max-w-[70ch]';
   // Decide's rows here, asked or answered here, and what of them the
   // plan's line doesn't say
   const asked = calls.filter(row => row.reasons.length);
   const untold = asked
      .flatMap(row => row.reasons.map(reason => ({ reason, item: row.item })))
      .filter(a => !toldByPlan(a, item));
   // nothing asked: the calls rest behind Plan it, on the No plan line, or
   // under the plan's line behind Change the plan
   const unasked = !asked.length && (
      <DecideCall
         row={planRow(item.slug, item.plan, calls)}
         project={item}
         change="Change the plan"
      />
   );
   return (
      <div className="border-t border-secondary bg-muted/30">
         <ProjectFacts
            g={item}
            project={item.project}
            prefix={prefix}
            ongoing={item.ongoing}
            lead={item}
            links={links}
         >
            <PageLink g={item} navigate={navigate} />
         </ProjectFacts>
         {/* its plan, and the calls that change it, made right here: the
             ones Decide asks, in its own words when the plan's line doesn't
             say them, or else the plan's own; never amber, since the row's
             Plan cell carries its one mark */}
         {plans && (
            <>
               {item.plan ? (
                  <PlanFacts
                     slug={item.slug}
                     nav={nav}
                     navigate={navigate}
                     live={item.status === 'live'}
                  />
               ) : (
                  <div className={`${line} text-ink-3`}>
                     {NO_PLAN}
                     {unasked}
                  </div>
               )}
               {/* under the plan's line, as on its page, unless Decide asks
                   what that line doesn't say */}
               {(asked.length > 0 || item.plan) && (
                  <div
                     className={untold.length ? `${line} text-ink-2` : '-mt-2 px-3.5 pb-2 text-xs'}
                  >
                     {untold.length > 0 && (
                        <span id={whyId} className={prose}>
                           Decide asks: {askedWords(untold)}
                        </span>
                     )}
                     {asked.length
                        ? asked.map(row => (
                             <DecideCall
                                key={`${row.slug ?? ''}:${row.item?.id ?? ''}`}
                                row={row}
                                project={item}
                                describedBy={untold.length ? whyId : undefined}
                             />
                          ))
                        : unasked}
                  </div>
               )}
            </>
         )}
         {/* said once the days are in: before then "nobody" would be a guess */}
         {workers === 'loaded' && (
            <div className={`${line} text-ink-3`}>
               <span className={prose}>{workedOnWords(item, onPerson)}</span>
            </div>
         )}
         {stalest && stalest.days >= STALL_DAYS && (
            <p className={`${line} text-ink-3`}>
               <span className={prose}>
                  Longest without activity:{' '}
                  <a
                     href={issueUrl(stalest.pr.repo, stalest.pr.number)}
                     target="_blank"
                     rel="noopener noreferrer"
                     className="text-ink-2 underline hover:text-brand"
                  >
                     {prWords(stalest.pr)} ↗
                  </a>
                  {stalest.opened
                     ? `, nothing since it opened ${days(stalest.days)} ago.`
                     : `, nothing for ${days(stalest.days)}.`}
               </span>
            </p>
         )}
         {item.group && (item.group.open.length > 0 || item.group.merged.length > 0) && (
            <div className="border-t border-secondary bg-surface">
               <Fold
                  count={item.group.open.length}
                  label="Open PRs"
                  gloss="Its open PRs, oldest first"
                  id={`portfolio-open:${item.slug}`}
                  defaultOpen
               >
                  <FoldRows
                     list={item.group.open}
                     opts={opts}
                     id={`portfolio:${item.slug}`}
                     cap={laneShown(8, opts)}
                  />
               </Fold>
               <Fold
                  count={item.group.merged.length}
                  label={`Merged in the ${LAST_14_DAYS}`}
                  gloss={`Its PRs merged in the ${LAST_14_DAYS}, newest first`}
                  id={`portfolio-merged:${item.slug}`}
               >
                  <Truncated cap={8} id={`portfolio-merged:${item.slug}`}>
                     {item.group.merged.map(p => (
                        <ClosedRow key={pullKey(p)} pull={p} lastSeen={opts.lastSeen} />
                     ))}
                  </Truncated>
               </Fold>
            </div>
         )}
      </div>
   );
}

/**
 * One project on one line, a table row. Its name is the row's one Tab
 * stop: a click or Enter opens the project page, and Space opens the row in
 * place, as the chevron or a click anywhere else on it does. Its plan words
 * open the plan, its lead and faces their rows on People; those are a
 * mouse's shortcuts, since the opened row holds each of them.
 */
function PortfolioRow({
   item,
   calls,
   prefix,
   columns,
   act,
   opts,
   nav,
   navigate,
   hint,
   repeat,
}: {
   item: PortfolioItem;
   /** its rows on Decide: asked, or answered here */
   calls: readonly DecideRow[];
   prefix: string;
   columns: Column[];
   act: CellActions;
   opts: RowOptions;
   nav: ProjectsNav;
   navigate: Navigate;
   /** the id of the words that tell a keyboard what Enter and Space do */
   hint: string;
   /** an earlier band already showed it */
   repeat: boolean;
}) {
   const [open, setOpen] = useState(false);
   const detailId = useId();
   const rowRef = useRef<HTMLDivElement>(null);
   // the Plan cell's call opens the row on the answer that makes it
   const toAnswer = useRef(false);
   const focusAnswer = () =>
      document.getElementById(detailId)?.querySelector<HTMLElement>('[data-decide-focus]')?.focus();
   useEffect(() => {
      if (!open || !toAnswer.current) return;
      toAnswer.current = false;
      focusAnswer();
   });
   const rowAct: CellActions = {
      ...act,
      openDetail: () => {
         toAnswer.current = true;
         if (open) focusAnswer();
         else setOpen(true);
      },
   };
   // one Tab stop a row: every control but the name leaves the Tab order,
   // so a keyboard walks 40 rows in 40 stops, not 300
   useEffect(() => {
      rowRef.current
         ?.querySelectorAll<HTMLElement>('button:not([data-portfolio-focus]), a')
         .forEach(el => (el.tabIndex = -1));
   });
   // a mouse can open the row from anywhere on it. A click on a control in
   // the row, or inside a popover a face opened, isn't the row's
   const onRowClick = (e: MouseEvent<HTMLDivElement>) => {
      const target = e.target as Element;
      if (!e.currentTarget.contains(target) || target.closest('button, a')) return;
      setOpen(o => !o);
   };
   const cell = item.planCell;
   // flags, and on a phone the plan words its hidden column would hold
   const under = !!item.group?.flags.length || !!cell.text;
   return (
      // the row and what it opens to are one row for j and k, and its
      // scroll margin keeps it clear of the sticky bar and column names
      <div
         role="none"
         data-portfolio-row
         className="scroll-mt-[calc(var(--header-h,0px)_+_var(--bar-h,0px)_+_2.75rem)] border-t border-secondary first:border-t-0"
      >
         <div
            ref={rowRef}
            role="row"
            onClick={onRowClick}
            className="flex cursor-pointer items-center gap-3 px-3.5 py-2 text-xs text-ink-2 transition-[background-color] duration-150 ease-out hover:bg-muted motion-reduce:transition-none"
         >
            {/* a cell of its own, so the row header is the name alone */}
            <span role="cell" className="flex w-3 flex-none">
               <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={open ? detailId : undefined}
                  aria-label={`Details of ${item.name}`}
                  onClick={() => setOpen(o => !o)}
                  className="hit pressable rounded border-0 bg-transparent p-0 text-ink-3 hover:text-ink"
               >
                  <Icon
                     icon={ChevronRight}
                     size={12}
                     className={`block transition-[rotate] duration-150 ease-out motion-reduce:transition-none ${
                        open ? 'rotate-90' : ''
                     }`}
                  />
               </button>
            </span>
            {/* the name wraps rather than truncating (text never hides on this
                board), and flags sit under it so they can't crowd it */}
            <span role="rowheader" className="flex min-w-0 flex-1 flex-col items-start">
               <button
                  type="button"
                  data-portfolio-focus
                  aria-describedby={hint}
                  onClick={() => navigate({ project: item.slug })}
                  onKeyDown={e => {
                     if (e.key !== ' ') return;
                     // Space opens the row here; Enter, like a click, opens its page
                     e.preventDefault();
                     setOpen(o => !o);
                  }}
                  className="hit pressable min-w-0 rounded border-0 bg-transparent p-0 text-left text-[13px] font-medium break-words text-ink hover:text-brand"
                  title="Open the project page"
               >
                  {item.name}
               </button>
               {under && (
                  <span className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                     {item.group && <FlagWords g={item.group} />}
                     {/* words, not a link: on a phone a tap on the row opens
                         it, and the plan's own line inside goes to the plan */}
                     {cell.text && (
                        <span className={`md:hidden ${cell.warn && !repeat ? 'text-warn' : ''}`}>
                           {cell.text}
                        </span>
                     )}
                  </span>
               )}
            </span>
            {columns.map(c => (
               <span
                  key={c.key}
                  role="cell"
                  className={`flex-none text-right break-words tabular-nums ${c.width} ${
                     c.hide ?? ''
                  }`}
               >
                  {c.cell(item, rowAct, repeat)}
               </span>
            ))}
         </div>
         {open && (
            <div role="row" id={detailId}>
               <div role="cell" aria-colspan={columns.length + 2}>
                  <RowDetail
                     item={item}
                     calls={calls}
                     prefix={prefix}
                     opts={opts}
                     nav={nav}
                     navigate={navigate}
                     onPerson={act.onPerson}
                     links={act.factLinks(item)}
                     workers={act.workers}
                  />
               </div>
            </div>
         )}
      </div>
   );
}

// which lists were opened past the cap, kept across a trip to a project's
// page and back, as Truncated keeps its own
const expandedLists = new Set<string>();

/**
 * Rows as a table, capped like every long list: `cap` rows, then "+ N
 * more". The cap's buttons sit after the table, not in it, so the table
 * holds only rows.
 */
function ProjectTable({
   label,
   head,
   items,
   id,
   row,
}: {
   label: string;
   /** the header row's group: the sort headers, or their names for a screen reader */
   head: ReactNode;
   items: PortfolioItem[];
   id: string;
   row: (item: PortfolioItem) => ReactNode;
}) {
   const [all, setAll] = useState(() => expandedLists.has(id));
   const more = items.length - LIST_CAP;
   const toggle = () => {
      if (all) expandedLists.delete(id);
      else expandedLists.add(id);
      setAll(!all);
   };
   return (
      <>
         <div role="table" aria-label={label}>
            {head}
            <div role="rowgroup">{(all ? items : items.slice(0, LIST_CAP)).map(row)}</div>
         </div>
         {more > 0 && (
            <button
               type="button"
               // j and k open it on the way past (components/useRowKeys.ts)
               data-row-more={all ? undefined : true}
               onClick={toggle}
               className="pressable block w-full border-t border-secondary bg-muted/50 px-3.5 py-[9px] text-left text-xs font-medium text-ink-2 hover:text-brand"
            >
               {all ? 'Show fewer' : `+ ${more} more`}
            </button>
         )}
      </>
   );
}

function download(items: readonly PortfolioItem[]) {
   const url = URL.createObjectURL(new Blob([portfolioCsv(items)], { type: 'text/csv' }));
   const a = document.createElement('a');
   a.href = url;
   a.download = `projects-${new Date().toISOString().slice(0, 10)}.csv`;
   a.click();
   URL.revokeObjectURL(url);
}

/** A band's gloss when the list is grouped: what put its projects there. */
function bandGloss(by: string, title: string): string {
   if (title.startsWith('No ')) return `Projects with ${title.toLowerCase()}`;
   if (by === 'parent') return `${title}, and the projects that are part of it`;
   if (by === 'lead') return `Projects ${title} leads`;
   return `Projects on the ${title} team: its plan’s team, or else the team most of its developers are on`;
}

/** the column names' place while the rows scroll: under the app's header
 * and the list's own sticky bar, opaque, and above the rows' controls */
const STUCK =
   'sticky top-[calc(var(--header-h,0px)_+_var(--bar-h,0px))] z-[4] bg-[color-mix(in_oklab,var(--muted)_40%,var(--surface))]';

/** What a list of projects takes: Yours and All projects alike. */
interface ListProps {
   /** every project: each list picks its own from them, and takes its
    * columns from all of them, so the two tables line up */
   items: PortfolioItem[];
   /** how a row is placed, found and counted: a row answered in place as it
    * stood just before, so it keeps its place and its tab */
   placeOf?: (item: PortfolioItem) => PortfolioItem;
   /** Decide's rows still owed, and the ones answered in the list's rows */
   calls: readonly DecideRow[];
   /** the project label prefix */
   prefix: string;
   workers: Workers;
   nav: ProjectsNav;
   navigate: Navigate;
   opts: RowOptions;
   onPerson: (login: string) => void;
   me: string;
   /** no teams are set, so everyone counts and "developers" is the wrong word */
   noTeams?: boolean;
   /** the repo whose issues name projects; null when none is set */
   projectsRepo?: string | null;
}

/**
 * What a list draws its rows with: its columns, a row, the header that
 * names and sorts them (sticking under the list's own bar when `stuck`),
 * and the line telling a keyboard what Enter and Space do, which each row
 * points to.
 */
function useRows(
   {
      items,
      calls,
      prefix,
      workers,
      nav,
      navigate,
      opts,
      onPerson,
      me,
      noTeams,
      projectsRepo,
   }: ListProps,
   leave: readonly string[] = []
) {
   const hint = useId();
   // from every project, not the tab's: columns that come and go with the
   // tab would move the ones a reader was following
   const leads = items.filter(i => i.lead);
   const leadsGuessed = leads.length > 0 && leads.every(i => i.leadByPrs);
   const columns = [
      ...COLUMNS.map(c =>
         c.key === 'lead' && leadsGuessed
            ? {
                 ...c,
                 label: 'Lead, guessed',
                 title: `${BY_PRS_WHY} Click a lead to open their row on People.`,
              }
            : c.key === 'people' && noTeams
            ? { ...c, title: c.title.replace('Developers', 'People') }
            : c
      ),
      ...(items.some(i => i.issues?.total) ? [ISSUES] : []),
      ...(items.some(i => i.target) ? [TARGET] : []),
   ].map(c =>
      leave.includes(c.key) ? { ...c, blank: true, label: '', title: '', cell: () => '' } : c
   );
   const sort = parseSort(nav.sort);
   const onSort = (s: string) => navigate({ sort: s });
   const act: CellActions = {
      openPlan: id => navigate(openPlan(nav, id)),
      findTeam: team => navigate({ find: `team:${team}` }, { push: true }),
      onPerson,
      me,
      unplanned: item =>
         navigate({
            project: null,
            view: 'roadmap',
            show: 'unplanned',
            item: null,
            week: null,
            origin: null,
            // the roadmap lists only work in flight; a quiet project isn't there
            find: item.status === 'live' ? item.slug : '',
         }),
      workers,
      leadsGuessed,
      openProject: slug => navigate({ project: slug }),
      factLinks: item => ({
         navigate,
         projectsRepo,
         nameOf: slug => items.find(i => i.slug === slug)?.name ?? null,
         parts: items
            .filter(i => i.project?.parents.includes(item.slug))
            .map(i => ({ slug: i.slug, name: i.name })),
      }),
   };
   const callsOf = new Map<string, DecideRow[]>();
   for (const r of calls) if (r.slug) callsOf.set(r.slug, [...(callsOf.get(r.slug) ?? []), r]);
   const row = (item: PortfolioItem, repeat = false) => (
      <PortfolioRow
         key={item.slug}
         item={item}
         calls={callsOf.get(item.slug) ?? []}
         prefix={prefix}
         columns={columns}
         act={act}
         opts={opts}
         nav={nav}
         navigate={navigate}
         hint={hint}
         repeat={repeat}
      />
   );
   // the visible header row sorts; a group's own table repeats its names for
   // a screen reader, so each cell keeps its column's name. `ruled` draws
   // the line under it, which a grouped list's first band draws instead
   const head = (visible: boolean, { stuck = false, ruled = true } = {}) => (
      <div role="rowgroup" className={stuck ? STUCK : undefined}>
         {visible ? (
            <div
               role="row"
               className={`flex items-center gap-3 px-3.5 py-[7px] ${
                  ruled ? 'border-b border-line' : ''
               }`}
            >
               <span role="columnheader" className="w-3 flex-none">
                  <span className="sr-only">Details</span>
               </span>
               <SortHeader
                  label="Project"
                  title="Its issue’s title, or else its plan’s name, or else its label"
                  sortKey="name"
                  sort={sort}
                  onSort={onSort}
                  order="ascending"
                  className="min-w-0 flex-1"
               />
               {columns.map(c =>
                  c.blank ? (
                     <span
                        key={c.key}
                        role="columnheader"
                        className={`flex-none ${c.width} ${c.hide ?? ''}`}
                     />
                  ) : (
                     <SortHeader
                        key={c.key}
                        label={c.label}
                        title={c.title}
                        sortKey={c.key}
                        sort={sort}
                        onSort={onSort}
                        order={c.order}
                        className={`flex-none text-right ${c.width} ${c.hide ?? ''}`}
                     />
                  )
               )}
            </div>
         ) : (
            <div role="row" className="sr-only">
               <span role="columnheader">Details</span>
               <span role="columnheader">Project</span>
               {columns.map(c => (
                  <span key={c.key} role="columnheader" className={c.hide}>
                     {c.label}
                  </span>
               ))}
            </div>
         )}
      </div>
   );
   const hintLine = (
      <span id={hint} className="sr-only">
         Enter opens its page; Space shows its details here.
      </span>
   );
   return { columns, sort, onSort, row, head, hintLine };
}

/**
 * Your projects, first on the Overview (portfolio.ts isYours): the ones you
 * lead, by PRs too, or have a PR in, in the list's order and with its rows,
 * so a call is made here the same way. They're in All projects below as
 * well, drawn in ink there, so one call wears one amber mark. Nothing shows
 * when none are yours.
 */
export function Yours(props: ListProps & { slugs: ReadonlySet<string> }) {
   const { items, placeOf = item => item, slugs, nav } = props;
   // your own work: you know when it last moved, so those two columns stay
   // empty slots (All projects below uses them for sorting) and Lead lines up
   const { head, row, hintLine } = useRows(props, ['age', 'last']);
   const now = new Map(items.map(i => [i.slug, i]));
   const mine = sortItems(
      items.map(placeOf).filter(i => slugs.has(i.slug)),
      nav.sort
   ).map(i => now.get(i.slug) ?? i);
   if (!mine.length) return null;
   return (
      <section>
         <GroupHeader
            title="Yours"
            count={mine.length}
            sub={
               <SubDoor label="What makes a project yours" text="You lead them or have PRs in them">
                  <p className="m-0">
                     A project is yours when you lead it, or you have a PR open in it or merged in
                     the {LAST_14_DAYS}. Its lead is the assignee on its issue, or else its plan’s
                     lead, or else whoever has the most PRs in it, said “guessed from PRs”.
                  </p>
                  <p className="m-0">
                     Done or dropped ones leave the list, unless Decide asks about them because
                     their PRs still move. Each is in All projects below too.
                  </p>
               </SubDoor>
            }
         />
         {hintLine}
         <div className="overflow-clip rounded-2xl border border-line bg-surface">
            <ProjectTable
               label="Your projects"
               head={head(true)}
               items={mine}
               id="portfolio:yours"
               row={item => row(item)}
            />
         </div>
      </section>
   );
}

/**
 * Every project on one list. Tabs pick which (the ones being worked on by
 * default), and each counts what it would show; a column header sorts,
 * what's owed first by default; grouping splits by parent, lead or team;
 * the find box narrows by name, parent, lead or team; and a tile or a
 * chart's bar narrows it further, said by a chip in the bar that clears it.
 * What's listed is what the CSV and the copied text hold. All of it rides
 * in the URL, so a view can be shared.
 */
export function Portfolio(
   props: ListProps & {
      nameOf: (slug: string) => string;
      /** the team names in their configured order */
      teams: readonly string[];
      /** the projects Yours lists above, drawn in ink here */
      above?: ReadonlySet<string>;
   }
) {
   const { items, placeOf = item => item, nameOf, teams, above, nav, navigate } = props;
   const [copied, setCopied] = useState(false);
   const barRef = useRef<HTMLDivElement>(null);
   const { columns, sort, onSort, row, head, hintLine } = useRows(props);
   // j and k move between the projects, Yours' too, landing on each one's name
   useRowKeys('[data-portfolio-row]', '[data-portfolio-focus]');
   // the column names stick under the list's own sticky bar, which is as
   // tall as its toolbar wraps to, and doesn't stick on a phone (below)
   useLayoutEffect(() => {
      const wrap = barRef.current;
      const bar = wrap?.firstElementChild;
      const section = wrap?.parentElement;
      if (!wrap || !bar || !section) return;
      const publish = () =>
         section.style.setProperty(
            '--bar-h',
            getComputedStyle(wrap).display === 'contents'
               ? `${bar.getBoundingClientRect().height}px`
               : '0px'
         );
      publish();
      const ro = new ResizeObserver(publish);
      ro.observe(bar);
      return () => ro.disconnect();
   }, []);
   // placed by how they stood, drawn as they are
   const now = new Map(items.map(i => [i.slug, i]));
   const narrowed = items
      .map(placeOf)
      .filter(i => matchesFind(i, nav.find) && matchesOnly(i, nav.only));
   const shown = sortItems(
      narrowed.filter(i => matchesStatus(i, nav.status)),
      nav.sort
   ).map(i => now.get(i.slug) ?? i);
   const groups = groupItems(shown, nav.group, nameOf, teams);
   // each tab counts what it would show with the find and a tile's pick, so
   // the tab that's on always says how many rows are below it
   const statusOptions: [string, string][] = STATUS_FILTERS.map(([key, label]) => {
      const matching = narrowed.filter(i => matchesStatus(i, key));
      const count = matching.length;
      // the stalled ones are part of the count, so the Stalled tile and the tab agree
      const stalled = key === 'live' ? matching.filter(i => i.stalled).length : 0;
      return [key, count ? `${label} · ${count}${stalled ? ` (${stalled} stalled)` : ''}` : label];
   });
   const byDefault = sort.key === 'plan' && !sort.reversed;
   const sortedBy = [{ key: 'name', label: 'Project' }, ...columns].find(
      c => c.key === sort.key
   )?.label;
   const only = onlyWords(nav.only);
   const copy = () => {
      void navigator.clipboard?.writeText(portfolioText(shown, dayOf(new Date()))).then(() => {
         setCopied(true);
         setTimeout(() => setCopied(false), 2000);
      });
   };
   const grouped = groups.length > 1 || !!groups[0]?.title;
   // a project Yours lists above wears its amber there
   const repeated = (slug: string) => !!above?.has(slug);
   const toolbar = (
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 pt-1.5">
         <Segmented
            ariaLabel="Which projects"
            value={nav.status}
            options={statusOptions}
            onChange={status => navigate({ status })}
         />
         {/* words beside the switch, not a label around it: a label would
             hand a click on them to the first option */}
         <span className="inline-flex items-center gap-2 text-xs text-ink-3">
            <span aria-hidden>Group by</span>
            <Segmented
               ariaLabel="Group by"
               value={nav.group}
               options={GROUPINGS.map(([k, l]) => [k, k === 'none' ? 'None' : l])}
               onChange={group => navigate({ group })}
            />
         </span>
         <input
            type="search"
            aria-label="Find a project, lead or team"
            // "/" comes here, not to the board's PR search (hooks.ts)
            aria-keyshortcuts="/"
            placeholder="Find a project, lead or team"
            value={nav.find}
            onChange={e => navigate({ find: e.target.value })}
            className={`w-full px-2.5 sm:w-52 ${textInputClass}`}
         />
         {only && (
            <NarrowChip
               label={upperFirst(only)}
               clear={`Show every project ${BEING_WORKED_ON}, not only ${only}`}
               onClear={() => navigate(AS_OPENED)}
            />
         )}
      </div>
   );
   // the two ways out of the list ride beside its title, together, so a
   // chip in the bar below never pushes them onto a line of their own
   const actions = (
      <span className="inline-flex items-center gap-2">
         <QuietButton
            onClick={copy}
            disabled={!shown.length}
            title="Copy the projects listed here as plain text, for an email or a chat post: each one’s plan, its latest update, and when it last moved"
         >
            {copied ? 'Copied' : COPY_AS_TEXT}
         </QuietButton>
         <QuietButton
            onClick={() => download(shown)}
            disabled={!shown.length}
            title="Download the projects listed here as a spreadsheet file (CSV)"
         >
            CSV
         </QuietButton>
         <span className="sr-only" aria-live="polite">
            {copied ? 'Copied the projects listed here' : ''}
         </span>
      </span>
   );
   const sub = byDefault ? (
      <SubDoor label="How the list is ordered" text="How this list works">
         <p className="m-0">
            Amber Plan words name what someone owes: a decision Decide asks for, such as a first
            plan, a plan that is overdue or past its target date, a stall, or work marked done that
            is still worked on; or an update its lead owes. Decide’s decisions come first, in
            Decide’s own order, then the updates owed, then the rest, each by how long since anyone
            worked on it.
         </p>
         <p className="m-0">
            {upperFirst(BEING_WORKED_ON)} means an open PR or a merge in the {LAST_14_DAYS}, and not
            parked, done or dropped on the roadmap, unless Decide asks about it because its PRs
            still move. Quiet is an open project with nothing in flight.
         </p>
         <p className="m-0">
            Time open counts from its oldest open PR. Last activity is real work: a push, a comment,
            review or stamp, opening or merging. People and Merged count the {LAST_14_DAYS}; In
            review, the open PRs waiting on a CR or QA.
         </p>
         <p className="m-0">
            The find box matches a project, lead, team or parent; “lead:”, “team:” or “parent:”
            before a name matches only that.
         </p>
         <p className="m-0">
            A tile or a chart’s bar narrows the list; its chip in the bar says how, and the × lets
            it go.
         </p>
         <p className="m-0">
            j and k move between projects. On a project’s name, Enter opens its page and Space opens
            it here.
         </p>
      </SubDoor>
   ) : (
      <span>
         Sorted by {sortedBy}
         {sort.reversed ? ', reversed' : ''}.{' '}
         <QuietButton onClick={() => onSort(DEFAULT_SORT)}>Sort by what’s owed</QuietButton>
      </span>
   );
   return (
      <section id="all-projects" className="scroll-mt-[var(--header-h,0px)]">
         {/* on a phone the bar would cover a quarter of the screen, so there
             it scrolls away: this box is exactly its height, leaving it no
             room to stick. From sm up the box drops out and it sticks
             through the list */}
         <div ref={barRef} className="sm:contents">
            <GroupHeader
               title="All projects"
               sub={sub}
               headerExtra={
                  <>
                     {actions}
                     {toolbar}
                  </>
               }
            />
         </div>
         {hintLine}
         {/* clipped, not hidden: overflow hidden would end the column names'
             stick at this box */}
         <div className="overflow-clip rounded-2xl border border-line bg-surface">
            {grouped ? (
               <>
                  <div role="table" aria-label="Sort the projects" className={STUCK}>
                     {head(true, { ruled: false })}
                  </div>
                  {groups.map(g => (
                     <Fold
                        key={g.title}
                        count={g.items.length}
                        label={g.title}
                        gloss={bandGloss(nav.group, g.title)}
                        // logins keep their case
                        caps={nav.group !== 'lead'}
                        id={`portfolio:${nav.group}:${g.title.replace(/\s+/g, '-')}`}
                        defaultOpen
                     >
                        <ProjectTable
                           key={`${nav.status}:${g.title}`}
                           label={`Projects: ${g.title}`}
                           head={head(false)}
                           items={g.items}
                           id={`portfolio:${nav.status}:${g.title}`}
                           row={item => row(item, g.repeats.has(item.slug) || repeated(item.slug))}
                        />
                     </Fold>
                  ))}
               </>
            ) : (
               <ProjectTable
                  key={nav.status}
                  label="Projects"
                  head={head(true, { stuck: true })}
                  items={shown}
                  id={`portfolio:${nav.status}:`}
                  row={item => row(item, repeated(item.slug))}
               />
            )}
            {!shown.length && (
               <div className="px-3.5 py-4 text-[13px] text-ink-3">
                  {nav.find || nav.only ? (
                     <>
                        No project matches that.{' '}
                        <QuietButton onClick={() => navigate({ find: '', only: null })}>
                           Show all projects
                        </QuietButton>
                     </>
                  ) : (
                     'No projects here.'
                  )}
               </div>
            )}
         </div>
      </section>
   );
}
