import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { issueUrl, n, shortRepo } from '../../../../shared/format';
import { MISC_SLUG } from '../../../../shared/model/projects';
import { ORIGIN_WORD, planFor, type RoadmapItem } from '../../../../shared/model/roadmap';
import { Segmented } from '../../components/bits';
import { Icon } from '../../components/Icon';
import { Rows } from '../../components/Lane';
import {
   dayWords,
   previousRange,
   rangeDays,
   rangeWords,
   type Range,
} from '../../model/projectData';
import {
   groupRows,
   median,
   retroRows,
   spreadByPerson,
   type RetroGroup,
   type RetroRow,
} from '../../model/retro';
import { useRetroData, type RetroData, type RetroPr } from '../../model/retroData';
import { StatsCard } from '../stats/parts';
import { ChartSlot, DaysWeeksChart } from './lazyCharts';
import { PeopleStack, Tile, versus, type Navigate, type ProjectsNav } from './parts';

type By = ProjectsNav['by'];

const BY_OPTIONS: [By, string][] = [
   ['project', 'Project'],
   ['origin', 'Where it came from'],
   ['author', 'Whose PR'],
   ['team', 'Team'],
   ['person', 'Person'],
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

const days = (d: number) =>
   `${d < 10 ? (Math.round(d * 10) / 10).toString() : Math.round(d)} ${d === 1 ? 'day' : 'days'}`;
const pct = (part: number, whole: number) => `${whole ? Math.round((100 * part) / whole) : 0}%`;
const quietButton =
   'pressable rounded border-0 bg-transparent p-0 text-left text-xs text-ink-3 hover:text-brand hover:underline';

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

/**
 * Look back: where the time went over the picked range, for a retro. The
 * unit is a developer-day, a day someone opened, merged, commented on,
 * stamped or reviewed a PR, split across the PRs they touched that day
 * (shared/model/retro.ts), so a month-long project outweighs a one-line fix
 * the way it did in people's weeks.
 *
 * The tiles say the few numbers a retro opens with, each against the same
 * number of days before. Below, one list for the picked split, most days
 * first, with each week's days drawn in the row on one scale, so a row is
 * its own label and nothing needs a legend. A row's name does the natural
 * thing (a project opens its page, an origin its plans, a team or a person
 * narrows everything to their days); anywhere else on it opens the PRs and
 * people behind its days, in place.
 */
export function Retro({
   range,
   plans,
   teamOf,
   nameOf,
   nav,
   navigate,
}: {
   range: Range;
   plans: readonly RoadmapItem[];
   teamOf: (login: string) => string | null;
   nameOf: (slug: string) => string;
   nav: ProjectsNav;
   navigate: Navigate;
}) {
   const data = useRetroData(range);
   const before = useRetroData(previousRange(range));
   // the row whose PRs and people are open; '' is "not filed"
   const [open, setOpen] = useState<string | null>(null);
   const [copied, setCopied] = useState(false);
   if (data === undefined) {
      return <p className="m-0 text-[13px] text-ink-3">Adding up the days…</p>;
   }
   if (data === null) {
      return (
         <p className="m-0 text-[13px] text-warn">Couldn’t load the days. Try again in a minute.</p>
      );
   }
   // a team or a person picked from a row narrows everything to their days
   const inScope = (r: RetroRow) =>
      (!nav.team || (teamOf(r.login) ?? '(none)') === nav.team) &&
      (!nav.who || r.login === nav.who);
   const inKind = (r: RetroRow) => nav.kind === 'all' || (nav.kind === 'writing') === r.own;
   const scoped = retroRows(data).filter(inScope);
   const rows = scoped.filter(inKind);
   const earlier = before ? retroRows(before).filter(inScope) : null;
   const now = measure(scoped, plans);
   const then = earlier && measure(earlier, plans);
   const period = `${rangeDays(range)} days before`;
   const was = (part: (m: ReturnType<typeof measure>) => number) =>
      then && then.total ? `${pct(part(then), then.total)} the ${period}` : null;

   const originOf = (r: RetroRow) => {
      const project = r.pr.project;
      if (!project) return NOT_FILED;
      // one-offs are filed, just never planned
      if (project === MISC_SLUG) return NO_PLAN;
      const plan = planFor(project, plans);
      return !plan || plan.status === 'dropped' ? NO_PLAN : plan.origin ?? UNSAID;
   };
   const keyOf: Record<By, (r: RetroRow) => string> = {
      project: r => r.pr.project ?? '',
      origin: originOf,
      author: r =>
         r.own ? 'own' : r.pr.bot ? 'bot' : teamOf(r.pr.owner) != null ? 'developer' : 'other',
      team: r => teamOf(r.login) ?? '(none)',
      person: r => r.login,
      repo: r => r.pr.repo,
   };
   const groups = groupRows(rows, keyOf[nav.by], data);
   const earlierGroups =
      earlier && before
         ? new Map(
              groupRows(earlier.filter(inKind), keyOf[nav.by], before).map(g => [g.key, g.days])
           )
         : null;
   const earlierTotal = earlierGroups ? [...earlierGroups.values()].reduce((a, b) => a + b, 0) : 0;
   const total = rows.reduce((sum, r) => sum + r.days, 0);
   // each week's days, writing and reviewing, for the chart over the list
   const writingWeeks = data.weeks.map(() => 0);
   const reviewingWeeks = data.weeks.map(() => 0);
   for (const r of rows) (r.own ? writingWeeks : reviewingWeeks)[r.week] += r.days;
   const top = Math.max(0.01, ...groups.flatMap(g => g.weekly));
   const spread = spreadByPerson(scoped);
   const label = (key: string) => labelOf(nav.by, key, nameOf);
   const narrowed =
      nav.who ?? (nav.team ? (nav.team === '(none)' ? 'people on no team' : nav.team) : null);
   const kindWords = nav.kind === 'all' ? '' : nav.kind === 'writing' ? ', writing' : ', reviewing';

   // the retro's notes, as plain text
   const copy = () => {
      const lines = [
         `Where the time went${narrowed ? `, ${narrowed}` : ''}${kindWords}, ${rangeWords(
            range
         )}: ${days(total)} from ${n(new Set(rows.map(r => r.login)).size, 'person', 'people')}`,
         `${pct(now.total - now.writing, now.total)} reviewing, ${pct(
            now.planned,
            now.total
         )} on the roadmap, ${pct(now.fires, now.total)} fires, ${pct(
            now.unfiled,
            now.total
         )} not filed`,
         `By ${BY_OPTIONS.find(([b]) => b === nav.by)?.[1].toLowerCase()}:`,
         ...groups
            .slice(0, 12)
            .map(g => `- ${label(g.key)}: ${days(g.days)} (${pct(g.days, total)})`),
      ];
      void navigator.clipboard?.writeText(lines.join('\n')).then(() => {
         setCopied(true);
         setTimeout(() => setCopied(false), 2000);
      });
   };

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
         <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
            <Tile
               value={Math.round(now.total)}
               label="Developer-days"
               title={`Days people spent on PRs, ${rangeWords(range)}`}
               note={then ? versus(Math.round(now.total), Math.round(then.total), period) : null}
            />
            <Tile
               value={pct(now.total - now.writing, now.total)}
               label="Reviewing"
               title="Of the days, the share on other people’s PRs. Click to see only those days."
               note={was(m => m.total - m.writing)}
               onClick={() => navigate({ kind: nav.kind === 'reviewing' ? 'all' : 'reviewing' })}
            />
            <Tile
               value={pct(now.planned, now.total)}
               label="On the roadmap"
               title="Of the days, the share on projects with a plan. Click to split the days by where the work came from."
               note={was(m => m.planned)}
               onClick={() => navigate({ by: 'origin' })}
            />
            <Tile
               value={pct(now.fires, now.total)}
               label="Fires"
               title="Of the days, the share on plans marked as a fire to put out. Click to split the days by where the work came from."
               note={was(m => m.fires)}
               onClick={() => navigate({ by: 'origin' })}
            />
            <Tile
               value={pct(now.unfiled, now.total)}
               label="Not filed"
               title="Of the days, the share on PRs with no project label. Click for the PRs that took the most."
               note={was(m => m.unfiled)}
               onClick={() => {
                  navigate({ by: 'project' });
                  setOpen('');
               }}
            />
            <Tile
               value={now.spread}
               label="Projects a week"
               title="The median, across people, of how many different projects each touched in a week they worked. A PR with no project counts on its own. Click for each person’s."
               note={then ? `${then.spread} the ${period}` : null}
               onClick={() => navigate({ by: 'person' })}
            />
         </div>
         <div className="mt-6 mb-3 flex flex-wrap items-center gap-3">
            <Segmented
               ariaLabel="split the days by"
               value={nav.by}
               options={BY_OPTIONS}
               onChange={by => {
                  navigate({ by });
                  setOpen(null);
               }}
            />
            <Segmented
               ariaLabel="which days"
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
            {groups.length > 0 && (
               <button
                  type="button"
                  onClick={copy}
                  className={quietButton}
                  title="Copy these numbers as plain text, for the retro’s notes"
               >
                  {copied ? 'Copied' : 'Copy as text'}
               </button>
            )}
         </div>
         {groups.length ? (
            <>
               <StatsCard
                  title={`${narrowed ?? 'Everyone'}’s days, week by week${kindWords}`}
                  sub={`${days(total)}, ${rangeWords(range)}`}
               >
                  <div className="mt-3">
                     <ChartSlot height={190}>
                        <DaysWeeksChart
                           weeks={data.weeks}
                           writing={writingWeeks}
                           reviewing={reviewingWeeks}
                        />
                     </ChartSlot>
                  </div>
               </StatsCard>
               <div className="mt-4">
                  <Rows>
                     {/* the list's column heads; the small bars share one scale and these weeks */}
                     <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-4 border-b border-line bg-muted/40 px-3.5 py-2 text-[11px] text-ink-3">
                        <span className="font-medium text-ink-2">
                           {BY_OPTIONS.find(([b]) => b === nav.by)?.[1]}
                        </span>
                        <span className="flex items-end gap-3 tabular-nums">
                           <span
                              className="flex w-28 justify-between"
                              title={`Each week’s days, oldest first, all rows on one scale: the tallest bar is ${days(
                                 top
                              )}`}
                           >
                              <span>{data.weeks.length ? dayWords(data.weeks[0]) : ''}</span>
                              <span>
                                 {data.weeks.length > 1
                                    ? dayWords(data.weeks[data.weeks.length - 1])
                                    : ''}
                              </span>
                           </span>
                           <span className="w-16 text-right">Days</span>
                           <span className="w-10 text-right">Share</span>
                           <span className="w-24">Before</span>
                        </span>
                     </div>
                     {groups.map(g => {
                        const prev = earlierGroups?.get(g.key);
                        return (
                           <GroupRow
                              key={g.key}
                              group={g}
                              weeks={data.weeks}
                              total={total}
                              top={top}
                              label={label(g.key)}
                              onName={openOf(nav.by, g.key, navigate)}
                              change={
                                 !earlierGroups
                                    ? null
                                    : prev == null
                                    ? 'new'
                                    : `was ${pct(prev, earlierTotal)}`
                              }
                              extra={
                                 nav.by === 'person'
                                    ? `${
                                         Math.round((spread.get(g.key) ?? 0) * 10) / 10
                                      } projects a week`
                                    : null
                              }
                              // with only writing or only reviewing days, the share says nothing
                              showWriting={nav.kind === 'all'}
                              open={open === g.key}
                              onToggle={() => setOpen(open === g.key ? null : g.key)}
                              detail={
                                 <Detail
                                    group={g}
                                    by={nav.by}
                                    rows={rows}
                                    data={data}
                                    nameOf={nameOf}
                                    onPerson={login => navigate({ who: login, by: 'project' })}
                                    onProject={slug => navigate({ project: slug })}
                                 />
                              }
                           />
                        );
                     })}
                  </Rows>
               </div>
            </>
         ) : (
            <p className="m-0 text-[13px] text-ink-3">No one touched a PR in these days.</p>
         )}
      </section>
   );
}

/** A group's name in the list. */
function labelOf(by: By, key: string, nameOf: (slug: string) => string): string {
   if (by === 'project') return key ? nameOf(key) : 'Not filed to a project';
   if (by === 'origin') {
      if (key === NOT_FILED) return 'Not filed to a project';
      if (key === NO_PLAN) return 'Filed, but not on the roadmap';
      if (key === UNSAID) return 'On the roadmap, origin not said';
      return ORIGIN_WORD[key as keyof typeof ORIGIN_WORD] ?? key;
   }
   if (by === 'author') return AUTHOR_WORDS[key] ?? key;
   if (by === 'team') return key === '(none)' ? 'No team' : key;
   if (by === 'repo') return shortRepo(key);
   return key;
}

/** What clicking a group's name does, or null when there's nowhere natural
 * to go and the row only opens in place. */
function openOf(by: By, key: string, navigate: Navigate): (() => void) | null {
   if (by === 'project') return key && key !== MISC_SLUG ? () => navigate({ project: key }) : null;
   if (by === 'origin') {
      // the roadmap filters its plans by origin; unplanned work has no plan
      if (key === NOT_FILED || key === NO_PLAN) return null;
      return () => navigate({ view: 'roadmap', origin: key as ProjectsNav['origin'], item: null });
   }
   if (by === 'team') return () => navigate({ team: key, by: 'project' });
   if (by === 'person') return () => navigate({ who: key, by: 'project' });
   return null;
}

/** Each week's days as a bar, on the scale `top`, the oldest week first. */
function Weeks({ weekly, weeks, top }: { weekly: number[]; weeks: string[]; top: number }) {
   return (
      <span className="flex h-5 w-28 items-end gap-px" aria-hidden>
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

function GroupRow({
   group,
   weeks,
   total,
   top,
   label,
   onName,
   change,
   extra,
   showWriting,
   open,
   onToggle,
   detail,
}: {
   group: RetroGroup;
   weeks: string[];
   total: number;
   top: number;
   label: string;
   onName: (() => void) | null;
   /** its share the period before, in words; null with nothing to compare */
   change: string | null;
   /** one more fact for the second line */
   extra: string | null;
   showWriting: boolean;
   open: boolean;
   onToggle: () => void;
   detail: ReactNode;
}) {
   const name = onName ? (
      <button
         type="button"
         onClick={e => {
            e.stopPropagation();
            onName();
         }}
         className="hit pressable min-w-0 truncate rounded border-0 bg-transparent p-0 text-left text-[13px] font-medium text-ink hover:text-brand hover:underline"
      >
         {label}
      </button>
   ) : (
      <span className="min-w-0 truncate text-[13px] font-medium text-ink">{label}</span>
   );
   const facts = [
      showWriting ? `${pct(group.writing, group.days)} writing` : null,
      group.merged ? `${group.merged} merged` : null,
      extra,
   ].filter(Boolean);
   return (
      <div className="border-t border-secondary first:border-t-0">
         {/* the row opens its PRs and people; its name goes where it names */}
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
            className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-3.5 py-2 hover:bg-muted/40"
         >
            <span className="flex min-w-0 flex-col gap-0.5">
               <span className="flex min-w-0 items-center gap-1.5">
                  <Icon icon={open ? ChevronDown : ChevronRight} size={12} />
                  {name}
               </span>
               <span className="flex min-w-0 items-center gap-2 pl-[18px] text-xs text-ink-3">
                  {facts.join(' · ')}
                  <PeopleStack logins={group.people.map(([login]) => login)} size={14} />
               </span>
            </span>
            <span className="flex items-center gap-3 text-xs text-ink-2 tabular-nums">
               <Weeks weekly={group.weekly} weeks={weeks} top={top} />
               <span className="w-16 text-right text-ink">{days(group.days)}</span>
               <span className="w-10 text-right">{pct(group.days, total)}</span>
               <span className="w-24 text-ink-3">{change ?? ''}</span>
            </span>
         </div>
         {open && detail}
      </div>
   );
}

/** Where a group's days went: its PRs with the most days, and who spent
 * them. A person's group lists their projects first. */
function Detail({
   group,
   by,
   rows,
   data,
   nameOf,
   onPerson,
   onProject,
}: {
   group: RetroGroup;
   by: By;
   rows: readonly RetroRow[];
   data: RetroData;
   nameOf: (slug: string) => string;
   onPerson: (login: string) => void;
   onProject: (slug: string) => void;
}) {
   const theirProjects =
      by === 'person'
         ? groupRows(
              rows.filter(r => r.login === group.key),
              r => r.pr.project ?? '',
              data
           ).slice(0, 6)
         : null;
   return (
      <div className="grid gap-4 border-t border-secondary bg-muted/30 px-3.5 py-3 pl-8 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
         <div className="min-w-0">
            {theirProjects && (
               <>
                  <h3 className="m-0 mb-1.5 text-xs font-semibold text-ink-2">Their projects</h3>
                  <ul className="m-0 mb-3 flex list-none flex-col gap-1 p-0 text-xs">
                     {theirProjects.map(p => (
                        <li key={p.key} className="flex items-baseline justify-between gap-3">
                           {p.key && p.key !== MISC_SLUG ? (
                              <button
                                 type="button"
                                 onClick={() => onProject(p.key)}
                                 className="pressable min-w-0 truncate rounded border-0 bg-transparent p-0 text-left text-xs text-ink hover:text-brand hover:underline"
                              >
                                 {nameOf(p.key)}
                              </button>
                           ) : (
                              <span className="min-w-0 truncate text-ink">
                                 {p.key ? nameOf(p.key) : 'Not filed to a project'}
                              </span>
                           )}
                           <span className="flex-none text-ink-3 tabular-nums">{days(p.days)}</span>
                        </li>
                     ))}
                  </ul>
               </>
            )}
            <h3 className="m-0 mb-1.5 text-xs font-semibold text-ink-2">
               The PRs that took the most days
            </h3>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs">
               {group.prs.slice(0, 8).map(([pr, d]) => (
                  <PrLine key={`${pr.repo}#${pr.number}`} pr={pr} days={d} />
               ))}
            </ul>
            {group.prs.length > 8 && (
               <p className="m-0 mt-1 text-xs text-ink-3">
                  and {n(group.prs.length - 8, 'more PR')}
               </p>
            )}
         </div>
         <div className="min-w-0">
            <h3 className="m-0 mb-1.5 text-xs font-semibold text-ink-2">Who spent them</h3>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs">
               {group.people.slice(0, 10).map(([login, d]) => (
                  <li key={login} className="flex items-baseline justify-between gap-3">
                     <button
                        type="button"
                        onClick={() => onPerson(login)}
                        className="pressable min-w-0 truncate rounded border-0 bg-transparent p-0 text-left text-xs text-ink hover:text-brand hover:underline"
                        title={`Only ${login}’s days`}
                     >
                        {login}
                     </button>
                     <span className="flex-none text-ink-3 tabular-nums">{days(d)}</span>
                  </li>
               ))}
            </ul>
         </div>
      </div>
   );
}

function PrLine({ pr, days: d }: { pr: RetroPr; days: number }) {
   const state = pr.merged
      ? `merged ${dayWords(new Date(pr.merged * 1000).toISOString().slice(0, 10))}`
      : pr.state === 'open'
      ? 'open'
      : 'closed';
   return (
      <li className="flex items-baseline justify-between gap-3">
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
      </li>
   );
}
