import { useState, type ReactNode } from 'react';
import { ChevronRight, Download } from 'lucide-react';
import { issueUrl, n, pullKey, shortRepo } from '../../../../shared/format';
import { STALL_DAYS } from '../../../../shared/model/decide';
import { utcDay } from '../../../../shared/model/projects';
import { Segmented, textInputClass } from '../../components/bits';
import { ClosedRow } from '../../components/ClosedRow';
import { Icon } from '../../components/Icon';
import { eyebrowText, FoldRows, laneShown, Rows, Truncated } from '../../components/Lane';
import type { RowOptions } from '../../components/Row';
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
import {
   FlagWords,
   openPlan,
   PageLink,
   PeopleStack,
   ProjectFacts,
   SortHeader,
   type Navigate,
   type ProjectsNav,
} from './parts';
import { PlanFacts, planCellWords } from './roadmapHealth';

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
   cell: (item: PortfolioItem, act: CellActions) => ReactNode;
}

/** What a cell's words do when clicked, from inside a row that opens on click. */
interface CellActions {
   openPlan: (id: number) => void;
   findLead: (lead: string) => void;
   onPerson: (login: string) => void;
   /** the roadmap's list of work with no plan, where a plan starts */
   unplanned: () => void;
   /** whether the 14 days of who worked on what have loaded */
   workersLoaded: boolean;
}

/** A cell's words as a button that does its own thing, not the row's. */
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
         onClick={e => {
            // inside the row's <summary>: don't also open the row
            e.preventDefault();
            onClick();
         }}
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
   const open = item.stage !== 'closed';
   const late = open && item.dueInDays != null && item.dueInDays < 0;
   const when =
      item.dueInDays == null
         ? name
         : late
         ? `${-item.dueInDays} days past ${name}`
         : `${name}, in ${item.dueInDays} days`;
   // past due on a project still open is the one thing here someone owes
   return (
      <span className={late ? 'text-warn' : undefined} title={when}>
         {due}
      </span>
   );
}

function planTitle(item: PortfolioItem): string {
   if (item.plan) return `${planCellWords(item.plan).title}. Click to open the plan.`;
   if (item.planCell.kind === 'missed') {
      return 'Its target date passed with PRs still open, and it has no plan on the roadmap.';
   }
   if (item.planCell.kind === 'stopped') return 'Its issue is closed, and it has no plan.';
   return item.planCell.warn
      ? 'Not on the roadmap, with 3 or more PRs open or merged in the last 14 days, so Decide asks for a plan. Click to see the work with no plan.'
      : 'Not on the roadmap. Click to see the work with no plan.';
}

const COLUMNS: Column[] = [
   {
      key: 'lead',
      label: 'Lead',
      title: 'Who leads it: the assignee on its issue, or else its plan’s lead',
      width: 'w-24',
      hide: 'hidden md:block',
      cell: (i, act) => {
         const lead = i.lead;
         return lead ? (
            <CellButton
               onClick={() => act.findLead(lead)}
               className="text-ink-2"
               title={`List only the projects ${lead} leads`}
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
      cell: i => i.team ?? '',
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
               {i.ageDays} d
            </span>
         ),
   },
   {
      key: 'idle',
      label: 'Last activity',
      title: `When anyone last worked on one of its PRs: opened, pushed to, commented on, reviewed, stamped or merged. Amber at ${STALL_DAYS} days or more, unless it’s parked.`,
      width: 'w-20 sm:w-24',
      cell: i => {
         const last = i.lastActivity;
         if (!last) return '';
         const stale = last.days >= STALL_DAYS && i.stage !== 'parked' && i.open > 0;
         return (
            <span
               className={stale ? 'text-warn' : undefined}
               title={`${dayWords(utcDay(last.at))}, on ${prWords(last.pr)}`}
            >
               {last.days ? `${last.days} d ago` : 'today'}
            </span>
         );
      },
   },
   {
      key: 'people',
      label: 'People',
      title: 'Developers who wrote or reviewed PRs on it in the last 14 days. Click a face for their PRs.',
      width: 'w-20',
      hide: 'hidden lg:block',
      cell: (i, act) =>
         !act.workersLoaded ? (
            '…'
         ) : i.workers.length ? (
            <span
               className="inline-flex"
               onClick={e => {
                  // a face opens its person; the rest of the row opens the row
                  e.preventDefault();
               }}
            >
               <PeopleStack logins={i.workers.map(w => w.login)} onPerson={act.onPerson} />
            </span>
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
      title: 'Its PRs merged in the last 14 days',
      width: 'w-14',
      hide: 'hidden xl:block',
      cell: i => i.merged || '',
   },
   {
      key: 'plan',
      label: 'Plan',
      title: 'Its plan on the roadmap in a few words, the most urgent first. Amber when someone owes it something: an update, a new plan, or a decision.',
      width: 'w-32',
      hide: 'hidden md:block',
      cell: (i, act) => {
         const plan = i.plan;
         return (
            <CellButton
               onClick={() => (plan ? act.openPlan(plan.id) : act.unplanned())}
               className={i.planCell.warn ? 'text-warn' : 'text-ink-2'}
               title={planTitle(i)}
            >
               {i.planCell.text}
            </CellButton>
         );
      },
   },
];

const TARGET: Column = {
   key: 'target',
   label: 'Target',
   title: 'The date on its issue: the Target date field, or else its milestone’s due date',
   width: 'w-20',
   hide: 'hidden lg:block',
   cell: targetCell,
};

function Cells({
   item,
   act,
   columns,
}: {
   item: PortfolioItem;
   act: CellActions;
   columns: Column[];
}) {
   return (
      <>
         {columns.map(c => (
            <span
               key={c.key}
               className={`flex-none truncate text-right tabular-nums ${c.width} ${c.hide ?? ''}`}
            >
               {c.cell(item, act)}
            </span>
         ))}
      </>
   );
}

/** Everything a project row opens to: its facts and plan, who worked on it
 * lately, the open PR gone longest without activity, and its PRs. */
function RowDetail({
   item,
   opts,
   nav,
   navigate,
   onPerson,
}: {
   item: PortfolioItem;
   opts: RowOptions;
   nav: ProjectsNav;
   navigate: Navigate;
   onPerson: (login: string) => void;
}) {
   const stalest = item.stalest;
   const days = (d: number) => n(Math.round(d * 10) / 10, 'day');
   const heading = `m-0 px-3.5 pt-2.5 pb-1 text-ink-3 ${eyebrowText}`;
   return (
      <div className="border-t border-secondary">
         <ProjectFacts g={item} project={item.project}>
            <PageLink g={item} navigate={navigate} />
         </ProjectFacts>
         <PlanFacts slug={item.slug} nav={nav} navigate={navigate} />
         <div className="border-t border-secondary px-3.5 py-2 text-xs text-ink-3">
            {item.workers.length ? (
               <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>Worked on it in the last 14 days:</span>
                  {item.workers.map(w => (
                     <button
                        key={w.login}
                        type="button"
                        onClick={() => onPerson(w.login)}
                        className="pressable rounded border-0 bg-transparent p-0 text-xs text-ink-2 hover:text-brand hover:underline"
                        title={`${w.login}’s PRs`}
                     >
                        {w.login}{' '}
                        <span className="text-ink-3">
                           {w.writing <= 0
                              ? 'reviewed'
                              : w.writing >= w.days - 0.005
                              ? 'wrote'
                              : 'wrote and reviewed'}
                           , {days(w.days)}
                        </span>
                     </button>
                  ))}
               </span>
            ) : (
               'No developer worked on it in the last 14 days.'
            )}
         </div>
         {stalest && stalest.days >= STALL_DAYS && (
            <p className="m-0 border-t border-secondary px-3.5 py-2 text-xs text-ink-3">
               Longest without activity:{' '}
               <a
                  href={issueUrl(stalest.pr.repo, stalest.pr.number)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ink-2 hover:text-brand hover:underline"
               >
                  {prWords(stalest.pr)}
               </a>
               <span className={item.stage === 'parked' ? undefined : 'text-warn'}>
                  {stalest.opened
                     ? `, nothing since it opened ${stalest.days} days ago`
                     : `, nothing for ${stalest.days} days`}
               </span>
               .
            </p>
         )}
         {item.group && item.group.open.length > 0 && (
            <>
               <h4 className={`${heading} border-t border-secondary`}>Open PRs, oldest first</h4>
               <FoldRows
                  list={item.group.open}
                  opts={opts}
                  id={`portfolio:${item.slug}`}
                  cap={laneShown(8, opts)}
               />
            </>
         )}
         {item.group && item.group.merged.length > 0 && (
            <>
               <h4 className={`${heading} border-t border-secondary`}>
                  Merged in the last 14 days
               </h4>
               <Truncated cap={8} id={`portfolio-merged:${item.slug}`}>
                  {item.group.merged.map(p => (
                     <ClosedRow key={pullKey(p)} pull={p} lastSeen={opts.lastSeen} />
                  ))}
               </Truncated>
            </>
         )}
      </div>
   );
}

const rowClass =
   'flex items-center gap-3 px-3.5 py-2 text-xs text-ink-2 transition-[background-color] duration-150 ease-out hover:bg-muted motion-reduce:transition-none';

/**
 * One project on one line. Its name opens the project page, its plan words
 * the plan, its lead narrows the list to them, and a face opens that
 * person's PRs; anywhere else opens the row in place, and a second click
 * folds it.
 */
function PortfolioRow({
   item,
   columns,
   act,
   opts,
   nav,
   navigate,
}: {
   item: PortfolioItem;
   columns: Column[];
   act: CellActions;
   opts: RowOptions;
   nav: ProjectsNav;
   navigate: Navigate;
}) {
   // the name wraps rather than truncating (text never hides on this board),
   // and flags sit under it so they can't crowd it out
   return (
      <details className="group border-t border-secondary first:border-t-0">
         <summary
            className={`${rowClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
         >
            <Icon
               icon={ChevronRight}
               size={12}
               className="flex-none text-ink-3 transition-[rotate] duration-150 ease-out group-open:rotate-90 motion-reduce:transition-none"
            />
            <span className="flex min-w-0 flex-1 flex-col items-start">
               <button
                  type="button"
                  onClick={e => {
                     // a click on the name opens the page, not the row
                     e.preventDefault();
                     navigate({ project: item.slug });
                  }}
                  className="hit pressable min-w-0 rounded border-0 bg-transparent p-0 text-left text-[13px] font-medium break-words text-ink hover:text-brand"
                  title={`${item.name}: open the project page`}
               >
                  {item.name}
               </button>
               {!!item.group?.flags.length && (
                  <span className="flex flex-wrap gap-x-2 text-[11px]">
                     <FlagWords g={item.group} />
                  </span>
               )}
            </span>
            <Cells item={item} act={act} columns={columns} />
         </summary>
         <RowDetail item={item} opts={opts} nav={nav} navigate={navigate} onPerson={act.onPerson} />
      </details>
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

const quietButton =
   'hit pressable inline-flex items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 py-1 text-[13px] text-ink-3 hover:text-brand disabled:opacity-40';

/**
 * Every project on one list. Tabs pick which (in progress by default), a
 * column header sorts, grouping splits by parent, lead or team, the find box
 * narrows by name, parent, lead or team, and a tile or a chart's bar can
 * narrow it further. What's listed is what the CSV and the copied text
 * hold. All of it rides in the URL, so a view can be shared.
 */
export function Portfolio({
   items,
   workersLoaded,
   nameOf,
   nav,
   navigate,
   opts,
   onPerson,
}: {
   items: PortfolioItem[];
   workersLoaded: boolean;
   nameOf: (slug: string) => string;
   nav: ProjectsNav;
   navigate: Navigate;
   opts: RowOptions;
   onPerson: (login: string) => void;
}) {
   const [copied, setCopied] = useState(false);
   const found = items.filter(i => matchesFind(i, nav.find));
   const inTab = found.filter(i => matchesStatus(i, nav.status));
   const shown = sortItems(
      inTab.filter(i => matchesOnly(i, nav.only)),
      nav.sort
   );
   const groups = groupItems(shown, nav.group, nameOf);
   const statusOptions: [string, string][] = STATUS_FILTERS.map(([key, label]) => [
      key,
      `${label} ${found.filter(i => matchesStatus(i, key)).length}`,
   ]);
   const columns = shown.some(i => i.target) ? [...COLUMNS, TARGET] : COLUMNS;
   const sort = parseSort(nav.sort);
   const narrowed = onlyWords(nav.only);
   const act: CellActions = {
      openPlan: id => navigate(openPlan(nav, id)),
      findLead: lead => navigate({ find: lead }),
      onPerson,
      unplanned: () =>
         navigate({
            project: null,
            view: 'roadmap',
            show: 'unplanned',
            item: null,
            week: null,
            origin: null,
         }),
      workersLoaded,
   };
   const copy = () => {
      void navigator.clipboard?.writeText(portfolioText(shown, dayOf(new Date()))).then(() => {
         setCopied(true);
         setTimeout(() => setCopied(false), 2000);
      });
   };
   const showAll = () => navigate({ find: '', only: null });
   return (
      <section id="all-projects" className="mb-7 scroll-mt-24">
         <div className="z-[5] flex flex-wrap items-center gap-x-3 gap-y-2 bg-[var(--canvas)] pb-2 sm:sticky sm:top-[var(--header-h,0px)]">
            <h2 className="m-0 text-base font-semibold leading-snug">All projects</h2>
            <Segmented
               ariaLabel="which projects"
               value={nav.status}
               options={statusOptions}
               onChange={status => navigate({ status, only: null })}
            />
            <label className="inline-flex items-center gap-2 text-xs text-ink-3">
               Group by
               <Segmented
                  ariaLabel="group by"
                  value={nav.group}
                  options={GROUPINGS.map(([k, l]) => [k, k === 'none' ? 'None' : l])}
                  onChange={group => navigate({ group })}
               />
            </label>
            <input
               type="search"
               aria-label="find a project by name, parent, lead or team"
               placeholder="Find a project"
               value={nav.find}
               onChange={e => navigate({ find: e.target.value })}
               className={`w-[180px] px-2.5 ${textInputClass}`}
            />
            <span className="flex-1" />
            <button
               type="button"
               onClick={copy}
               disabled={!shown.length}
               className={quietButton}
               title="Copy the projects listed here as plain text, for an email or a chat post: each one’s plan, its latest update, and when it last moved"
            >
               {copied ? 'Copied' : 'Copy status'}
            </button>
            <button
               type="button"
               onClick={() => download(shown)}
               disabled={!shown.length}
               className={quietButton}
               title="Download the projects listed here as a spreadsheet file (CSV)"
            >
               <Icon icon={Download} size={14} />
               CSV
            </button>
         </div>
         {narrowed && (
            <p className="m-0 mb-2 text-xs text-ink-2">
               Showing {n(shown.length, 'project')}: {narrowed}.{' '}
               <button
                  type="button"
                  onClick={() => navigate({ only: null })}
                  className="pressable rounded border-0 bg-transparent p-0 text-xs font-medium text-brand hover:underline"
               >
                  Show all
               </button>
            </p>
         )}
         <Rows>
            <div className="flex items-center gap-3 border-b border-line bg-muted/40 px-3.5 py-[7px]">
               <span className="w-3 flex-none" aria-hidden />
               <SortHeader
                  label="Project"
                  title="Its issue’s title, or else its plan’s name, or else its label"
                  sortKey="name"
                  sort={sort}
                  onSort={s => navigate({ sort: s })}
                  className="min-w-0 flex-1"
               />
               {columns.map(c => (
                  <SortHeader
                     key={c.key}
                     label={c.label}
                     title={c.title}
                     sortKey={c.key}
                     sort={sort}
                     onSort={s => navigate({ sort: s })}
                     className={`flex-none text-right ${c.width} ${c.hide ?? ''}`}
                  />
               ))}
            </div>
            {!shown.length && (
               <div className="px-3.5 py-4 text-[13px] text-ink-3">
                  {nav.find || nav.only ? (
                     <>
                        No project matches that.{' '}
                        <button
                           type="button"
                           onClick={showAll}
                           className="pressable rounded border-0 bg-transparent p-0 text-[13px] font-medium text-brand hover:underline"
                        >
                           Show all
                        </button>
                     </>
                  ) : (
                     'No projects here.'
                  )}
               </div>
            )}
            {groups.map(g => (
               <div key={g.title || 'all'}>
                  {g.title && (
                     <div
                        className={`border-t border-secondary bg-muted/40 px-3.5 py-[6px] text-ink-3 first:border-t-0 ${eyebrowText}`}
                     >
                        {g.title} <span className="tabular-nums">· {g.items.length}</span>
                     </div>
                  )}
                  <Truncated cap={LIST_CAP} id={`portfolio:${nav.status}:${g.title}`}>
                     {g.items.map(item => (
                        <PortfolioRow
                           key={`${g.title}:${item.slug}`}
                           item={item}
                           columns={columns}
                           act={act}
                           opts={opts}
                           nav={nav}
                           navigate={navigate}
                        />
                     ))}
                  </Truncated>
               </div>
            ))}
         </Rows>
      </section>
   );
}
