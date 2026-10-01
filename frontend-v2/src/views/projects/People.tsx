import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronRight, Plus, X } from 'lucide-react';
import { n } from '../../../../shared/format';
import type { PersonWindow, Today, WeekPoint } from '../../../../shared/model/projects';
import type { DeveloperTeams } from '../../../../shared/model/settings';
import { LoadFailed, PrimaryButton, textInputClass } from '../../components/bits';
import { Icon } from '../../components/Icon';
import { Fold, foldDomId, GroupHeader, openFold, Rows, SubDoor } from '../../components/Lane';
import { useArmedConfirm } from '../../components/useArmedConfirm';
import { agoWords, type PortfolioItem } from '../../model/portfolio';
import {
   chartWindow,
   dayWords,
   rangeDays,
   rangeWords,
   refreshProjectsData,
   useProjectsData,
   type ProjectsData,
   type Range,
} from '../../model/projectData';
import { beforeWords, OVERLOAD_MIN } from '../../model/retro';
import { retryRetroData } from '../../model/retroData';
import { saveDeveloperTeams } from '../../model/settingsData';
import { days, daysShort, NOT_IN_A_PROJECT } from '../../model/words';
import { PersonCell, StatsCard } from '../stats/parts';
import { ChartSlot, SplitWeeksChart } from './lazyCharts';
import {
   NarrowChip,
   readSort,
   SortHeader,
   Tile,
   versus,
   type Navigate,
   type ProjectsNav,
} from './parts';
import { useWhoIsOnWhat, type WhoRow } from './WhoIsOnWhat';

/** the non-developers' fold, which a tile opens */
const NON_DEVS = 'people:non-developers';

/** Bring a part of the page into view, under the sticky header. */
const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ block: 'start' });

/**
 * The developer teams, and the way to change them: who counts as a developer,
 * and on which team, for every developer count in the tab and the load line
 * on the roadmap. Saved here, they replace config.js's list for everyone;
 * "Go back to config.js" drops them. A login with no PR or stamp behind it is
 * pointed out as it's typed, since a typo would quietly make someone a
 * non-developer.
 */
function TeamsSection({
   teams,
   from,
   known,
}: {
   teams: DeveloperTeams;
   from: 'saved' | 'config';
   /** every login the range or the board has seen, in lowercase */
   known: ReadonlySet<string>;
}) {
   // [name, members as typed], one per team, while editing
   const [draft, setDraft] = useState<[string, string][] | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [saving, setSaving] = useState(false);
   const [saved, setSaved] = useState(false);
   const { armed, run } = useArmedConfirm();
   const editRef = useRef<HTMLButtonElement>(null);
   const formRef = useRef<HTMLFormElement>(null);
   // focus follows the editor: into its first field when it opens, and back
   // to Edit teams when a save or Cancel closes it, never to the page's top
   const editing = draft != null;
   const wasEditing = useRef(editing);
   useEffect(() => {
      if (editing !== wasEditing.current) {
         (editing ? formRef.current?.querySelector('input') : editRef.current)?.focus();
      }
      wasEditing.current = editing;
   }, [editing]);
   const names = Object.keys(teams);
   const save = async (value: DeveloperTeams | null) => {
      setSaving(true);
      const result = await saveDeveloperTeams(value);
      setSaving(false);
      if ('error' in result) return setError(result.error);
      setError(null);
      setSaved(true);
      setDraft(null);
   };
   const typed = (): DeveloperTeams =>
      Object.fromEntries(
         (draft ?? [])
            .filter(([name]) => name.trim())
            .map(([name, members]) => [name, members.split(/[\s,]+/).filter(Boolean)])
      );
   const setRow = (i: number, row: [string, string]) =>
      setDraft(d => (d ?? []).map((old, j) => (j === i ? row : old)));
   return (
      <section>
         <GroupHeader
            title="Developer teams"
            sub={
               <SubDoor
                  label="What the developer teams do"
                  text={from === 'saved' ? 'saved here' : 'from config.js'}
               >
                  <p className="m-0">
                     Who counts as a developer, and on which team. Everyone else is a non-developer.
                  </p>
                  <p className="m-0">
                     The teams set every developer count in Projects and the developer line on the
                     roadmap. Saved here, they replace config.js’s teams for everyone.
                  </p>
               </SubDoor>
            }
            headerExtra={
               <>
                  {/* the receipt sits where focus comes back to, and is read out */}
                  <span role="status" className="inline-flex items-center gap-1 text-xs text-ink-2">
                     {saved && !editing && (
                        <>
                           <Icon icon={Check} size={14} />
                           Saved
                        </>
                     )}
                  </span>
                  {!editing && (
                     <button
                        ref={editRef}
                        type="button"
                        onClick={() => {
                           setSaved(false);
                           setDraft(
                              names.length ? names.map(t => [t, teams[t].join(', ')]) : [['', '']]
                           );
                        }}
                        className="hit pressable rounded border-0 bg-transparent p-0 text-xs font-medium text-brand hover:underline"
                     >
                        Edit teams
                     </button>
                  )}
               </>
            }
         />
         <StatsCard>
            {!draft ? (
               names.length ? (
                  <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
                     {names.map(team => (
                        <li key={team}>
                           <span className="font-medium text-ink">{team}</span>
                           <span className="text-ink-3">
                              {' '}
                              · {n(teams[team].length, 'developer')}
                           </span>
                           <span className="text-ink-2"> {teams[team].join(', ')}</span>
                        </li>
                     ))}
                  </ul>
               ) : (
                  <p className="m-0 text-[13px] text-ink-3">
                     None yet, so everyone counts as a non-developer.
                  </p>
               )
            ) : (
               <form
                  ref={formRef}
                  className="flex flex-col gap-2"
                  onSubmit={e => {
                     e.preventDefault();
                     void save(typed());
                  }}
               >
                  {draft.map(([name, members], i) => {
                     const unknown = members
                        .split(/[\s,]+/)
                        .filter(login => login && !known.has(login.toLowerCase()));
                     return (
                        <div key={i} className="flex flex-wrap items-start gap-2">
                           <input
                              aria-label="team name"
                              className={`w-40 px-2.5 ${textInputClass}`}
                              value={name}
                              maxLength={64}
                              placeholder="Team name"
                              onChange={e => setRow(i, [e.target.value, members])}
                           />
                           <textarea
                              aria-label={`${name || 'this team'}’s developers`}
                              className="min-h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px]"
                              value={members}
                              rows={1}
                              placeholder="GitHub logins, separated by commas or spaces"
                              onChange={e => setRow(i, [name, e.target.value])}
                           />
                           <button
                              type="button"
                              aria-label={`Remove ${name || 'this team'}`}
                              title="Remove this team"
                              onClick={() => setDraft(d => (d ?? []).filter((_, j) => j !== i))}
                              className="hit pressable mt-1.5 rounded border-0 bg-transparent p-0 text-ink-3 hover:text-ink"
                           >
                              <Icon icon={X} size={14} />
                           </button>
                           {unknown.length > 0 && (
                              <p className="m-0 basis-full text-xs text-ink-3">
                                 No PRs or stamps from {unknown.join(', ')} in this range.
                              </p>
                           )}
                        </div>
                     );
                  })}
                  <button
                     type="button"
                     onClick={() => setDraft(d => [...(d ?? []), ['', '']])}
                     className="hit pressable inline-flex items-center gap-1 self-start rounded border-0 bg-transparent p-0 text-xs font-medium text-brand hover:underline"
                  >
                     <Icon icon={Plus} size={13} />
                     Add a team
                  </button>
                  <div className="mt-1 flex flex-wrap items-center gap-3">
                     <PrimaryButton disabled={saving}>Save teams</PrimaryButton>
                     <button
                        type="button"
                        onClick={() => {
                           setDraft(null);
                           setError(null);
                        }}
                        className="hit pressable rounded border-0 bg-transparent p-0 text-xs text-ink-3 hover:text-ink"
                     >
                        Cancel
                     </button>
                     <span role="status" className="text-xs text-ink-2">
                        {error}
                     </span>
                     <span className="flex-1" />
                     {from === 'saved' && (
                        <button
                           type="button"
                           onClick={() => run(() => save(null))}
                           className={`hit pressable rounded border-0 bg-transparent p-0 text-xs ${
                              armed ? 'font-medium text-ink' : 'text-ink-3 hover:text-ink'
                           }`}
                        >
                           {armed ? 'Click again to use config.js’s teams' : 'Go back to config.js'}
                        </button>
                     )}
                  </div>
               </form>
            )}
         </StatsCard>
      </section>
   );
}

/** One person on the list: their team, their days in the range, and their
 * PRs and stamps in it. */
export interface PersonRow {
   login: string;
   team: string | null;
   /** their days and projects in the range; null when the days don't count
    * them (a non-developer, once there are teams) */
   load: WhoRow | null;
   /** their PRs and stamps in the range; null with neither */
   w: PersonWindow | null;
}

/**
 * Everyone the tab knows about: every developer on a team (an idle developer
 * is news too), anyone else with a PR or a stamp in the range, and the person
 * picked anywhere in the tab, so their row is always there to open. One row
 * per person, whatever case a login arrives in: GitHub logins ignore case.
 */
export function peopleRows(
   data: Pick<ProjectsData, 'teams' | 'window'>,
   teamOf: (login: string) => string | null,
   loads: readonly WhoRow[],
   picked: string | null
): PersonRow[] {
   const lower = (login: string) => login.toLowerCase();
   const windows = new Map(Object.entries(data.window.people).map(([l, w]) => [lower(l), w]));
   const loadOf = new Map(loads.map(l => [lower(l.login), l]));
   // the spellings their PRs use come first, so a team typed in lowercase
   // still shows each login the way GitHub does
   const logins = new Map<string, string>();
   for (const login of [
      ...loads.map(l => l.login),
      ...Object.keys(data.window.people),
      ...Object.values(data.teams).flat(),
      ...(picked ? [picked] : []),
   ]) {
      if (!logins.has(lower(login))) logins.set(lower(login), login);
   }
   return [...logins].map(([key, login]) => ({
      login,
      team: teamOf(login),
      load: loadOf.get(key) ?? null,
      w: windows.get(key) ?? null,
   }));
}

type PersonKey =
   | 'name'
   | 'projects'
   | 'days'
   | 'reviewing'
   | 'open'
   | 'opened'
   | 'merged'
   | 'stamps'
   | 'nondev';
const PERSON_KEYS: PersonKey[] = [
   'name',
   'projects',
   'days',
   'reviewing',
   'open',
   'opened',
   'merged',
   'stamps',
   'nondev',
];

/** A row's number in a column: -1 where the days don't count them, so they
 * sort after a zero. */
function valueOf(row: PersonRow, key: Exclude<PersonKey, 'name'>): number {
   const { load, w } = row;
   switch (key) {
      case 'projects':
         return load ? load.projects.length : -1;
      case 'days':
         return load ? load.days : -1;
      case 'reviewing':
         return load ? (load.days ? load.reviewing / load.days : 0) : -1;
      case 'open':
         return w?.backlog_end ?? 0;
      case 'opened':
         return w?.opened ?? 0;
      case 'merged':
         return w?.merged ?? 0;
      case 'stamps':
         return w?.reviews ?? 0;
      case 'nondev':
         return w?.reviews_on_non_dev ?? 0;
   }
}

/** Names A to Z and every number most first, or the other way round; ties
 * go to the most open PRs, then the most stamps, then the name. */
export function sortPeople(
   rows: readonly PersonRow[],
   sort: { key: PersonKey; reversed: boolean }
): PersonRow[] {
   const by = (key: PersonKey) => (a: PersonRow, b: PersonRow) =>
      key === 'name' ? a.login.localeCompare(b.login) : valueOf(b, key) - valueOf(a, key);
   return [...rows].sort((a, b) => {
      const first = by(sort.key)(a, b);
      return (
         (sort.reversed ? -first : first) ||
         by('open')(a, b) ||
         by('stamps')(a, b) ||
         by('name')(a, b)
      );
   });
}

/** On the overload line's number of projects or more, in the range. */
const isOver = (row: PersonRow, line: number) => !!row.load && row.load.projects.length >= line;

interface Column {
   key: Exclude<PersonKey, 'name'>;
   label: string;
   title: string;
   width: string;
   /** the screen width it shows from; the columns that matter least go first */
   hide?: string;
   /** counted from the days, which count developers only */
   fromDays?: boolean;
}

/** Every column, each over the picked range. With no teams every PR is a
 * non-developer's, so the split by whose PR it was says nothing. */
function columnsFor(range: Range, line: number, hasTeams: boolean): Column[] {
   const all: Column[] = [
      {
         key: 'projects',
         label: 'Projects',
         title: `Projects they wrote or reviewed PRs on, one-offs left out. ${line} or more is overloaded.`,
         width: 'w-20',
         fromDays: true,
      },
      {
         key: 'days',
         label: 'Days',
         title: `Of the ${rangeDays(
            range
         )} days, the days they opened a PR, had one merged, or commented on, stamped or reviewed one`,
         width: 'w-14',
         fromDays: true,
      },
      {
         key: 'reviewing',
         label: 'Reviewing',
         title: 'The share of their days spent on other people’s PRs',
         width: 'w-20',
         hide: 'hidden lg:block',
         fromDays: true,
      },
      {
         key: 'open',
         label: 'Open',
         title: `Their PRs still open at the end of ${dayWords(range.end)}, drafts included`,
         width: 'w-14',
      },
      {
         key: 'opened',
         label: 'Opened',
         title: 'PRs they opened in the range',
         width: 'w-16',
         hide: 'hidden lg:block',
      },
      {
         key: 'merged',
         label: 'Merged',
         title: 'PRs of theirs merged in the range',
         width: 'w-16',
         hide: 'hidden lg:block',
      },
      {
         key: 'stamps',
         label: 'Stamps',
         title: 'CR and QA stamps they gave on other people’s PRs in the range',
         width: 'w-16',
         hide: 'hidden sm:block',
      },
      {
         key: 'nondev',
         label: 'On non-developers’',
         title: 'Of their stamps, the ones on non-developers’ PRs',
         width: 'w-40',
         hide: 'hidden md:block',
      },
   ];
   return hasTeams ? all : all.filter(c => c.key !== 'nondev');
}

/** A cell's number; empty for a zero, which reads quieter down a column. */
function cellText(row: PersonRow, key: Column['key']): string {
   const value = valueOf(row, key);
   if (value <= 0) return '';
   return key === 'reviewing' ? `${Math.round(100 * value)}%` : String(Math.round(value));
}

const tenths = (d: number) => Math.round(d * 10) / 10;

/** A person's projects, opened in place: what they did on each, their days
 * there, when anyone last worked on it, and its plan. */
function Detail({
   row,
   items,
   nameOf,
   navigate,
   hasTeams,
}: {
   row: PersonRow;
   items: ReadonlyMap<string, PortfolioItem>;
   nameOf: (slug: string) => string;
   navigate: Navigate;
   hasTeams: boolean;
}) {
   const project = (slug: string) => (
      <button
         key={slug}
         type="button"
         onClick={() => navigate({ project: slug })}
         title="Open the project page"
         className="pressable min-w-0 rounded border-0 bg-transparent p-0 text-left text-xs break-words text-ink hover:text-brand hover:underline"
      >
         {nameOf(slug)}
      </button>
   );
   const { load, w } = row;
   if (!load?.days) {
      // no days to split: say where their PRs were, and why there's no more
      const slugs = w?.projects ?? [];
      const why = !w
         ? 'No PRs or stamps in the range.'
         : load || !hasTeams
         ? 'No days on a PR in the range.'
         : row.team
         ? 'Their days didn’t load.'
         : 'Days and projects count developers only.';
      return (
         <p className="m-0 text-ink-3">
            {slugs.length > 0 && (
               <>
                  Their PRs in the range are in{' '}
                  {slugs.flatMap((s, i) => (i ? [', ', project(s)] : [project(s)]))}.{' '}
               </>
            )}
            {why}
         </p>
      );
   }
   const filed = load.projects.reduce((sum, p) => sum + p.days, 0);
   const oneOffs = load.days - filed - load.unfiled;
   const rest = [
      oneOffs >= 0.05 ? `${days(tenths(oneOffs))} on one-offs` : null,
      load.unfiled >= 0.05
         ? `${days(tenths(load.unfiled))} on PRs ${NOT_IN_A_PROJECT.toLowerCase()}`
         : null,
   ].filter(Boolean);
   if (!load.projects.length) {
      return (
         <p className="m-0 text-ink-3">
            No days on a project{rest.length ? `: ${rest.join(' and ')}` : ''}.
         </p>
      );
   }
   return (
      <>
         <ul className="m-0 flex list-none flex-col gap-1.5 p-0 sm:gap-1">
            {load.projects.map(p => {
               const item = items.get(p.slug);
               const role =
                  p.writing <= 0
                     ? 'reviewed'
                     : p.writing >= p.days - 0.005
                     ? 'wrote'
                     : 'wrote and reviewed';
               // a line of words on a phone, columns from sm up
               return (
                  <li
                     key={p.slug}
                     className="flex flex-wrap items-baseline gap-x-3 sm:grid sm:grid-cols-[minmax(0,1fr)_8.5rem_3rem_9rem_8rem] sm:gap-x-4"
                  >
                     {project(p.slug)}
                     <span className="text-ink-3">{role}</span>
                     <span className="text-ink-2 tabular-nums sm:text-right">
                        {daysShort(tenths(p.days))}
                     </span>
                     <span className="text-ink-3 empty:hidden sm:empty:block">
                        {item?.lastActivity
                           ? `last activity ${agoWords(item.lastActivity.days)}`
                           : ''}
                     </span>
                     <span
                        className={`empty:hidden sm:empty:block ${
                           item?.planCell.warn ? 'text-warn' : 'text-ink-3'
                        }`}
                     >
                        {item?.planCell.text ?? ''}
                     </span>
                  </li>
               );
            })}
         </ul>
         {rest.length > 0 && <p className="m-0 mt-2 text-ink-3">Also {rest.join(' and ')}.</p>}
      </>
   );
}

/**
 * One fold's people as a table, sorted the way every fold is. A row opens
 * in place to the person's projects; the whole row is its button's target,
 * so there's one stop per person for a keyboard.
 */
function PeopleTable({
   label,
   rows,
   cols,
   sort,
   onSort,
   line,
   me,
   isOpen,
   onToggle,
   detail,
}: {
   label: string;
   rows: PersonRow[];
   cols: Column[];
   sort: { key: PersonKey; reversed: boolean };
   onSort: (psort: string) => void;
   line: number;
   me: string;
   isOpen: (key: string) => boolean;
   onToggle: (key: string) => void;
   detail: (row: PersonRow) => ReactNode;
}) {
   // the days count developers only, so a fold of non-developers leaves
   // their columns out rather than showing blanks that look like zeros
   const shown = rows.some(r => r.load) ? cols : cols.filter(c => !c.fromDays);
   return (
      <div role="table" aria-label={label} className="text-xs text-ink-2">
         <div role="row" className="flex items-center gap-3 px-3.5 pt-2 pb-1">
            <SortHeader
               label="Person"
               title="Their GitHub login"
               sortKey="name"
               sort={sort}
               onSort={onSort}
               order="ascending"
               className="min-w-0 flex-1 pl-5"
            />
            {shown.map(c => (
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
         {sortPeople(rows, sort).map(row => {
            const key = row.login.toLowerCase();
            const open = isOpen(key);
            const detailId = `person-${key}-detail`;
            return (
               <Fragment key={key}>
                  <div
                     role="row"
                     id={`person-${key}`}
                     // a jump to the row lands it under the sticky headers. On a
                     // phone the name takes its own line and the numbers sit
                     // under their headers below it, so a name never squeezes
                     className="relative flex scroll-mt-[calc(var(--header-h,0px)_+_4rem)] flex-wrap items-center justify-end gap-x-3 gap-y-1 border-t border-secondary px-3.5 py-2 hover:bg-muted sm:flex-nowrap"
                  >
                     <div
                        role="cell"
                        className="flex min-w-0 flex-1 basis-full flex-col items-start gap-0.5 sm:basis-0"
                     >
                        {/* pd-link stretches the click over the row; not pressable,
                            whose press scale would shrink that stretch mid-click */}
                        <button
                           type="button"
                           aria-expanded={open}
                           aria-controls={open ? detailId : undefined}
                           onClick={() => onToggle(key)}
                           className="pd-link flex max-w-full min-w-0 items-center gap-2 rounded border-0 bg-transparent p-0 text-left text-[13px]"
                        >
                           <Icon
                              icon={ChevronRight}
                              size={12}
                              className={`flex-none text-ink-3 transition-[rotate] duration-150 ease-out motion-reduce:transition-none ${
                                 open ? 'rotate-90' : ''
                              }`}
                           />
                           <PersonCell login={row.login} me={me} />
                        </button>
                        {isOver(row, line) && (
                           <span className="pl-12 text-[11px] text-warn">overloaded</span>
                        )}
                     </div>
                     {shown.map(c => (
                        <div
                           key={c.key}
                           role="cell"
                           className={`flex-none text-right tabular-nums ${c.width} ${
                              c.hide ?? ''
                           }`}
                        >
                           {cellText(row, c.key) || <span className="sr-only">0</span>}
                        </div>
                     ))}
                  </div>
                  {open && (
                     <div
                        role="row"
                        id={detailId}
                        className="border-t border-secondary bg-muted/30"
                     >
                        <div role="cell" className="py-3 pr-3.5 pl-[62px]">
                           {detail(row)}
                        </div>
                     </div>
                  )}
               </Fragment>
            );
         })}
      </div>
   );
}

/**
 * Who is on what over the range: the tab's one person table, each team a
 * fold and the non-developers last. A person picked anywhere in the tab
 * (`who`) has their row opened and brought into view; closing it lets the
 * pick go. The Overloaded tile narrows it to the overloaded (`only`).
 */
function PeopleList({
   rows,
   line,
   middle,
   range,
   teams,
   items,
   nameOf,
   me,
   nav,
   navigate,
}: {
   rows: PersonRow[];
   line: number;
   middle: number;
   range: Range;
   teams: string[];
   items: ReadonlyMap<string, PortfolioItem>;
   nameOf: (slug: string) => string;
   me: string;
   nav: ProjectsNav;
   navigate: Navigate;
}) {
   // rows opened by a click, by lowercase login; the picked person's is
   // open while the pick stands
   const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
   const whoKey = nav.who?.toLowerCase() ?? null;
   const narrowed = nav.only === 'overloaded';
   const shown = narrowed
      ? rows.filter(r => isOver(r, line) || r.login.toLowerCase() === whoKey)
      : rows;
   const folds = [
      ...teams.map(team => ({
         id: `people:team:${team}`,
         label: team,
         rows: shown.filter(r => r.team === team),
      })),
      { id: NON_DEVS, label: 'Non-developers', rows: shown.filter(r => r.team == null) },
   ];
   const whoFold = whoKey
      ? folds.find(f => f.rows.some(r => r.login.toLowerCase() === whoKey))?.id ?? null
      : null;
   useEffect(() => {
      if (!whoKey || !whoFold) return;
      openFold(whoFold);
      // a frame later: after the fold opens, and after the app's own scroll
      // to the top of a view it has just opened
      const frame = requestAnimationFrame(() => scrollToId(`person-${whoKey}`));
      return () => cancelAnimationFrame(frame);
   }, [whoKey, whoFold]);
   const isOpen = (key: string) => key === whoKey || opened.has(key);
   const toggle = (key: string) => {
      const next = new Set(opened);
      if (isOpen(key)) {
         next.delete(key);
         // closing the picked person's row lets the pick go
         if (key === whoKey) navigate({ who: null });
      } else {
         next.add(key);
      }
      setOpened(next);
   };
   const sort = readSort<PersonKey>(nav.psort, PERSON_KEYS, 'projects');
   const cols = columnsFor(range, line, teams.length > 0);
   const showEveryone = () => navigate({ only: null });
   return (
      <section id="who-is-on-what" className="scroll-mt-[var(--header-h,0px)]">
         <GroupHeader
            title="Who is on what"
            sub={
               <SubDoor
                  label="How the people are counted"
                  text={`${rangeWords(range)} · ${line} or more projects is overloaded`}
               >
                  <p className="m-0">
                     A developer’s projects are the ones they wrote or reviewed PRs on in the range,
                     one-offs left out. {line} or more is overloaded: twice the developers’ median
                     of {tenths(middle)}, and never under {OVERLOAD_MIN}.
                  </p>
                  <p className="m-0">
                     Days are the days they opened a PR, had one merged, or commented on, stamped or
                     reviewed one.{' '}
                     {teams.length
                        ? 'Days and projects count developers only, from the developer teams.'
                        : 'With no developer teams yet, they count everyone.'}
                  </p>
                  <p className="m-0">
                     Open counts their PRs still open at the end of {dayWords(range.end)}. Opened,
                     merged and stamps count the range. A row opens to the projects they worked on:
                     what they did, their days there, and each one’s plan.
                  </p>
               </SubDoor>
            }
            headerExtra={
               narrowed && (
                  <NarrowChip label="Overloaded" clear="Show everyone" onClear={showEveryone} />
               )
            }
         />
         <Rows>
            {folds.map(f => (
               <Fold
                  key={f.id}
                  id={f.id}
                  count={f.rows.length}
                  label={f.label}
                  gloss={
                     f.id !== NON_DEVS
                        ? undefined
                        : teams.length
                        ? 'Everyone with a PR or a stamp in the range who isn’t on a developer team. Days and projects count developers only.'
                        : 'No developer teams yet, so everyone counts as a non-developer.'
                  }
                  // the developers greet you; the non-developers rest folded
                  // once there are teams
                  defaultOpen={f.id !== NON_DEVS || !teams.length}
               >
                  <PeopleTable
                     label={f.label}
                     rows={f.rows}
                     cols={cols}
                     sort={sort}
                     onSort={psort => navigate({ psort })}
                     line={line}
                     me={me}
                     isOpen={isOpen}
                     onToggle={toggle}
                     detail={row => (
                        <Detail
                           row={row}
                           items={items}
                           nameOf={nameOf}
                           navigate={navigate}
                           hasTeams={teams.length > 0}
                        />
                     )}
                  />
               </Fold>
            ))}
            {!shown.length && (
               <p className="m-0 px-3.5 py-4 text-[13px] text-ink-3">
                  Nobody is on {line} or more projects.{' '}
                  <button
                     type="button"
                     onClick={showEveryone}
                     className="pressable rounded border-0 bg-transparent p-0 text-[13px] font-medium text-brand hover:underline"
                  >
                     Show everyone
                  </button>
               </p>
            )}
         </Rows>
      </section>
   );
}

/** The two weekly charts' split: developers' number first. */
type Split = (w: WeekPoint) => [number, number];

/**
 * The people view: who is on what, and whether review keeps up, over the
 * picked range: every number on it follows the range. Developers sit in
 * their teams; everyone else with PRs is a non-developer, whose work needs a
 * developer's review. Each tile opens what it counts, the list is the tab's
 * one person table, and the charts show who opened the PRs and whose PRs
 * the stamps went to, week by week.
 */
export function People({
   data,
   prev,
   today,
   range,
   teamOf,
   nameOf,
   me,
   items,
   nav,
   navigate,
}: {
   data: ProjectsData | null | undefined;
   prev: ProjectsData | null | undefined;
   today: Today;
   range: Range;
   teamOf: (login: string) => string | null;
   nameOf: (slug: string) => string;
   me: string;
   /** every project, for the plan each person's projects are on */
   items: PortfolioItem[];
   nav: ProjectsNav;
   navigate: Navigate;
}) {
   const { who: loads, line, middle } = useWhoIsOnWhat(data?.teams, today, teamOf, range);
   // the charts draw at least 90 days ending with the range, the days
   // before it paler, so a short range still shows its trend
   const shown = chartWindow(range);
   const flow = useProjectsData(shown);
   // a save's refetch keeps the old numbers up (useProjectsData), so the
   // teams editor stays mounted through it, receipt and focus included
   const hasTeams = !!data && Object.keys(data.teams).length > 0;
   // with no teams the setup comes first, else it rests at the end; it
   // stays where the view opened it, so a save that adds the first team or
   // removes the last can't move it out from under the click
   const teamsFirst = useRef<boolean | null>(null);
   if (data && teamsFirst.current == null) teamsFirst.current = !hasTeams;
   const teamsSection = data && (
      <TeamsSection
         teams={data.teams}
         from={data.teams_from}
         known={
            new Set(
               [
                  ...Object.keys(data.window.people),
                  ...Object.values(data.teams).flat(),
                  ...[...today.live.flatMap(g => g.open), ...today.misc, ...today.unsorted].map(
                     p => p.data.user.login
                  ),
               ].map(login => login.toLowerCase())
            )
         }
      />
   );
   const body = (() => {
      if (data === undefined || (data && loads === undefined)) {
         return <p className="m-0 text-[13px] text-ink-3">Loading the numbers…</p>;
      }
      if (data === null) {
         return <LoadFailed what="the numbers for this range" onRetry={refreshProjectsData} />;
      }
      const rows = peopleRows(data, teamOf, loads ?? [], nav.who);
      if (!Object.keys(data.window.people).length && !(loads ?? []).some(l => l.days > 0)) {
         return (
            <p className="m-0 text-[13px] text-ink-3">
               No PRs were open or stamped from {rangeWords(range)}.
            </p>
         );
      }
      const people = Object.values(data.window.people);
      const sum = (list: PersonWindow[], pick: (w: PersonWindow) => number) =>
         list.reduce((total, w) => total + pick(w), 0);
      const devs = (d: ProjectsData) => Object.values(d.window.people).filter(w => w.team != null);
      const opened = data.window.totals.opened;
      const openedByOthers = sum(
         people.filter(w => w.team == null),
         w => w.opened
      );
      const stamps = sum(devs(data), w => w.reviews);
      const stampsOnOthers = sum(devs(data), w => w.reviews_on_non_dev);
      const overloaded = rows.filter(r => isOver(r, line));
      const pct = (part: number, whole: number) => `${Math.round((100 * part) / whole)}%`;
      // a tile sorts or narrows the list to what it counts, and brings it in
      const toList = (patch: Partial<ProjectsNav>) => {
         navigate(patch, { push: true });
         scrollToId('who-is-on-what');
      };
      const chart = (title: string, split: Split, labels: [string, string], unit: string) => (
         <StatsCard title={title}>
            <div className="mt-3">
               {flow === null ? (
                  <LoadFailed what="the chart" onRetry={refreshProjectsData} />
               ) : flow && !flow.window.weeks.some(w => split(w)[0] + split(w)[1] > 0) ? (
                  <p className="m-0 text-[13px] text-ink-3">None from {rangeWords(shown)}.</p>
               ) : (
                  <ChartSlot height={220}>
                     {flow && (
                        <SplitWeeksChart
                           weeks={flow.window.weeks}
                           pick={split}
                           labels={labels}
                           unit={unit}
                           ariaLabel={`${unit}, ${labels[0].toLowerCase()} and ${labels[1].toLowerCase()}`}
                           picked={range}
                           shown={shown}
                        />
                     )}
                  </ChartSlot>
               )}
            </div>
         </StatsCard>
      );
      return (
         <>
            {loads === null && (
               <LoadFailed what="who worked on what in this range" onRetry={retryRetroData} />
            )}
            <StatsCard>
               <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                  {loads && (
                     <Tile
                        value={overloaded.length}
                        label="Overloaded"
                        note={
                           overloaded.length && overloaded.length <= 3
                              ? overloaded.map(r => r.login).join(', ')
                              : `on ${line} or more projects`
                        }
                        title={`Developers who wrote or reviewed PRs on ${line} or more projects in the range: twice the developers’ median, and never under ${OVERLOAD_MIN}.${
                           overloaded.length ? ' Click to list only them.' : ''
                        }`}
                        onClick={
                           overloaded.length ? () => toList({ only: 'overloaded' }) : undefined
                        }
                     />
                  )}
                  {hasTeams && opened > 0 && (
                     <Tile
                        value={pct(openedByOthers, opened)}
                        label="Of PRs opened, by non-developers"
                        note={`${openedByOthers} of ${opened}`}
                        title="The share of the range’s new PRs that someone outside the developer teams opened. Click to list the non-developers, most opened first."
                        onClick={() => {
                           navigate({ psort: 'opened' }, { push: true });
                           openFold(NON_DEVS);
                           // a frame later, once the fold is open
                           requestAnimationFrame(() => scrollToId(foldDomId(NON_DEVS)));
                        }}
                     />
                  )}
                  {hasTeams && (
                     <Tile
                        value={stamps}
                        label="Stamps developers gave"
                        note={versus(
                           stamps,
                           prev ? sum(devs(prev), w => w.reviews) : null,
                           beforeWords(rangeDays(range))
                        )}
                        title={`CR and QA stamps developers gave on other people’s PRs in the range.${
                           stamps ? ' Click to list the people, most stamps first.' : ''
                        }`}
                        onClick={stamps ? () => toList({ psort: 'stamps' }) : undefined}
                     />
                  )}
                  {hasTeams && stamps > 0 && (
                     <Tile
                        value={pct(stampsOnOthers, stamps)}
                        label="Of those, on non-developers’ PRs"
                        note={`${stampsOnOthers} of ${stamps}`}
                        title="How much of the developers’ stamping went to PRs from outside the developer teams. Click to list the people, most of those first."
                        onClick={() => toList({ psort: 'nondev' })}
                     />
                  )}
               </div>
            </StatsCard>
            <PeopleList
               rows={rows}
               line={line}
               middle={middle}
               range={range}
               teams={Object.keys(data.teams)}
               items={new Map(items.map(i => [i.slug, i]))}
               nameOf={nameOf}
               me={me}
               nav={nav}
               navigate={navigate}
            />
            {hasTeams && (
               <section>
                  <GroupHeader
                     title="Developers and non-developers"
                     sub={
                        shown.start < range.start
                           ? `${rangeWords(shown)}, paler before ${dayWords(range.start)}`
                           : rangeWords(shown)
                     }
                  />
                  <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(380px,100%),1fr))]">
                     {chart(
                        'Who opened PRs',
                        w => [w.opened.developers, w.opened.non_developers],
                        ['Developers', 'Non-developers'],
                        'PRs opened each week'
                     )}
                     {chart(
                        'Whose PRs got the stamps',
                        w => [w.reviews.on_developers, w.reviews.on_non_developers],
                        ['On developers’ PRs', 'On non-developers’ PRs'],
                        'CR and QA stamps given each week'
                     )}
                  </div>
               </section>
            )}
         </>
      );
   })();
   return (
      <div className="flex flex-col gap-6">
         {teamsFirst.current && teamsSection}
         {body}
         {teamsFirst.current === false && teamsSection}
      </div>
   );
}
