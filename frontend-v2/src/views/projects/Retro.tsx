import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { issueUrl, n, shortRepo } from '../../../../shared/format';
import { MISC_SLUG } from '../../../../shared/model/projects';
import { ORIGIN_WORD, planFor, type RoadmapItem } from '../../../../shared/model/roadmap';
import { Segmented } from '../../components/bits';
import { Icon } from '../../components/Icon';
import { Avatar } from '../../components/identity';
import { eyebrowText, Rows, Truncated } from '../../components/Lane';
import type { PortfolioItem } from '../../model/portfolio';
import {
   chartWindow,
   dayOf,
   dayWords,
   previousRange,
   rangeDays,
   rangeWords,
   useProjectsData,
   type Range,
} from '../../model/projectData';
import {
   finishedIn,
   groupRows,
   lastWeek,
   loadByPerson,
   median,
   projectLength,
   quietWeeks,
   RETRO_PLAN_RANK,
   retroPlan,
   retroRows,
   spreadByPerson,
   type PersonLoad,
   type RetroGroup,
   type RetroRow,
} from '../../model/retro';
import { useRetroData, type RetroPr } from '../../model/retroData';
import { StatsCard } from '../stats/parts';
import { ChartSlot, DaysWeeksChart, FlowWeeksChart, OpenPrsChart } from './lazyCharts';
import {
   PeopleStack,
   readSort,
   SortHeader,
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
const KIND_OPTIONS: [ProjectsNav['kind'], string][] = [
   ['all', 'All days'],
   ['writing', 'Writing'],
   ['reviewing', 'Reviewing'],
];

// the origin split's groups beyond a plan's own word
const NOT_FILED = 'not-filed';
const NO_PLAN = 'no-plan';
const UNSAID = 'unsaid';

const AUTHOR_WORDS: Record<string, string> = {
   own: 'Their own PRs',
   developer: 'Other developers’ PRs',
   other: 'Non-developers’ PRs',
   bot: 'Bots’ PRs',
};

/** the long-list rule: this many rows, then "+ N more" */
const LIST_CAP = 40;

const num = (d: number) => (d < 10 ? (Math.round(d * 10) / 10).toString() : String(Math.round(d)));
const days = (d: number) => `${num(d)} ${d === 1 ? 'day' : 'days'}`;
const pct = (part: number, whole: number) => `${whole ? Math.round((100 * part) / whole) : 0}%`;
const quietButton =
   'pressable rounded border-0 bg-transparent p-0 text-left text-xs text-ink-3 hover:text-brand hover:underline';
const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: 'start' });
const sectionHead = 'm-0 scroll-mt-24 text-base font-semibold leading-snug';
const sectionSub = 'm-0 mt-1 mb-2 max-w-[80ch] text-xs text-ink-3';

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

/** A filed project's name, or what to call the rows with none. */
function projectLabel(key: string, nameOf: (slug: string) => string): string {
   return key ? nameOf(key) : 'Not filed to a project';
}

/** A group's name in the last list, split another way. */
function splitLabel(split: Split, key: string): string {
   if (split === 'origin') {
      if (key === NOT_FILED) return 'Not filed to a project';
      if (key === NO_PLAN) return 'Filed, but not on the roadmap';
      if (key === UNSAID) return 'On the roadmap, origin not said';
      return ORIGIN_WORD[key as keyof typeof ORIGIN_WORD] ?? key;
   }
   if (split === 'author') return AUTHOR_WORDS[key] ?? key;
   if (split === 'team') return key === '(none)' ? 'No team' : key;
   return shortRepo(key);
}

/** What clicking a split group's name does, or null when there's nowhere
 * natural to go and the row only opens in place. */
function openSplit(split: Split, key: string, navigate: Navigate): (() => void) | null {
   if (split === 'origin') {
      // the roadmap filters its plans by origin; unplanned work has no plan
      if (key === NOT_FILED || key === NO_PLAN) return null;
      return () => navigate({ view: 'roadmap', origin: key as ProjectsNav['origin'], item: null });
   }
   if (split === 'team') return () => navigate({ team: key });
   return null;
}

/** Each week's days as a bar, on the scale `top`, the oldest week first. */
function Weeks({ weekly, weeks, top }: { weekly: number[]; weeks: string[]; top: number }) {
   return (
      <span className="hidden h-5 w-28 flex-none items-end gap-px md:flex" aria-hidden>
         {weekly.map((d, i) => (
            <span
               key={weeks[i]}
               className="min-w-0 flex-1 rounded-t-[1px] bg-brand"
               style={{
                  height: `${Math.max(d > 0 ? 8 : 0, (d / top) * 100)}%`,
                  opacity: d ? 1 : 0,
               }}
               title={`Week of ${dayWords(weeks[i])}: ${days(d)}`}
            />
         ))}
      </span>
   );
}

/** The weeks column's head: the first and last week, so the bars need no axis. */
function WeeksHead({ weeks, top }: { weeks: string[]; top: number }) {
   return (
      <span
         className={`hidden w-28 flex-none justify-between text-ink-3 md:flex ${eyebrowText}`}
         title={`Each week’s days, oldest first, every row on one scale: the tallest bar is ${days(
            top
         )}`}
      >
         <span>{weeks.length ? dayWords(weeks[0]) : ''}</span>
         <span>{weeks.length > 1 ? dayWords(weeks[weeks.length - 1]) : ''}</span>
      </span>
   );
}

/** One right-aligned table cell. */
function Cell({
   width,
   hide = '',
   className = '',
   children,
}: {
   width: string;
   hide?: string;
   className?: string;
   children: ReactNode;
}) {
   return (
      <span className={`flex-none text-right tabular-nums ${width} ${hide} ${className}`}>
         {children}
      </span>
   );
}

/** A plain column head, for a column that doesn't sort. */
function Head({ label, title, width, hide = '' }: Column) {
   return (
      <span
         className={`flex-none text-right text-ink-3 ${eyebrowText} ${width} ${hide}`}
         title={title}
      >
         {label}
      </span>
   );
}

interface Column {
   label: string;
   title: string;
   width: string;
   hide?: string;
}

/** A table's head row: its first column, then the rest. */
function HeadRow({ children }: { children: ReactNode }) {
   return (
      <div className="flex items-center gap-3 border-b border-line bg-muted/40 px-3.5 py-[7px]">
         <span className="w-3 flex-none" aria-hidden />
         {children}
      </div>
   );
}

/**
 * A row that opens in place on click, and folds on a second click. The
 * words in `lead` that go somewhere else stop the click from reaching it.
 */
function TableRow({
   open,
   onToggle,
   lead,
   cells,
   detail,
}: {
   open: boolean;
   onToggle: () => void;
   lead: ReactNode;
   cells: ReactNode;
   detail: ReactNode;
}) {
   return (
      <div className="border-t border-secondary first:border-t-0">
         <div
            role="button"
            tabIndex={0}
            aria-expanded={open}
            onClick={onToggle}
            onKeyDown={e => {
               if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onToggle();
               }
            }}
            className="flex cursor-pointer items-center gap-3 px-3.5 py-2 text-xs text-ink-2 hover:bg-muted/40"
         >
            <Icon
               icon={open ? ChevronDown : ChevronRight}
               size={12}
               className="flex-none text-ink-3"
            />
            <span className="flex min-w-0 flex-1 items-center gap-2">{lead}</span>
            {cells}
         </div>
         {open && detail}
      </div>
   );
}

/** Words in a row that go somewhere of their own, not open the row. */
function LeadButton({
   onClick,
   title,
   children,
}: {
   onClick: () => void;
   title: string;
   children: ReactNode;
}) {
   return (
      <button
         type="button"
         onClick={e => {
            e.stopPropagation();
            onClick();
         }}
         className="hit pressable min-w-0 rounded border-0 bg-transparent p-0 text-left text-[13px] font-medium break-words text-ink hover:text-brand hover:underline"
         title={title}
      >
         {children}
      </button>
   );
}

function PrLine({ pr, days: d }: { pr: RetroPr; days: number }) {
   const state = pr.merged
      ? `merged ${dayWords(new Date(pr.merged * 1000).toISOString().slice(0, 10))}`
      : pr.state === 'open'
      ? 'open'
      : 'closed';
   return (
      <div className="flex items-baseline justify-between gap-3 px-1 py-0.5 text-xs">
         <a
            href={issueUrl(pr.repo, pr.number)}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 truncate text-ink hover:text-brand hover:underline"
            title={`${pr.title}, by ${pr.owner}`}
         >
            <span className="text-ink-3">
               {shortRepo(pr.repo)}#{pr.number}
            </span>{' '}
            {pr.title}
         </a>
         <span className="flex-none text-ink-3 tabular-nums">
            {days(d)} · {pr.owner} · {state}
         </span>
      </div>
   );
}

/** Where a group's days went: every PR, most days first, and everyone who
 * spent them. */
function SpentOn({ group, onWho }: { group: RetroGroup; onWho: (login: string) => void }) {
   return (
      <div className="grid gap-4 border-t border-secondary bg-muted/30 px-3.5 py-3 pl-8 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
         <div className="min-w-0">
            <h3 className="m-0 mb-1.5 text-xs font-semibold text-ink-2">
               Its PRs, most days first
            </h3>
            <Truncated cap={8} label="more PRs">
               {group.prs.map(([pr, d]) => (
                  <PrLine key={`${pr.repo}#${pr.number}`} pr={pr} days={d} />
               ))}
            </Truncated>
         </div>
         <div className="min-w-0">
            <h3 className="m-0 mb-1.5 text-xs font-semibold text-ink-2">Who spent them</h3>
            {group.people.map(([login, d]) => (
               <div key={login} className="flex items-baseline justify-between gap-3 py-0.5">
                  <button
                     type="button"
                     onClick={() => onWho(login)}
                     className="pressable min-w-0 truncate rounded border-0 bg-transparent p-0 text-left text-xs text-ink hover:text-brand hover:underline"
                     title={`Count only ${login}’s days`}
                  >
                     {login}
                  </button>
                  <span className="flex-none text-xs text-ink-3 tabular-nums">{days(d)}</span>
               </div>
            ))}
         </div>
      </div>
   );
}

/** A person's range opened in place: every project they worked on, what
 * they did there, then their PRs, most days first. */
function PersonDetail({
   load,
   group,
   nameOf,
   navigate,
}: {
   load: PersonLoad;
   group: RetroGroup | undefined;
   nameOf: (slug: string) => string;
   navigate: Navigate;
}) {
   const filed = load.projects.reduce((sum, p) => sum + p.days, 0);
   const rest = [
      load.days - filed - load.unfiled >= 0.05
         ? `${days(load.days - filed - load.unfiled)} on one-offs`
         : null,
      load.unfiled >= 0.05 ? `${days(load.unfiled)} on PRs with no project` : null,
   ].filter(Boolean);
   if (!load.days) {
      return (
         <p className="m-0 border-t border-secondary bg-muted/30 px-3.5 py-3 pl-8 text-xs text-ink-3">
            No PR activity in these days.
         </p>
      );
   }
   return (
      <div className="grid gap-4 border-t border-secondary bg-muted/30 px-3.5 py-3 pl-8 text-xs sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
         <div className="min-w-0">
            <h3 className="m-0 mb-1.5 text-xs font-semibold text-ink-2">Their projects</h3>
            {load.projects.map(p => (
               <div key={p.slug} className="flex items-baseline justify-between gap-3 py-0.5">
                  <button
                     type="button"
                     onClick={() => navigate({ project: p.slug })}
                     className="pressable min-w-0 rounded border-0 bg-transparent p-0 text-left text-xs break-words text-ink hover:text-brand hover:underline"
                     title="Open the project page"
                  >
                     {nameOf(p.slug)}
                  </button>
                  <span className="flex-none text-ink-3 tabular-nums">
                     {p.writing <= 0
                        ? 'reviewed'
                        : p.writing >= p.days - 0.005
                        ? 'wrote'
                        : 'wrote and reviewed'}
                     , {days(p.days)}
                  </span>
               </div>
            ))}
            {!load.projects.length && <p className="m-0 text-ink-3">None filed to a project.</p>}
            {rest.length > 0 && <p className="m-0 mt-1.5 text-ink-3">Also {rest.join(' and ')}.</p>}
         </div>
         <div className="min-w-0">
            <h3 className="m-0 mb-1.5 text-xs font-semibold text-ink-2">
               Their PRs, most days first
            </h3>
            <Truncated cap={8} label="more PRs">
               {(group?.prs ?? []).map(([pr, d]) => (
                  <PrLine key={`${pr.repo}#${pr.number}`} pr={pr} days={d} />
               ))}
            </Truncated>
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

/** Blanks sink whichever way a column sorts. */
function nullsLast(a: number | null, b: number | null, dir: number): number {
   if (a == null) return b == null ? 0 : 1;
   if (b == null) return -1;
   return dir * (b - a);
}

/**
 * Look back: where the time went over the picked range, for a retro. The
 * unit is a developer-day, a day someone opened, merged, commented on,
 * stamped or reviewed a PR, split across the PRs they touched that day
 * (shared/model/retro.ts), so a month-long project outweighs a one-line fix
 * the way it did in people's weeks.
 *
 * The tiles say the few numbers a retro opens with, each against the same
 * number of days before. Then everyone's weeks, who worked on what, every
 * project's days, length, pauses and plan, the days split one more way,
 * and whether the backlog grew. Each week's days are drawn in a row on one
 * scale per table, so a row is its own label. A name does the natural
 * thing (a person or a team narrows the page to their days, a project
 * opens its page); anywhere else on a row opens it in place.
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
   /** to a person's PRs on the Team tab */
   onPerson: (login: string) => void;
}) {
   const data = useRetroData(range);
   const before = useRetroData(previousRange(range));
   // the rows opened in place, by "person:", "project:" or "split:" and key
   const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
   const [copied, setCopied] = useState(false);
   if (data === undefined) {
      return <p className="m-0 text-[13px] text-ink-3">Adding up the days…</p>;
   }
   if (data === null) {
      return (
         <p className="m-0 text-[13px] text-warn">Couldn’t load the days. Try again in a minute.</p>
      );
   }
   const toggle = (key: string) =>
      setOpen(was => {
         const next = new Set(was);
         if (!next.delete(key)) next.add(key);
         return next;
      });

   // a team or a person picked from a row narrows everything to their days
   const inScope = (r: RetroRow) =>
      (!nav.team || (teamOf(r.login) ?? '(none)') === nav.team) &&
      (!nav.who || r.login === nav.who);
   const inKind = (r: RetroRow) => nav.kind === 'all' || (nav.kind === 'writing') === r.own;
   const scoped = retroRows(data).filter(inScope);
   const rows = scoped.filter(inKind);
   const earlierScoped = before ? retroRows(before).filter(inScope) : null;
   const earlier = earlierScoped?.filter(inKind) ?? null;
   const now = measure(scoped, plans);
   const then = earlierScoped && measure(earlierScoped, plans);
   const period = `${rangeDays(range)} days before`;
   const was = (part: (m: ReturnType<typeof measure>) => number) =>
      then && then.total ? `${pct(part(then), then.total)} in the ${period}` : null;
   const total = rows.reduce((sum, r) => sum + r.days, 0);
   const earlierTotal = earlier?.reduce((sum, r) => sum + r.days, 0) ?? 0;
   const today = dayOf(new Date());
   const bySlug = new Map(items.map(i => [i.slug, i]));
   const finished = finishedIn(
      plans,
      items.flatMap(i => (i.project ? [i.project] : [])),
      range
   );
   const onTime = finished.filter(f => f.onTime === true).length;
   const late = finished.filter(f => f.onTime === false).length;
   const unjudged = finished.length - onTime - late;
   const anyOrigin = plans.some(p => p.origin != null);
   const narrowed =
      nav.who ?? (nav.team ? (nav.team === '(none)' ? 'people on no team' : nav.team) : null);
   const kindWords = nav.kind === 'all' ? '' : nav.kind === 'writing' ? ', writing' : ', reviewing';
   const byDays = (list: RetroGroup[] | null) =>
      list ? new Map(list.map(g => [g.key, g.days])) : null;

   // who worked on what: every developer in scope, spelled the way their
   // PRs spell them, and anyone else with days in it
   const spelled = new Map(data.people.map(l => [l.toLowerCase(), l]));
   const members = nav.team
      ? nav.team === '(none)'
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
   const personGroups = new Map(groupRows(rows, r => r.login, data).map(g => [g.key, g]));
   const personBefore = earlier && before ? byDays(groupRows(earlier, r => r.login, before)) : null;
   const spread = spreadByPerson(rows);
   const psort = readSort<PersonKey>(nav.psort, PERSON_KEYS, 'days');
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
      return by || b.days - a.days || a.login.localeCompare(b.login);
   });
   const personTop = Math.max(0.01, ...[...personGroups.values()].flatMap(g => g.weekly));

   // every project's days in the range, with its length, pauses and plan
   const projectBefore =
      earlier && before ? byDays(groupRows(earlier, r => r.pr.project ?? '', before)) : null;
   const sort = readSort<ProjectKey>(nav.sort, PROJECT_KEYS, 'days');
   const projectRows = groupRows(rows, r => r.pr.project ?? '', data).map(g => {
      const item = g.key ? bySlug.get(g.key) : undefined;
      const filed = !!g.key && g.key !== MISC_SLUG;
      const plan = filed ? retroPlan(item?.plan ?? planFor(g.key, plans), today) : null;
      return {
         g,
         label: projectLabel(g.key, nameOf),
         filed,
         length: filed ? projectLength(item?.window, range.end) : null,
         quiet: quietWeeks(g.weekly),
         last: lastWeek(g.weekly),
         plan,
         before: projectBefore?.get(g.key) ?? null,
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
   const projects = projectRows.sort((a, b) => {
      // the days on no project always come last
      if (!a.g.key || !b.g.key) return Number(!a.g.key) - Number(!b.g.key);
      const dir = sort.reversed ? -1 : 1;
      const by =
         sort.key === 'name'
            ? dir * a.label.localeCompare(b.label)
            : nullsLast(projectValue(a, sort.key), projectValue(b, sort.key), dir);
      return by || b.g.days - a.g.days || a.label.localeCompare(b.label);
   });
   const projectTop = Math.max(0.01, ...projects.flatMap(r => r.g.weekly));
   const unfiledShare = share(projects.find(r => !r.g.key)?.g.days ?? 0, total);

   // the days split one more way
   const originOf = (r: RetroRow) => {
      const project = r.pr.project;
      if (!project) return NOT_FILED;
      // one-offs are filed, just never planned
      if (project === MISC_SLUG) return NO_PLAN;
      const plan = planFor(project, plans);
      return !plan || plan.status === 'dropped' ? NO_PLAN : plan.origin ?? UNSAID;
   };
   const keyOf: Record<Split, (r: RetroRow) => string> = {
      origin: originOf,
      author: r =>
         r.own ? 'own' : r.pr.bot ? 'bot' : teamOf(r.pr.owner) != null ? 'developer' : 'other',
      team: r => teamOf(r.login) ?? '(none)',
      repo: r => r.pr.repo,
   };
   const splitGroups = groupRows(rows, keyOf[nav.by], data);
   const splitBefore = earlier && before ? byDays(groupRows(earlier, keyOf[nav.by], before)) : null;
   const splitTop = Math.max(0.01, ...splitGroups.flatMap(g => g.weekly));
   const splitName = SPLIT_OPTIONS.find(([s]) => s === nav.by)?.[1] ?? '';

   const plansNote = finished.length
      ? `${onTime} on time, ${late} late${unjudged ? `, ${unjudged} with no plan` : ''}`
      : null;
   // the retro's notes, as plain text: everything the page lists
   const copy = () => {
      const lines = [
         `Where the time went${narrowed ? `, ${narrowed}` : ''}${kindWords}, ${rangeWords(
            range
         )}: ${days(total)} from ${n(new Set(rows.map(r => r.login)).size, 'person', 'people')}`,
         `${pct(now.total - now.writing, now.total)} reviewing, ${pct(
            now.planned,
            now.total
         )} on the roadmap${anyOrigin ? `, ${pct(now.fires, now.total)} fires` : ''}, ${pct(
            now.unfiled,
            now.total
         )} not filed`,
         `Plans finished: ${finished.length}${plansNote ? ` (${plansNote})` : ''}`,
         '',
         'Who worked on what:',
         ...people.map(
            p =>
               `- ${p.login}: ${days(p.days)}, ${pct(p.reviewing, p.days)} reviewing, wrote on ${n(
                  p.wrote,
                  'project'
               )}, reviewed on ${p.reviewed}`
         ),
         '',
         'Projects:',
         ...projects.map(r =>
            [
               `- ${r.label}: ${days(r.g.days)} (${pct(r.g.days, total)})`,
               r.length ? `${r.length.open ? 'open' : 'took'} ${r.length.days} days` : null,
               r.plan?.text ?? null,
            ]
               .filter(Boolean)
               .join(', ')
         ),
         '',
         `By ${splitName.toLowerCase()}:`,
         ...splitGroups.map(
            g => `- ${splitLabel(nav.by, g.key)}: ${days(g.days)} (${pct(g.days, total)})`
         ),
      ];
      void navigator.clipboard?.writeText(lines.join('\n')).then(() => {
         setCopied(true);
         setTimeout(() => setCopied(false), 2000);
      });
   };

   const tiles = [
      <Tile
         key="days"
         value={Math.round(now.total)}
         label="Developer-days"
         title={`Days people spent on PRs, ${rangeWords(
            range
         )}. A day counts once per person, split across the PRs they touched that day.`}
         note={then ? versus(Math.round(now.total), Math.round(then.total), period) : null}
      />,
      <Tile
         key="reviewing"
         value={pct(now.total - now.writing, now.total)}
         label="Reviewing"
         title="Of the days, the share on other people’s PRs. Click to count only those days."
         note={was(m => m.total - m.writing)}
         onClick={() => navigate({ kind: nav.kind === 'reviewing' ? 'all' : 'reviewing' })}
      />,
      <Tile
         key="roadmap"
         value={pct(now.planned, now.total)}
         label="On the roadmap"
         title="Of the days, the share on projects with a plan. Click to split the days by where the work came from."
         note={was(m => m.planned)}
         onClick={() => {
            navigate({ by: 'origin' });
            scrollTo('retro-split');
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
               scrollTo('retro-split');
            }}
         />
      ),
      <Tile
         key="unfiled"
         value={pct(now.unfiled, now.total)}
         label="Not filed"
         title="Of the days, the share on PRs with no project label. Click for the PRs that took the most."
         note={was(m => m.unfiled)}
         onClick={() => {
            setOpen(o => new Set(o).add('project:'));
            scrollTo('retro-projects');
         }}
      />,
      <Tile
         key="spread"
         value={now.spread}
         label="Projects a week"
         title="The median, across people, of how many different projects each touched in a week they worked. A PR with no project counts on its own. Click to sort the people by it."
         note={then ? `${then.spread} in the ${period}` : null}
         onClick={() => {
            navigate({ psort: 'spread' });
            scrollTo('retro-people');
         }}
      />,
      <Tile
         key="finished"
         value={finished.length}
         label="Plans finished"
         title="Plans marked done in these days, and project issues closed as completed, each judged against its plan’s end. Click to sort the projects by their plan."
         note={plansNote}
         onClick={() => {
            navigate({ sort: 'plan' });
            scrollTo('retro-projects');
         }}
      />,
   ].filter(Boolean);

   const personHeads: (Column & { key: PersonKey })[] = [
      { key: 'days', label: 'Days', title: 'Their developer-days in the range', width: 'w-14' },
      {
         key: 'reviewing',
         label: 'Reviewing',
         title: 'The share of their days on other people’s PRs',
         width: 'w-20',
         hide: 'hidden lg:block',
      },
      {
         key: 'wrote',
         label: 'Wrote on',
         title: 'Projects they wrote PRs for',
         width: 'w-16',
         hide: 'hidden lg:block',
      },
      {
         key: 'reviewed',
         label: 'Reviewed on',
         title: 'Projects where they reviewed, stamped or commented on someone else’s PRs',
         width: 'w-20',
         hide: 'hidden lg:block',
      },
      {
         key: 'spread',
         label: 'Projects a week',
         title: 'The median, over the weeks they worked, of how many different projects they touched that week. A PR with no project counts on its own.',
         width: 'w-28',
         hide: 'hidden xl:block',
      },
      {
         key: 'unfiled',
         label: 'Not filed',
         title: 'The share of their days on PRs with no project label',
         width: 'w-16',
         hide: 'hidden xl:block',
      },
      {
         key: 'before',
         label: 'Before',
         title: `Their developer-days in the ${period}`,
         width: 'w-16',
         hide: 'hidden md:block',
      },
   ];
   const projectHeads: (Column & { key: ProjectKey | null })[] = [
      { key: 'days', label: 'Days', title: 'Developer-days on it in the range', width: 'w-14' },
      {
         key: null,
         label: 'Share',
         title: 'Its share of all the days listed',
         width: 'w-12',
         hide: 'hidden sm:block',
      },
      {
         key: 'people',
         label: 'People',
         title: 'Who wrote or reviewed PRs on it in the range. Click a face for their PRs.',
         width: 'w-20',
         hide: 'hidden lg:block',
      },
      {
         key: 'length',
         label: 'Length',
         title: 'From its first PR opening to its last merge or close (“took”), or, with a PR still open when the range ended, how long it had been open by then (“open”)',
         width: 'w-24',
         hide: 'hidden lg:block',
      },
      {
         key: 'quiet',
         label: 'Longest quiet',
         title: 'The most weeks in a row nobody worked on it, between its first and last week with any days',
         width: 'w-24',
         hide: 'hidden xl:block',
      },
      {
         key: 'last',
         label: 'Last worked',
         title: 'The week of its last day in the range',
         width: 'w-20',
         hide: 'hidden xl:block',
      },
      {
         key: 'plan',
         label: 'Plan',
         title: 'How its plan on the roadmap turned out, as of today: done on time or late, still open past its end, or no plan',
         width: 'w-36',
         hide: 'hidden md:block',
      },
      {
         key: 'before',
         label: 'Before',
         title: `Its developer-days in the ${period}`,
         width: 'w-16',
         hide: 'hidden lg:block',
      },
   ];

   return (
      <section className="mb-7">
         <div className="mb-5">
            <h2 className="m-0 text-base font-semibold leading-snug">
               Where the time went{narrowed ? `, ${narrowed}` : ''}
            </h2>
            <p className="m-0 mt-1 max-w-[72ch] text-xs text-ink-3">
               A developer-day is a day someone opened, merged, commented on, stamped or reviewed a
               PR, split across the PRs they touched that day: writing on their own, reviewing on
               anyone else’s. Commits aren’t counted; here they’d add about 4%.
            </p>
         </div>
         <div
            className={`grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 ${
               tiles.length > 6 ? 'lg:grid-cols-7' : 'lg:grid-cols-6'
            }`}
         >
            {tiles}
         </div>
         <div className="mt-6 mb-3 flex flex-wrap items-center gap-3">
            <Segmented
               ariaLabel="which days count"
               value={nav.kind}
               options={KIND_OPTIONS}
               onChange={kind => navigate({ kind })}
            />
            {narrowed && (
               <button
                  type="button"
                  onClick={() => navigate({ who: null, team: null })}
                  className={quietButton}
               >
                  Show everyone’s days
               </button>
            )}
            <span className="flex-1" />
            {rows.length > 0 && (
               <button
                  type="button"
                  onClick={copy}
                  className={quietButton}
                  title="Copy everything below as plain text, for the retro’s notes"
               >
                  {copied ? 'Copied' : 'Copy as text'}
               </button>
            )}
         </div>
         {!rows.length ? (
            <p className="m-0 text-[13px] text-ink-3">No one touched a PR in these days.</p>
         ) : (
            <div className="flex flex-col gap-7">
               <StatsCard
                  title={`${narrowed ?? 'Everyone'}’s days, week by week${kindWords}`}
                  sub={`${days(total)}, ${rangeWords(range)}`}
               >
                  <div className="mt-3">
                     <ChartSlot height={190}>
                        <DaysWeeksChart
                           weeks={data.weeks}
                           writing={data.weeks.map((_, i) =>
                              rows
                                 .filter(r => r.own && r.week === i)
                                 .reduce((s, r) => s + r.days, 0)
                           )}
                           reviewing={data.weeks.map((_, i) =>
                              rows
                                 .filter(r => !r.own && r.week === i)
                                 .reduce((s, r) => s + r.days, 0)
                           )}
                        />
                     </ChartSlot>
                  </div>
               </StatsCard>

               <section>
                  <h2 id="retro-people" className={sectionHead}>
                     Who worked on what
                  </h2>
                  <p className={sectionSub}>
                     Every developer’s days, week by week. A name counts only that person’s days on
                     this page; a face opens their PRs.
                  </p>
                  <Rows>
                     <HeadRow>
                        <SortHeader
                           label="Person"
                           title="Developers, and anyone else with days in the range"
                           sortKey="name"
                           sort={psort}
                           onSort={s => navigate({ psort: s })}
                           className="min-w-0 flex-1"
                        />
                        <WeeksHead weeks={data.weeks} top={personTop} />
                        {personHeads.map(c => (
                           <SortHeader
                              key={c.key}
                              label={c.label}
                              title={c.title}
                              sortKey={c.key}
                              sort={psort}
                              onSort={s => navigate({ psort: s })}
                              className={`flex-none text-right ${c.width} ${c.hide ?? ''}`}
                           />
                        ))}
                     </HeadRow>
                     <Truncated cap={LIST_CAP} id={`retro-people:${range.start}`}>
                        {people.map(p => {
                           const g = personGroups.get(p.login);
                           const earlierDays = personBefore?.get(p.login);
                           return (
                              <TableRow
                                 key={p.login}
                                 open={open.has(`person:${p.login}`)}
                                 onToggle={() => toggle(`person:${p.login}`)}
                                 lead={
                                    <>
                                       <span
                                          className="flex-none"
                                          onClick={e => e.stopPropagation()}
                                       >
                                          <Avatar login={p.login} size={20} onClick={onPerson} />
                                       </span>
                                       <LeadButton
                                          onClick={() => navigate({ who: p.login, team: null })}
                                          title={`Count only ${p.login}’s days on this page`}
                                       >
                                          {p.login}
                                       </LeadButton>
                                       {teamOf(p.login) && (
                                          <span className="hidden flex-none text-xs text-ink-3 sm:inline">
                                             {teamOf(p.login)}
                                          </span>
                                       )}
                                    </>
                                 }
                                 cells={
                                    <>
                                       <Weeks
                                          weekly={g?.weekly ?? data.weeks.map(() => 0)}
                                          weeks={data.weeks}
                                          top={personTop}
                                       />
                                       <Cell width="w-14" className="text-ink">
                                          {p.days ? num(p.days) : ''}
                                       </Cell>
                                       <Cell width="w-20" hide="hidden lg:block">
                                          {p.days ? pct(p.reviewing, p.days) : ''}
                                       </Cell>
                                       <Cell width="w-16" hide="hidden lg:block">
                                          {p.wrote || ''}
                                       </Cell>
                                       <Cell width="w-20" hide="hidden lg:block">
                                          {p.reviewed || ''}
                                       </Cell>
                                       <Cell width="w-28" hide="hidden xl:block">
                                          {spread.has(p.login)
                                             ? Math.round((spread.get(p.login) ?? 0) * 10) / 10
                                             : ''}
                                       </Cell>
                                       <Cell width="w-16" hide="hidden xl:block">
                                          {p.days ? pct(p.unfiled, p.days) : ''}
                                       </Cell>
                                       <Cell
                                          width="w-16"
                                          hide="hidden md:block"
                                          className="text-ink-3"
                                       >
                                          {earlierDays != null
                                             ? num(earlierDays)
                                             : personBefore
                                             ? 'none'
                                             : ''}
                                       </Cell>
                                    </>
                                 }
                                 detail={
                                    <PersonDetail
                                       load={p}
                                       group={g}
                                       nameOf={nameOf}
                                       navigate={navigate}
                                    />
                                 }
                              />
                           );
                        })}
                     </Truncated>
                  </Rows>
               </section>

               <section>
                  <h2 id="retro-projects" className={sectionHead}>
                     Projects in this range
                  </h2>
                  <p className={sectionSub}>
                     Every project’s developer-days, how long its PRs ran, its longest pause, and
                     how its plan turned out.
                     {unfiledShare > 0.5 &&
                        ` Most of these days (${pct(
                           unfiledShare,
                           1
                        )}) went to PRs with no project label, so the project rows undercount.`}
                  </p>
                  <Rows>
                     <HeadRow>
                        <SortHeader
                           label="Project"
                           title="The project’s name; the days on PRs with no project come last"
                           sortKey="name"
                           sort={sort}
                           onSort={s => navigate({ sort: s })}
                           className="min-w-0 flex-1"
                        />
                        <WeeksHead weeks={data.weeks} top={projectTop} />
                        {projectHeads.map(c =>
                           c.key ? (
                              <SortHeader
                                 key={c.key}
                                 label={c.label}
                                 title={c.title}
                                 sortKey={c.key}
                                 sort={sort}
                                 onSort={s => navigate({ sort: s })}
                                 className={`flex-none text-right ${c.width} ${c.hide ?? ''}`}
                              />
                           ) : (
                              <Head
                                 key={c.label}
                                 label={c.label}
                                 title={c.title}
                                 width={c.width}
                                 hide={c.hide}
                              />
                           )
                        )}
                     </HeadRow>
                     <Truncated cap={LIST_CAP} id={`retro-projects:${range.start}`}>
                        {projects.map(r => (
                           <TableRow
                              key={r.g.key || 'not-filed'}
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
                                    <Weeks
                                       weekly={r.g.weekly}
                                       weeks={data.weeks}
                                       top={projectTop}
                                    />
                                    <Cell width="w-14" className="text-ink">
                                       {num(r.g.days)}
                                    </Cell>
                                    <Cell width="w-12" hide="hidden sm:block">
                                       {pct(r.g.days, total)}
                                    </Cell>
                                    <Cell width="w-20" hide="hidden lg:block">
                                       <span
                                          className="inline-flex"
                                          onClick={e => e.stopPropagation()}
                                       >
                                          <PeopleStack
                                             logins={r.g.people.map(([login]) => login)}
                                             onPerson={onPerson}
                                          />
                                       </span>
                                    </Cell>
                                    <Cell width="w-24" hide="hidden lg:block">
                                       {r.length
                                          ? `${r.length.open ? 'open' : 'took'} ${r.length.days} d`
                                          : ''}
                                    </Cell>
                                    <Cell width="w-24" hide="hidden xl:block">
                                       {r.quiet ? `${r.quiet} wk` : ''}
                                    </Cell>
                                    <Cell width="w-20" hide="hidden xl:block">
                                       {r.last >= 0 ? dayWords(data.weeks[r.last]) : ''}
                                    </Cell>
                                    <Cell width="w-36" hide="hidden md:block">
                                       {r.plan?.text ?? ''}
                                    </Cell>
                                    <Cell
                                       width="w-16"
                                       hide="hidden lg:block"
                                       className="text-ink-3"
                                    >
                                       {r.before != null
                                          ? num(r.before)
                                          : projectBefore
                                          ? 'none'
                                          : ''}
                                    </Cell>
                                 </>
                              }
                              detail={
                                 <SpentOn group={r.g} onWho={login => navigate({ who: login })} />
                              }
                           />
                        ))}
                     </Truncated>
                  </Rows>
               </section>

               <section>
                  <div className="flex flex-wrap items-center gap-3">
                     <h2 id="retro-split" className={sectionHead}>
                        Split another way
                     </h2>
                     <Segmented
                        ariaLabel="split the days by"
                        value={nav.by}
                        options={SPLIT_OPTIONS}
                        onChange={by => navigate({ by })}
                     />
                  </div>
                  <p className={sectionSub}>
                     The same days by {splitName.toLowerCase()}.
                     {nav.by === 'team' ? ' A team counts only its days on this page.' : ''}
                  </p>
                  <Rows>
                     <HeadRow>
                        <span className={`min-w-0 flex-1 text-ink-3 ${eyebrowText}`}>
                           {splitName}
                        </span>
                        <WeeksHead weeks={data.weeks} top={splitTop} />
                        <Head label="Days" title="Developer-days in the range" width="w-14" />
                        <Head
                           label="Share"
                           title="Its share of all the days listed"
                           width="w-12"
                           hide="hidden sm:block"
                        />
                        <Head
                           label="Before"
                           title={`Its share of the days in the ${period}`}
                           width="w-24"
                           hide="hidden md:block"
                        />
                     </HeadRow>
                     <Truncated cap={LIST_CAP} id={`retro-split:${nav.by}`}>
                        {splitGroups.map(g => {
                           const onName = openSplit(nav.by, g.key, navigate);
                           const prev = splitBefore?.get(g.key);
                           return (
                              <TableRow
                                 key={g.key}
                                 open={open.has(`split:${nav.by}:${g.key}`)}
                                 onToggle={() => toggle(`split:${nav.by}:${g.key}`)}
                                 lead={
                                    onName ? (
                                       <LeadButton
                                          onClick={onName}
                                          title={
                                             nav.by === 'team'
                                                ? 'Count only this team’s days on this page'
                                                : 'Show these plans on the roadmap'
                                          }
                                       >
                                          {splitLabel(nav.by, g.key)}
                                       </LeadButton>
                                    ) : (
                                       <span className="min-w-0 text-[13px] font-medium break-words text-ink">
                                          {splitLabel(nav.by, g.key)}
                                       </span>
                                    )
                                 }
                                 cells={
                                    <>
                                       <Weeks weekly={g.weekly} weeks={data.weeks} top={splitTop} />
                                       <Cell width="w-14" className="text-ink">
                                          {num(g.days)}
                                       </Cell>
                                       <Cell width="w-12" hide="hidden sm:block">
                                          {pct(g.days, total)}
                                       </Cell>
                                       <Cell
                                          width="w-24"
                                          hide="hidden md:block"
                                          className="text-ink-3"
                                       >
                                          {!splitBefore
                                             ? ''
                                             : prev == null
                                             ? 'new'
                                             : `was ${pct(prev, earlierTotal)}`}
                                       </Cell>
                                    </>
                                 }
                                 detail={
                                    <SpentOn group={g} onWho={login => navigate({ who: login })} />
                                 }
                              />
                           );
                        })}
                     </Truncated>
                  </Rows>
               </section>
            </div>
         )}
         <div className="mt-7">
            <BacklogCard range={range} />
         </div>
      </section>
   );
}

/**
 * Is the backlog growing: the PRs open at the end of each day, and what
 * arrived and what merged each week, over at least 90 days ending on the
 * range's last day, with the days before the range faded. The line over the
 * charts counts the picked range's PRs.
 */
function BacklogCard({ range }: { range: Range }) {
   const shown = chartWindow(range);
   const data = useProjectsData(shown);
   const t = useProjectsData(range)?.window.totals;
   return (
      <StatsCard title="Is the backlog growing?" sub={rangeWords(shown)}>
         {t && (
            <p className="m-0 mt-1 text-xs text-ink-3">
               {rangeWords(range)}: {n(t.opened, 'PR')} opened and {t.merged} merged
               {t.median_days_to_merge != null
                  ? `. Half of the merged ones merged within ${n(
                       t.median_days_to_merge,
                       'day'
                    )} of opening`
                  : ''}
               .
            </p>
         )}
         {data === null ? (
            <p className="m-0 mt-3 text-[13px] text-ink-3">Couldn’t load the charts.</p>
         ) : (
            <div className="mt-3 flex flex-col gap-4">
               <ChartSlot height={200}>
                  {data && <OpenPrsChart days={data.window.days} picked={range} />}
               </ChartSlot>
               <ChartSlot height={210}>
                  {data && <FlowWeeksChart weeks={data.window.weeks} picked={range} />}
               </ChartSlot>
            </div>
         )}
      </StatsCard>
   );
}
