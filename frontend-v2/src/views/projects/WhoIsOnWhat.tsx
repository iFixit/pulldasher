import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { n } from '../../../../shared/format';
import type { Today } from '../../../../shared/model/projects';
import { Icon } from '../../components/Icon';
import { Rows } from '../../components/Lane';
import { agoWords, type PortfolioItem } from '../../model/portfolio';
import { resolveRange, type Range } from '../../model/projectData';
import {
   loadByPerson,
   median,
   overloadLine,
   retroRows,
   type PersonLoad,
   type RetroRow,
} from '../../model/retro';
import { useRetroData } from '../../model/retroData';
import { PersonCell } from '../stats/parts';
import { readSort, SortHeader, type Navigate, type ProjectsNav } from './parts';

/** the window this table counts, in days */
export const WHO_DAYS = 14;

/**
 * Who is on what over the last 14 days, for the Overview and People: the
 * days' rows, one load per developer (every developer on a team, spelled
 * the way their PRs spell them; with no teams, everyone with days), and
 * the overload line with the median it comes from. `who` is undefined
 * while the days load, and null when they failed.
 */
export function useWhoIsOnWhat(
   teams: Record<string, string[]> | undefined,
   today: Today,
   teamOf: (login: string) => string | null
): {
   rows: RetroRow[] | null;
   who: WhoRow[] | null | undefined;
   line: number;
   middle: number;
} {
   const retro = useRetroData(resolveRange(`${WHO_DAYS}d`) as Range);
   const rows = useMemo(() => (retro ? retroRows(retro) : null), [retro]);
   const who = useMemo((): WhoRow[] | null | undefined => {
      if (retro === null) return null;
      if (!retro || !rows) return undefined;
      const spelled = new Map(retro.people.map(l => [l.toLowerCase(), l]));
      const onTeams = Object.values(teams ?? {}).flat();
      const logins = onTeams.length
         ? onTeams.map(l => spelled.get(l.toLowerCase()) ?? l)
         : retro.people;
      const unique = [...new Map(logins.map(l => [l.toLowerCase(), l])).values()];
      const openBy = new Map<string, number>();
      for (const p of [...today.live.flatMap(g => g.open), ...today.misc, ...today.unsorted]) {
         const key = p.data.user.login.toLowerCase();
         openBy.set(key, (openBy.get(key) ?? 0) + 1);
      }
      return loadByPerson(rows, unique).map(load => ({
         ...load,
         team: teamOf(load.login),
         open: openBy.get(load.login.toLowerCase()) ?? 0,
      }));
   }, [retro, rows, teams, today, teamOf]);
   const counts = who?.map(r => r.projects.length) ?? [];
   return { rows, who, line: overloadLine(counts), middle: median(counts) };
}

type WhoKey =
   | 'name'
   | 'projects'
   | 'wrote'
   | 'reviewed'
   | 'days'
   | 'reviewing'
   | 'unfiled'
   | 'open';
const WHO_KEYS: WhoKey[] = [
   'name',
   'projects',
   'wrote',
   'reviewed',
   'days',
   'reviewing',
   'unfiled',
   'open',
];

export interface WhoRow extends PersonLoad {
   team: string | null;
   /** their open PRs now, drafts included */
   open: number;
}

const share = (part: number, whole: number) => (whole ? part / whole : 0);
const pct = (part: number, whole: number) => `${Math.round(100 * share(part, whole))}%`;

/** Names A to Z; everything else most first. */
const SORTS: Record<WhoKey, (a: WhoRow, b: WhoRow) => number> = {
   name: (a, b) => a.login.localeCompare(b.login),
   projects: (a, b) => b.projects.length - a.projects.length,
   wrote: (a, b) => b.wrote - a.wrote,
   reviewed: (a, b) => b.reviewed - a.reviewed,
   days: (a, b) => b.days - a.days,
   reviewing: (a, b) => share(b.reviewing, b.days) - share(a.reviewing, a.days),
   unfiled: (a, b) => share(b.unfiled, b.days) - share(a.unfiled, a.days),
   open: (a, b) => b.open - a.open,
};

interface Column {
   key: WhoKey;
   label: string;
   title: string;
   width: string;
   hide?: string;
}

const COLUMNS: Column[] = [
   {
      key: 'wrote',
      label: 'Wrote on',
      title: 'Projects they wrote PRs for in the last 14 days',
      width: 'w-16',
      hide: 'hidden md:block',
   },
   {
      key: 'reviewed',
      label: 'Reviewed on',
      title: 'Projects where they reviewed, stamped or commented on someone else’s PRs in the last 14 days',
      width: 'w-20',
      hide: 'hidden md:block',
   },
   {
      key: 'days',
      label: 'Days',
      title: 'Of the last 14 days, the days they opened a PR, had one merged, or commented on, stamped or reviewed one',
      width: 'w-16',
   },
   {
      key: 'reviewing',
      label: 'Reviewing',
      title: 'The share of their days spent on other people’s PRs',
      width: 'w-20',
      hide: 'hidden lg:block',
   },
   {
      key: 'unfiled',
      label: 'Not filed',
      title: 'The share of their days spent on PRs with no project label. Those days count toward no project here.',
      width: 'w-16',
      hide: 'hidden lg:block',
   },
   {
      key: 'open',
      label: 'Open PRs',
      title: 'Their open PRs now, drafts included',
      width: 'w-16',
      hide: 'hidden sm:block',
   },
];

function cell(row: WhoRow, key: WhoKey): string {
   if (key === 'days') return row.days ? `${Math.round(row.days)} of ${WHO_DAYS}` : '';
   if (key === 'reviewing') return row.days ? pct(row.reviewing, row.days) : '';
   if (key === 'unfiled') return row.days ? pct(row.unfiled, row.days) : '';
   if (key === 'wrote') return row.wrote ? String(row.wrote) : '';
   if (key === 'reviewed') return row.reviewed ? String(row.reviewed) : '';
   if (key === 'open') return row.open ? String(row.open) : '';
   return '';
}

const days = (d: number) => n(Math.round(d * 10) / 10, 'day');

/** A person's projects, opened in place: each one's name, what they did on
 * it, their days there, when anyone last worked on it, and its plan. */
function Detail({
   row,
   items,
   nameOf,
   navigate,
}: {
   row: WhoRow;
   items: ReadonlyMap<string, PortfolioItem>;
   nameOf: (slug: string) => string;
   navigate: Navigate;
}) {
   const filed = row.projects.reduce((sum, p) => sum + p.days, 0);
   const oneOffs = row.days - filed - row.unfiled;
   const rest = [
      oneOffs >= 0.05 ? `${days(oneOffs)} on one-offs` : null,
      row.unfiled >= 0.05 ? `${days(row.unfiled)} on PRs with no project` : null,
   ].filter(Boolean);
   return (
      <div className="border-t border-secondary bg-muted/30 px-3.5 py-3 pl-9 text-xs">
         {!row.days ? (
            <p className="m-0 text-ink-3">No PR activity in the last {WHO_DAYS} days.</p>
         ) : !row.projects.length ? (
            <p className="m-0 text-ink-3">
               No work filed to a project in the last {WHO_DAYS} days: {rest.join(', ')}.
            </p>
         ) : (
            <>
               <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {row.projects.map(p => {
                     const item = items.get(p.slug);
                     const role =
                        p.writing <= 0
                           ? 'reviewed'
                           : p.writing >= p.days - 0.005
                           ? 'wrote'
                           : 'wrote and reviewed';
                     return (
                        <li
                           key={p.slug}
                           className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 sm:grid-cols-[minmax(0,1fr)_9rem_4.5rem_9rem_8rem]"
                        >
                           <button
                              type="button"
                              onClick={() => navigate({ project: p.slug })}
                              className="pressable min-w-0 rounded border-0 bg-transparent p-0 text-left text-xs break-words text-ink hover:text-brand hover:underline"
                              title="Open the project page"
                           >
                              {nameOf(p.slug)}
                           </button>
                           <span className="text-ink-3">{role}</span>
                           <span className="hidden text-right text-ink-2 tabular-nums sm:block">
                              {days(p.days)}
                           </span>
                           <span className="hidden text-ink-3 sm:block">
                              {item?.lastActivity
                                 ? `last activity ${agoWords(item.lastActivity.days)}`
                                 : ''}
                           </span>
                           <span
                              className={`hidden sm:block ${
                                 item?.planCell.warn ? 'text-warn' : 'text-ink-3'
                              }`}
                           >
                              {item?.planCell.text ?? ''}
                           </span>
                        </li>
                     );
                  })}
               </ul>
               {rest.length > 0 && (
                  <p className="m-0 mt-2 text-ink-3">Also {rest.join(' and ')}.</p>
               )}
            </>
         )}
      </div>
   );
}

/**
 * Who is on what over the last 14 days: one row per developer, every one
 * shown, sorted by how many projects they wrote or reviewed on. The bar on
 * each row counts those projects on one scale for everyone, dark for the
 * ones they wrote on and light for the ones they only reviewed, with a
 * thin mark at the overload line. A row opens their projects in place.
 */
export function WhoIsOnWhat({
   rows,
   line,
   middle,
   items,
   nameOf,
   me,
   onPerson,
   nav,
   navigate,
}: {
   /** undefined while the days load, null when they failed */
   rows: WhoRow[] | null | undefined;
   /** this many projects or more is overloaded (retro.ts overloadLine) */
   line: number;
   /** the median it's drawn from */
   middle: number;
   items: ReadonlyMap<string, PortfolioItem>;
   nameOf: (slug: string) => string;
   me: string;
   onPerson: (login: string) => void;
   nav: ProjectsNav;
   navigate: Navigate;
}) {
   const sort = readSort<WhoKey>(nav.psort, WHO_KEYS, 'projects');
   const sorted = rows
      ? [...rows].sort((a, b) => {
           const by = SORTS[sort.key](a, b);
           return (sort.reversed ? -by : by) || SORTS.days(a, b) || SORTS.name(a, b);
        })
      : [];
   const top = Math.max(line, ...sorted.map(r => r.projects.length));
   const onSort = (psort: string) => navigate({ psort });
   return (
      <section id="who-is-on-what" className="scroll-mt-24">
         <h2 className="m-0 text-base font-semibold leading-snug">Who is on what, last 14 days</h2>
         <p className="m-0 mt-1 mb-2 max-w-[80ch] text-xs text-ink-3">
            Each bar counts the projects someone wrote PRs for (dark) or only reviewed (light).
            Reaching the thin mark, {line} projects, turns it amber: overloaded. The mark is twice
            the developers’ median of {Math.round(middle * 10) / 10}, and never under 4.
         </p>
         {rows === undefined ? (
            <p className="m-0 text-[13px] text-ink-3">Adding up the last 14 days…</p>
         ) : rows === null ? (
            <p className="m-0 text-[13px] text-warn">
               Couldn’t load the last 14 days. Try again in a minute.
            </p>
         ) : (
            <Rows>
               <div className="flex items-center gap-3 border-b border-line bg-muted/40 px-3.5 py-[7px]">
                  <span className="w-3 flex-none" aria-hidden />
                  <SortHeader
                     label="Person"
                     title="Developers, from the developer teams"
                     sortKey="name"
                     sort={sort}
                     onSort={onSort}
                     className="min-w-0 flex-1"
                  />
                  <SortHeader
                     label="Projects"
                     title={`Projects they wrote or reviewed PRs on in the last 14 days. ${line} or more is overloaded.`}
                     sortKey="projects"
                     sort={sort}
                     onSort={onSort}
                     className="w-24 flex-none sm:w-36"
                  />
                  {COLUMNS.map(c => (
                     <SortHeader
                        key={c.key}
                        label={c.label}
                        title={c.title}
                        sortKey={c.key}
                        sort={sort}
                        onSort={onSort}
                        className={`flex-none text-right ${c.width} ${c.hide ?? ''}`}
                     />
                  ))}
               </div>
               {sorted.map(row => {
                  const over = row.projects.length >= line;
                  const width = (count: number) => `${(count / top) * 100}%`;
                  return (
                     <details
                        key={row.login}
                        className="group border-t border-secondary first:border-t-0"
                     >
                        <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-2 text-xs text-ink-2 hover:bg-muted [&::-webkit-details-marker]:hidden">
                           <Icon
                              icon={ChevronRight}
                              size={12}
                              className="flex-none text-ink-3 transition-[rotate] duration-150 ease-out group-open:rotate-90 motion-reduce:transition-none"
                           />
                           <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
                              <PersonCell login={row.login} me={me} onPerson={onPerson} />
                              {row.team && (
                                 <span className="hidden flex-none text-xs text-ink-3 sm:inline">
                                    {row.team}
                                 </span>
                              )}
                           </span>
                           <span
                              className="flex w-24 flex-none items-center gap-2 sm:w-36"
                              title={`${n(row.wrote, 'project')} written on, ${
                                 row.reviewedOnly
                              } only reviewed${over ? `. Overloaded: ${line} or more.` : ''}`}
                           >
                              <span className="relative flex h-2.5 flex-1 gap-[2px]" aria-hidden>
                                 {row.wrote > 0 && (
                                    <span
                                       className={`h-full rounded-sm ${
                                          over ? 'bg-warn' : 'bg-brand'
                                       }`}
                                       style={{ width: width(row.wrote) }}
                                    />
                                 )}
                                 {row.reviewedOnly > 0 && (
                                    <span
                                       className={`h-full rounded-sm ${
                                          over ? 'bg-warn/40' : 'bg-brand/40'
                                       }`}
                                       style={{ width: width(row.reviewedOnly) }}
                                    />
                                 )}
                                 <span
                                    className="absolute -top-0.5 -bottom-0.5 w-px bg-ink-3/60"
                                    style={{ left: width(line) }}
                                 />
                              </span>
                              <span
                                 className={`w-5 text-right tabular-nums ${
                                    over ? 'font-semibold text-warn' : 'text-ink'
                                 }`}
                              >
                                 {row.projects.length}
                              </span>
                           </span>
                           {COLUMNS.map(c => (
                              <span
                                 key={c.key}
                                 className={`flex-none text-right tabular-nums ${c.width} ${
                                    c.hide ?? ''
                                 }`}
                              >
                                 {cell(row, c.key)}
                              </span>
                           ))}
                        </summary>
                        <Detail row={row} items={items} nameOf={nameOf} navigate={navigate} />
                     </details>
                  );
               })}
               {!sorted.length && (
                  <div className="px-3.5 py-4 text-[13px] text-ink-3">
                     No developers yet. Add the developer teams on the People view.
                  </div>
               )}
            </Rows>
         )}
      </section>
   );
}
