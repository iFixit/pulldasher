import { useId, useState, type MouseEvent, type ReactNode } from 'react';
import { ChevronRight, Download } from 'lucide-react';
import { issueUrl, pullKey, shortRepo } from '../../../../shared/format';
import { STALL_DAYS } from '../../../../shared/model/decide';
import { utcDay } from '../../../../shared/model/projects';
import { planEnd } from '../../../../shared/model/roadmap';
import { QuietButton, Segmented, textInputClass } from '../../components/bits';
import { ClosedRow } from '../../components/ClosedRow';
import { Icon } from '../../components/Icon';
import {
   Fold,
   FoldRows,
   GroupHeader,
   laneShown,
   Rows,
   SubDoor,
   Truncated,
} from '../../components/Lane';
import type { RowOptions } from '../../components/Row';
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
   type PortfolioItem,
   type PrRef,
   type SortKey,
} from '../../model/portfolio';
import { dayOf, dayWords } from '../../model/projectData';
import { days, daysShort, LAST_14_DAYS } from '../../model/words';
import { reasonWords } from './Decide';
import {
   FlagWords,
   NarrowChip,
   openPlan,
   PageLink,
   PeopleStack,
   ProjectFacts,
   type FactLinks,
   SortHeader,
   switchView,
   type Navigate,
   type ProjectsNav,
} from './parts';
import { PlanFacts } from './roadmapHealth';

/** the long-list rule: this many rows, then "+ N more" */
const LIST_CAP = 40;

interface Column {
   key: SortKey;
   label: string;
   /** what the column counts, for its header's hover */
   title: string;
   width: string;
   /** narrow screens drop the columns a planner reads least */
   hide?: string;
   /** the first click's order, when it isn't biggest first */
   order?: 'ascending';
   cell: (item: PortfolioItem, act: CellActions) => ReactNode;
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
   /** whether the 14 days of who worked on what have loaded */
   workersLoaded: boolean;
   openProject: (slug: string) => void;
   /** where a row's facts line goes: its lead and its related projects */
   factLinks: (item: PortfolioItem) => FactLinks;
}

/** A cell's words as a button. */
function CellButton({
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
         className={`pressable rounded border-0 bg-transparent p-0 text-xs hover:underline ${className}`}
      >
         {children}
      </button>
   );
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

/** The calls Decide asks about a project, in Decide's own words, as one
 * sentence: "Is it done?" already ends one. */
function asked(item: PortfolioItem): string {
   // each reason is a sentence ending in its question
   const said = item.asks.map(a => reasonWords(a.reason, a.item)).join(' ');
   return /[.?!]$/.test(said) ? said : `${said}.`;
}

function planTitle(item: PortfolioItem): string {
   const plan = item.plan;
   if (item.asks.length) {
      return `Decide asks: ${asked(item)} Click to open ${
         item.planCell.kind === 'issues_done'
            ? 'the project page'
            : item.planCell.planId != null
            ? 'the plan'
            : 'the work with no plan'
      }.`;
   }
   if (plan) {
      const span = `${dayWords(plan.start)} to ${dayWords(planEnd(plan))}`;
      return `${plan.name}, ${span}. Click to open the plan.`;
   }
   return '';
}

/** The Plan cell's words as the button they are: the plan opens on the
 * roadmap, "Issues all closed" opens the project page where they're listed,
 * and "No plan" opens the roadmap's work with no plan, where one starts. */
function PlanButton({ item, act }: { item: PortfolioItem; act: CellActions }) {
   const cell = item.planCell;
   if (!cell.text) return null;
   return (
      <CellButton
         onClick={() =>
            cell.kind === 'issues_done'
               ? act.openProject(item.slug)
               : cell.planId != null
               ? act.openPlan(cell.planId)
               : act.unplanned(item)
         }
         className={`text-left md:text-right ${cell.warn ? 'text-warn' : 'text-ink-2'}`}
         title={planTitle(item)}
      >
         {cell.text}
      </CellButton>
   );
}

const COLUMNS: Column[] = [
   {
      key: 'lead',
      label: 'Lead',
      title: 'Who leads it: the assignee on its issue, or else its plan’s lead. Click a lead to open their row on People.',
      width: 'w-28',
      hide: 'hidden md:block',
      order: 'ascending',
      cell: (i, act) => {
         const lead = i.lead;
         return lead ? (
            <CellButton
               onClick={() => act.onPerson(lead)}
               className="break-words text-right text-ink-2"
               title={`Open ${lead}’s row on People`}
            >
               {lead}
            </CellButton>
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
      cell: (i, act) => {
         const team = i.team;
         return team ? (
            <CellButton
               onClick={() => act.findTeam(team)}
               className="text-ink-2"
               title={`List only the projects on the ${team} team`}
            >
               {team}
            </CellButton>
         ) : (
            ''
         );
      },
   },
   {
      key: 'age',
      label: 'Open for',
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
         !act.workersLoaded ? (
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
      label: 'Waiting',
      title: 'Its open PRs waiting on a CR or QA',
      width: 'w-14',
      hide: 'hidden xl:block',
      cell: i => i.waiting || '',
   },
   {
      key: 'merged',
      label: 'Merged',
      title: `Its PRs merged in the ${LAST_14_DAYS}`,
      width: 'w-14',
      hide: 'hidden xl:block',
      cell: i => i.merged || '',
   },
   {
      key: 'plan',
      label: 'Plan',
      title: 'The call Decide asks about it, or else what its plan says. Amber when someone owes something: a call Decide asks for, or an update its lead owes. Blank when it has no plan and needs none yet. Sorting by it, the default, puts amber first.',
      width: 'w-36',
      hide: 'hidden md:block',
      cell: (i, act) => <PlanButton item={i} act={act} />,
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
         <CellButton
            onClick={() => act.openProject(i.slug)}
            className="text-ink-2"
            title={`${s.open} open, ${s.done} done${
               s.dropped ? `, ${s.dropped} dropped` : ''
            }. Click for the list.`}
         >
            {`${s.open} of ${s.total}`}
         </CellButton>
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

/** Everything a project row opens to: its facts and plan, the call Decide
 * asks of it, who worked on it lately, the open PR gone longest without
 * activity, and its PRs. */
function RowDetail({
   item,
   prefix,
   opts,
   nav,
   navigate,
   onPerson,
   links,
}: {
   item: PortfolioItem;
   prefix: string;
   opts: RowOptions;
   nav: ProjectsNav;
   navigate: Navigate;
   onPerson: (login: string) => void;
   links: FactLinks;
}) {
   const stalest = item.stalest;
   const line = 'm-0 border-t border-secondary px-3.5 py-2 text-xs';
   return (
      <div className="border-t border-secondary bg-muted/30">
         <ProjectFacts
            g={item}
            project={item.project}
            prefix={prefix}
            ongoing={item.ongoing}
            links={links}
         >
            <PageLink g={item} navigate={navigate} />
         </ProjectFacts>
         <PlanFacts slug={item.slug} nav={nav} navigate={navigate} live={item.status === 'live'} />
         {item.asks.length > 0 && (
            // the call in Decide's own words, and the way to make it; the
            // row's Plan cell already carries its amber
            <p className={`${line} text-ink-2`}>
               Decide asks: {asked(item)}{' '}
               <button
                  type="button"
                  onClick={() =>
                     navigate(
                        { ...switchView('decide'), team: item.team ?? '(none)' },
                        { push: true }
                     )
                  }
                  className="hit pressable rounded border-0 bg-transparent p-0 text-xs font-medium text-brand hover:underline"
               >
                  Make the call on Decide
               </button>
            </p>
         )}
         <div className={`${line} text-ink-3`}>
            {item.workers.length ? (
               <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>Worked on it in the {LAST_14_DAYS}:</span>
                  {item.workers.map(w => (
                     <button
                        key={w.login}
                        type="button"
                        onClick={() => onPerson(w.login)}
                        className="pressable rounded border-0 bg-transparent p-0 text-xs text-ink-2 hover:text-brand hover:underline"
                        title={`Open ${w.login}’s row on People`}
                     >
                        {w.login}{' '}
                        <span className="text-ink-3">
                           {w.writing <= 0
                              ? 'reviewed'
                              : w.writing >= w.days - 0.005
                              ? 'wrote'
                              : 'wrote and reviewed'}
                           , {days(Math.round(w.days * 10) / 10)}
                        </span>
                     </button>
                  ))}
               </span>
            ) : (
               `No developer worked on it in the ${LAST_14_DAYS}.`
            )}
         </div>
         {stalest && stalest.days >= STALL_DAYS && (
            <p className={`${line} text-ink-3`}>
               Longest without activity:{' '}
               <a
                  href={issueUrl(stalest.pr.repo, stalest.pr.number)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ink-2 hover:text-brand hover:underline"
               >
                  {prWords(stalest.pr)}
               </a>
               {stalest.opened
                  ? `, nothing since it opened ${days(stalest.days)} ago.`
                  : `, nothing for ${days(stalest.days)}.`}
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
 * One project on one line, a table row. Its name opens the project page,
 * its plan words the plan, its lead and faces their rows on People; the
 * chevron, or a click anywhere else on the row, opens the row in place.
 */
function PortfolioRow({
   item,
   prefix,
   columns,
   act,
   opts,
   nav,
   navigate,
}: {
   item: PortfolioItem;
   prefix: string;
   columns: Column[];
   act: CellActions;
   opts: RowOptions;
   nav: ProjectsNav;
   navigate: Navigate;
}) {
   const [open, setOpen] = useState(false);
   const detailId = useId();
   // a mouse can open the row from anywhere on it; the chevron is the one
   // control for a keyboard. A click on a control in the row, or inside a
   // popover a face opened, isn't the row's
   const onRowClick = (e: MouseEvent<HTMLDivElement>) => {
      const target = e.target as Element;
      if (!e.currentTarget.contains(target) || target.closest('button, a')) return;
      setOpen(o => !o);
   };
   // flags, and on a phone the plan words its hidden column would hold
   const under = !!item.group?.flags.length || !!item.planCell.text;
   return (
      <>
         <div
            role="row"
            onClick={onRowClick}
            className="flex cursor-pointer items-center gap-3 border-t border-secondary px-3.5 py-2 text-xs text-ink-2 transition-[background-color] duration-150 ease-out first:border-t-0 hover:bg-muted motion-reduce:transition-none"
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
                  onClick={() => navigate({ project: item.slug })}
                  className="hit pressable min-w-0 rounded border-0 bg-transparent p-0 text-left text-[13px] font-medium break-words text-ink hover:text-brand"
                  title="Open the project page"
               >
                  {item.name}
               </button>
               {under && (
                  <span className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                     {item.group && <FlagWords g={item.group} />}
                     <span className="md:hidden">
                        <PlanButton item={item} act={act} />
                     </span>
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
                  {c.cell(item, act)}
               </span>
            ))}
         </div>
         {open && (
            <div role="row" id={detailId}>
               <div role="cell" aria-colspan={columns.length + 2}>
                  <RowDetail
                     item={item}
                     prefix={prefix}
                     opts={opts}
                     nav={nav}
                     navigate={navigate}
                     onPerson={act.onPerson}
                     links={act.factLinks(item)}
                  />
               </div>
            </div>
         )}
      </>
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

const capitalized = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

/**
 * Every project on one list. Tabs pick which (in progress by default), and
 * each counts what it would show; a column header sorts, what's owed first
 * by default; grouping splits by parent, lead or team; the find box narrows
 * by name, parent, lead or team; and a tile or a chart's bar narrows it
 * further, said by a chip in the bar that clears it. What's listed is what
 * the CSV and the copied text hold. All of it rides in the URL, so a view
 * can be shared.
 */
export function Portfolio({
   items,
   prefix,
   workersLoaded,
   nameOf,
   nav,
   navigate,
   opts,
   onPerson,
   me,
}: {
   items: PortfolioItem[];
   /** the project label prefix */
   prefix: string;
   workersLoaded: boolean;
   nameOf: (slug: string) => string;
   nav: ProjectsNav;
   navigate: Navigate;
   opts: RowOptions;
   onPerson: (login: string) => void;
   me: string;
}) {
   const [copied, setCopied] = useState(false);
   const narrowed = items.filter(i => matchesFind(i, nav.find) && matchesOnly(i, nav.only));
   const shown = sortItems(
      narrowed.filter(i => matchesStatus(i, nav.status)),
      nav.sort
   );
   const groups = groupItems(shown, nav.group, nameOf);
   // each tab counts what it would show with the find and a tile's pick, so
   // the tab that's on always says how many rows are below it
   const statusOptions: [string, string][] = STATUS_FILTERS.map(([key, label]) => {
      const count = narrowed.filter(i => matchesStatus(i, key)).length;
      return [key, count ? `${label} · ${count}` : label];
   });
   const columns = [
      ...COLUMNS,
      ...(shown.some(i => i.issues?.total) ? [ISSUES] : []),
      ...(shown.some(i => i.target) ? [TARGET] : []),
   ];
   const sort = parseSort(nav.sort);
   const onSort = (s: string) => navigate({ sort: s });
   const byDefault = sort.key === 'plan' && !sort.reversed;
   const sortedBy = [{ key: 'name', label: 'Project' }, ...columns].find(
      c => c.key === sort.key
   )?.label;
   const only = onlyWords(nav.only);
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
      workersLoaded,
      openProject: slug => navigate({ project: slug }),
      factLinks: item => ({
         navigate,
         nameOf: slug => items.find(i => i.slug === slug)?.name ?? null,
         parts: items
            .filter(i => i.project?.parents.includes(item.slug))
            .map(i => ({ slug: i.slug, name: i.name })),
      }),
   };
   const copy = () => {
      void navigator.clipboard?.writeText(portfolioText(shown, dayOf(new Date()))).then(() => {
         setCopied(true);
         setTimeout(() => setCopied(false), 2000);
      });
   };
   const row = (item: PortfolioItem) => (
      <PortfolioRow
         key={item.slug}
         item={item}
         prefix={prefix}
         columns={columns}
         act={act}
         opts={opts}
         nav={nav}
         navigate={navigate}
      />
   );
   const grouped = groups.length > 1 || !!groups[0]?.title;
   // the visible header row sorts; a group's own table repeats its names for
   // a screen reader, so each cell keeps its column's name
   const head = (visible: boolean) => (
      <div role="rowgroup">
         {visible ? (
            <div
               role="row"
               // grouped, the first band's own rule sits under it
               className={`flex items-center gap-3 bg-muted/40 px-3.5 py-[7px] ${
                  grouped ? '' : 'border-b border-line'
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
               {columns.map(c => (
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
               ))}
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
            placeholder="Find a project, lead or team"
            value={nav.find}
            onChange={e => navigate({ find: e.target.value })}
            className={`w-full px-2.5 sm:w-52 ${textInputClass}`}
         />
         {only && (
            <NarrowChip
               label={capitalized(only)}
               clear={`Show every project, not only ${only}`}
               onClear={() => navigate({ only: null })}
            />
         )}
      </div>
   );
   // the two ways out of the list ride beside its title, together, so a
   // chip in the bar below never pushes them onto a line of their own
   const actions = (
      <span className="inline-flex items-center gap-2">
         <QuietButton
            size="md"
            onClick={copy}
            disabled={!shown.length}
            title="Copy the projects listed here as plain text, for an email or a chat post: each one’s plan, its latest update, and when it last moved"
         >
            {copied ? 'Copied' : 'Copy status'}
         </QuietButton>
         <QuietButton
            size="md"
            onClick={() => download(shown)}
            disabled={!shown.length}
            title="Download the projects listed here as a spreadsheet file (CSV)"
         >
            <Icon icon={Download} size={14} className="mr-1.5" />
            CSV
         </QuietButton>
         <span className="sr-only" aria-live="polite">
            {copied ? 'Copied the projects listed here' : ''}
         </span>
      </span>
   );
   const sub = byDefault ? (
      <SubDoor label="How the list is ordered" text="What’s owed first, then the longest quiet">
         <p className="m-0">
            Amber Plan words name what someone owes: a call Decide asks for, such as a first plan, a
            plan past its end or its target, a stall, or work marked done that still takes PRs; or
            an update its lead owes. Those rows come first, then the rest, each by how long since
            anyone worked on it.
         </p>
         <p className="m-0">
            In progress means an open PR or a merge in the {LAST_14_DAYS}, and not parked, done or
            dropped on the roadmap. Quiet is an open project with nothing in flight.
         </p>
         <p className="m-0">
            A tile or a chart’s bar narrows the list; its chip in the bar says how, and the × shows
            everything again.
         </p>
      </SubDoor>
   ) : (
      <span>
         Sorted by {sortedBy}
         {sort.reversed ? ', reversed' : ''}.{' '}
         <button
            type="button"
            onClick={() => onSort(DEFAULT_SORT)}
            className="hit pressable rounded border-0 bg-transparent p-0 text-xs font-medium text-brand hover:underline"
         >
            Put what’s owed first
         </button>
      </span>
   );
   return (
      <section id="all-projects" className="scroll-mt-[var(--header-h,0px)]">
         {/* on a phone the bar would cover a quarter of the screen, so there
             it scrolls away: this box is exactly its height, leaving it no
             room to stick. From sm up the box drops out and it sticks
             through the list */}
         <div className="sm:contents">
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
         <Rows>
            {grouped ? (
               <>
                  <div role="table" aria-label="Sort the projects">
                     {head(true)}
                  </div>
                  {groups.map(g => (
                     <Fold
                        key={g.title}
                        count={g.items.length}
                        label={g.title}
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
                           row={row}
                        />
                     </Fold>
                  ))}
               </>
            ) : (
               <ProjectTable
                  key={nav.status}
                  label="Projects"
                  head={head(true)}
                  items={shown}
                  id={`portfolio:${nav.status}:`}
                  row={row}
               />
            )}
            {!shown.length && (
               <div className="px-3.5 py-4 text-[13px] text-ink-3">
                  {nav.find || nav.only ? (
                     <>
                        No project matches that.{' '}
                        <button
                           type="button"
                           onClick={() => navigate({ find: '', only: null })}
                           className="hit pressable rounded border-0 bg-transparent p-0 text-[13px] font-medium text-brand hover:underline"
                        >
                           Show all
                        </button>
                     </>
                  ) : (
                     'No projects here.'
                  )}
               </div>
            )}
         </Rows>
      </section>
   );
}
