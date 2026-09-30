import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Download } from 'lucide-react';
import { Segmented, textInputClass } from '../../components/bits';
import { Icon } from '../../components/Icon';
import { eyebrowText, FoldRows, laneShown, Rows } from '../../components/Lane';
import type { RowOptions } from '../../components/Row';
import {
   GROUPINGS,
   matchesFind,
   matchesStatus,
   parseSort,
   portfolioCsv,
   sortItems,
   STATUS_FILTERS,
   groupItems,
   statusWord,
   type PortfolioItem,
   type SortKey,
} from '../../model/portfolio';
import { dayWords } from '../../model/projectData';
import {
   FlagWords,
   openPlan,
   PageLink,
   ProjectFacts,
   type Navigate,
   type ProjectsNav,
} from './parts';
import { planCellWords } from './roadmapHealth';

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

const num = (n: number | null | undefined) => (n == null ? '' : n);

function targetCell(item: PortfolioItem): ReactNode {
   if (!item.target) return '';
   const due = item.target.due_on ? dayWords(item.target.due_on) : item.target.title;
   const open = item.status === 'live' || item.status === 'quiet';
   const late = open && item.dueInDays != null && item.dueInDays < 0;
   const when =
      item.dueInDays == null
         ? item.target.title
         : late
         ? `${-item.dueInDays} days past ${item.target.title}`
         : `${item.target.title}, in ${item.dueInDays} days`;
   // past due on a project still open is the one thing here someone owes
   return (
      <span className={late ? 'text-warn' : undefined} title={when}>
         {due}
      </span>
   );
}

const COLUMNS: Column[] = [
   {
      key: 'status',
      label: 'Status',
      title: 'Live: an open PR or a merge in the last 14 days. Quiet: open, nothing in flight.',
      width: 'w-16',
      cell: i => statusWord(i.status),
   },
   {
      key: 'plan',
      label: 'Plan',
      title: 'How its roadmap item is going: the latest update, or its status. Blank when it isn’t on the roadmap.',
      width: 'w-20',
      hide: 'hidden md:block',
      cell: (i, act) => {
         const plan = i.plan;
         if (!plan) return '';
         const words = planCellWords(plan);
         return (
            <CellButton
               onClick={() => act.openPlan(plan.id)}
               className={words.warn ? 'text-warn' : 'text-ink-2'}
               title={`${words.title}. Click to open it on the roadmap.`}
            >
               {words.text}
            </CellButton>
         );
      },
   },
   {
      key: 'lead',
      label: 'Lead',
      title: 'The assignee on the project’s issue',
      width: 'w-24',
      hide: 'hidden md:block',
      cell: (i, act) => {
         const lead = i.lead;
         return lead ? (
            <CellButton
               onClick={() => act.findLead(lead)}
               className="text-ink-2"
               title={`Show only ${lead}’s projects`}
            >
               {lead}
            </CellButton>
         ) : (
            ''
         );
      },
   },
   {
      key: 'target',
      label: 'Target',
      title: 'The due date of the milestone on the project’s issue',
      width: 'w-20',
      hide: 'hidden md:block',
      cell: targetCell,
   },
   {
      key: 'people',
      label: 'Devs · others',
      title: 'People with an open PR or a merge in the last 14 days: on a developer team, and everyone else',
      width: 'w-20',
      cell: i =>
         i.developers.length + i.nonDevelopers.length ? (
            <span title={[...i.developers, ...i.nonDevelopers].join(', ')}>
               {i.developers.length} · {i.nonDevelopers.length}
            </span>
         ) : (
            ''
         ),
   },
   {
      key: 'open',
      label: 'Open',
      title: 'Open PRs now',
      width: 'w-12',
      cell: i => num(i.open || null),
   },
   {
      key: 'waiting',
      label: 'Waiting',
      title: 'Open PRs waiting on a CR or QA',
      width: 'w-14',
      cell: i => num(i.waiting || null),
   },
   {
      key: 'merged',
      label: 'Merged',
      title: 'PRs merged in the date range',
      width: 'w-14',
      cell: i => num(i.window?.merged || null),
   },
   {
      key: 'toMerge',
      label: 'Days to merge',
      title: 'Median days from opened to merged, over the PRs merged in the date range',
      width: 'w-20',
      hide: 'hidden lg:block',
      cell: i => num(i.window?.median_days_to_merge),
   },
   {
      key: 'idle',
      label: 'Stalest',
      title: 'Days the open PR that has gone longest without a change has sat',
      width: 'w-14',
      hide: 'hidden lg:block',
      // under a day is nothing to say
      cell: i => (i.idleDays ? `${i.idleDays}d` : ''),
   },
];

function Cells({ item, act }: { item: PortfolioItem; act: CellActions }) {
   return (
      <>
         {COLUMNS.map(c => (
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

const rowClass =
   'flex items-center gap-3 px-3.5 py-2 text-xs text-ink-2 transition-[background-color] duration-150 ease-out hover:bg-muted motion-reduce:transition-none';

/**
 * One project on one line. Its name opens the project page; anywhere else
 * on the row opens its PRs in place, board rows and all. A project with
 * nothing open has nothing to open, so it's a plain line.
 */
function PortfolioRow({
   item,
   hasRepo,
   opts,
   nav,
   navigate,
}: {
   item: PortfolioItem;
   hasRepo: boolean;
   opts: RowOptions;
   nav: ProjectsNav;
   navigate: Navigate;
}) {
   const act: CellActions = {
      openPlan: id => navigate(openPlan(nav, id)),
      findLead: lead => navigate({ find: lead }),
   };
   // the name wraps rather than truncating (text never hides on this board),
   // and flags sit under it so they can't crowd it out
   const name = (
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
   );
   if (!item.group?.open.length) {
      return (
         <div className={`${rowClass} border-t border-secondary first:border-t-0`}>
            <span className="w-3 flex-none" aria-hidden />
            {name}
            <Cells item={item} act={act} />
         </div>
      );
   }
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
            {name}
            <Cells item={item} act={act} />
         </summary>
         <div className="border-t border-secondary">
            <ProjectFacts g={item} project={item.project} hasRepo={hasRepo}>
               <PageLink g={item} navigate={navigate} />
            </ProjectFacts>
            <FoldRows
               list={item.group.open}
               opts={opts}
               id={`portfolio:${item.slug}`}
               cap={laneShown(8, opts)}
            />
         </div>
      </details>
   );
}

/** A column header that sorts by its column; a second click reverses it. */
function SortHeader({
   label,
   title,
   sortKey,
   sort,
   className,
   navigate,
}: {
   label: string;
   title: string;
   sortKey: SortKey;
   sort: string;
   className: string;
   navigate: Navigate;
}) {
   const current = parseSort(sort);
   const active = current.key === sortKey;
   return (
      <button
         type="button"
         title={title}
         aria-sort={active ? (current.reversed ? 'ascending' : 'descending') : undefined}
         onClick={() => navigate({ sort: active && !current.reversed ? `-${sortKey}` : sortKey })}
         className={`pressable inline-flex items-center gap-1 rounded border-0 bg-transparent p-0 ${eyebrowText} ${
            active ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
         } ${className}`}
      >
         {label}
         {active && <Icon icon={current.reversed ? ArrowUp : ArrowDown} size={12} />}
      </button>
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

/**
 * Every project on one list: the portfolio view a planner starts from. Tabs
 * pick which projects (live by default), a column header sorts, grouping
 * splits by parent, lead or team, and the find box narrows by name, parent
 * or lead. What's listed is what the CSV holds. All of it rides in the URL,
 * so a view can be shared.
 */
export function Portfolio({
   items,
   teamOf,
   nameOf,
   hasRepo,
   nav,
   navigate,
   opts,
}: {
   items: PortfolioItem[];
   teamOf: (login: string) => string | null;
   nameOf: (slug: string) => string;
   hasRepo: boolean;
   nav: ProjectsNav;
   navigate: Navigate;
   opts: RowOptions;
}) {
   const found = items.filter(i => matchesFind(i, nav.find));
   const shown = sortItems(
      found.filter(i => matchesStatus(i, nav.status)),
      nav.sort
   );
   const groups = groupItems(shown, nav.group, teamOf, nameOf);
   const statusOptions: [string, string][] = STATUS_FILTERS.map(([key, label]) => [
      key,
      `${label} ${found.filter(i => matchesStatus(i, key)).length}`,
   ]);
   return (
      <section id="all-projects" className="mb-7 scroll-mt-24">
         <div className="sticky top-[var(--header-h,0px)] z-[5] flex flex-wrap items-center gap-x-3 gap-y-2 bg-[var(--canvas)] pb-2">
            <h2 className="m-0 text-base font-semibold leading-snug">All projects</h2>
            <Segmented
               ariaLabel="which projects"
               value={nav.status}
               options={statusOptions}
               onChange={status => navigate({ status })}
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
               aria-label="find a project by name, parent, or lead"
               placeholder="Find a project"
               value={nav.find}
               onChange={e => navigate({ find: e.target.value })}
               className={`w-[180px] px-2.5 ${textInputClass}`}
            />
            <span className="flex-1" />
            <button
               type="button"
               onClick={() => download(shown)}
               disabled={!shown.length}
               className="hit pressable inline-flex items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 py-1 text-[13px] text-ink-3 hover:text-brand disabled:opacity-40"
               title="Download the projects listed here as a spreadsheet file (CSV)"
            >
               <Icon icon={Download} size={14} />
               CSV
            </button>
         </div>
         <Rows>
            <div className="flex items-center gap-3 border-b border-line bg-muted/40 px-3.5 py-[7px]">
               <span className="w-3 flex-none" aria-hidden />
               <SortHeader
                  label="Project"
                  title="The project’s name, from its issue"
                  sortKey="name"
                  sort={nav.sort}
                  className="min-w-0 flex-1"
                  navigate={navigate}
               />
               {COLUMNS.map(c => (
                  <SortHeader
                     key={c.key}
                     label={c.label}
                     title={c.title}
                     sortKey={c.key}
                     sort={nav.sort}
                     className={`flex-none justify-end ${c.width} ${c.hide ?? ''}`}
                     navigate={navigate}
                  />
               ))}
            </div>
            {!shown.length && (
               <div className="px-3.5 py-4 text-[13px] text-ink-3">
                  {nav.find ? 'No project matches that.' : 'No projects in this list.'}
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
                  {g.items.map(item => (
                     <PortfolioRow
                        key={`${g.title}:${item.slug}`}
                        item={item}
                        hasRepo={hasRepo}
                        opts={opts}
                        nav={nav}
                        navigate={navigate}
                     />
                  ))}
               </div>
            ))}
         </Rows>
      </section>
   );
}
