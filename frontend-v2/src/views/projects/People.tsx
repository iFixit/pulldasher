import type { ReactNode } from 'react';
import { projectName, type PersonWindow, type Today } from '../../../../shared/model/projects';
import { Rows, eyebrowText } from '../../components/Lane';
import { rangeDays, rangeWords, type ProjectsData, type Range } from '../../model/projectData';
import { PersonCell, StatsCard } from '../stats/parts';
import { ChartSlot, SplitWeeksChart } from './lazyCharts';
import { Tile, versus } from './parts';

/** Live projects one person can have work in before the list says so. */
export const SPREAD_THIN = 4;

interface PersonRow {
   login: string;
   team: string | null;
   /** live projects they have an open PR or a recent merge in, by name */
   live: string[];
   openNow: number;
   w: PersonWindow | null;
}

/**
 * Everyone the tab knows about: every developer team member from config
 * (even with nothing in flight, since an idle developer is news too), and
 * anyone else with a PR in the range or on a live project.
 */
function peopleRows(
   data: ProjectsData,
   today: Today,
   teamOf: (login: string) => string | null
): PersonRow[] {
   const live = new Map<string, string[]>();
   for (const g of today.live)
      for (const login of g.people) live.set(login, [...(live.get(login) ?? []), projectName(g)]);
   const openNow = new Map<string, number>();
   for (const p of [...today.live.flatMap(g => g.open), ...today.misc, ...today.unsorted])
      openNow.set(p.data.user.login, (openNow.get(p.data.user.login) ?? 0) + 1);
   // one entry per person whatever case a login arrives in
   const byKey = new Map<string, string>();
   for (const login of [
      ...Object.values(data.teams).flat(),
      ...Object.keys(data.window.people),
      ...live.keys(),
      ...openNow.keys(),
   ])
      if (!byKey.has(login.toLowerCase())) byKey.set(login.toLowerCase(), login);
   return [...byKey.values()].map(login => ({
      login,
      team: teamOf(login),
      live: (live.get(login) ?? []).sort(),
      openNow: openNow.get(login) ?? 0,
      w: data.window.people[login] ?? null,
   }));
}

const cols = 'grid grid-cols-[minmax(0,1fr)_6rem_4rem_4rem_4rem_5rem_6rem] items-center gap-3';
const hideSmall = 'hidden sm:block';

function HeaderRow() {
   const head = (label: string, title: string, extra = '') => (
      <span className={`text-right ${extra}`} title={title}>
         {label}
      </span>
   );
   return (
      <div className={`${cols} border-b border-line bg-muted/40 px-3.5 py-[7px] text-ink-3 ${eyebrowText}`}>
         <span>Person</span>
         {head('Live projects', 'Live projects they have an open PR or a recent merge in')}
         {head('Open', 'Their open PRs now')}
         {head('Opened', 'PRs they opened in the range', hideSmall)}
         {head('Merged', 'PRs of theirs merged in the range', hideSmall)}
         {head('Reviews', 'CR and QA stamps they gave on other people’s PRs in the range')}
         {head('On others’', 'Of those reviews, the ones on non-developers’ PRs', hideSmall)}
      </div>
   );
}

function PersonLine({
   row,
   me,
   onPerson,
}: {
   row: PersonRow;
   me: string;
   onPerson: (login: string) => void;
}) {
   const spread = row.live.length >= SPREAD_THIN;
   const num = (n: number | undefined, extra = '') => (
      <span className={`text-right tabular-nums ${extra}`}>{n || ''}</span>
   );
   return (
      <div className={`${cols} border-t border-secondary px-3.5 py-2 text-xs text-ink-2 first:border-t-0`}>
         <span className="flex min-w-0 items-center gap-2 text-[13px]">
            <PersonCell login={row.login} me={me} onPerson={onPerson} />
         </span>
         <span
            className={`truncate text-right tabular-nums ${spread ? 'text-warn' : ''}`}
            title={
               row.live.length
                  ? `${row.live.join(', ')}${spread ? `. That's ${row.live.length} at once.` : ''}`
                  : 'No live projects'
            }
         >
            {row.live.length || ''}
         </span>
         {num(row.openNow)}
         {num(row.w?.opened, hideSmall)}
         {num(row.w?.merged, hideSmall)}
         {num(row.w?.reviews)}
         {num(row.w?.reviews_on_non_dev, hideSmall)}
      </div>
   );
}

function Section({
   title,
   rows,
   me,
   onPerson,
}: {
   title: string;
   rows: PersonRow[];
   me: string;
   onPerson: (login: string) => void;
}) {
   if (!rows.length) return null;
   const sorted = [...rows].sort(
      (a, b) =>
         b.live.length - a.live.length ||
         b.openNow - a.openNow ||
         (b.w?.merged ?? 0) - (a.w?.merged ?? 0) ||
         a.login.localeCompare(b.login)
   );
   return (
      <>
         <div
            className={`border-t border-secondary bg-muted/40 px-3.5 py-[6px] text-ink-3 first:border-t-0 ${eyebrowText}`}
         >
            {title} <span className="tabular-nums">· {rows.length}</span>
         </div>
         {sorted.map(row => (
            <PersonLine key={row.login} row={row} me={me} onPerson={onPerson} />
         ))}
      </>
   );
}

/**
 * The people view: who is on what, and whether review keeps up. Developers
 * sit in their teams from config; everyone else with PRs is a non-developer,
 * whose work needs a developer's review. The two weekly charts show who
 * opened the PRs and whose PRs the reviews went to, and the list puts anyone
 * on four or more live projects in amber.
 */
export function People({
   data,
   prev,
   today,
   range,
   teamOf,
   me,
   onPerson,
}: {
   data: ProjectsData | null | undefined;
   prev: ProjectsData | null | undefined;
   today: Today;
   range: Range;
   teamOf: (login: string) => string | null;
   me: string;
   onPerson: (login: string) => void;
}) {
   if (data === undefined) return <p className="text-[13px] text-ink-3">Loading the numbers…</p>;
   if (data === null) {
      return (
         <p className="text-[13px] text-ink-3">
            Couldn’t load the numbers for this range. Try again in a minute.
         </p>
      );
   }
   const rows = peopleRows(data, today, teamOf);
   const teams = Object.keys(data.teams);
   const period = `${rangeDays(range)} days before`;
   const sum = (pick: (w: PersonWindow) => number, dev: boolean, d: ProjectsData | null | undefined) =>
      Object.values(d?.window.people ?? {})
         .filter(w => (w.team != null) === dev)
         .reduce((s, w) => s + pick(w), 0);
   const opened = data.window.totals.opened;
   const openedByOthers = sum(w => w.opened, false, data);
   const reviews = sum(w => w.reviews, true, data);
   const reviewsOnOthers = sum(w => w.reviews_on_non_dev, true, data);
   const spread = rows.filter(r => r.live.length >= SPREAD_THIN).length;
   const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
   const noTeams = !teams.length;
   const card = (title: string, children: ReactNode) => (
      <StatsCard title={title} sub={rangeWords(range)}>
         <div className="mt-3">{children}</div>
      </StatsCard>
   );
   return (
      <div className="flex flex-col gap-5">
         {noTeams && (
            <p className="m-0 text-xs text-ink-3">
               No developer teams are set up (config.js, projects.developerTeams), so everyone shows
               as a non-developer.
            </p>
         )}
         <StatsCard>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
               <Tile
                  value={`${pct(openedByOthers, opened)}%`}
                  label="Of PRs opened, by non-developers"
                  title="The share of the range's new PRs that someone outside the developer teams opened"
                  note={`${openedByOthers} of ${opened}`}
               />
               <Tile
                  value={reviews}
                  label="Reviews developers gave"
                  title="CR and QA stamps developers gave on other people's PRs in the range"
                  note={versus(reviews, prev ? sum(w => w.reviews, true, prev) : null, period)}
               />
               <Tile
                  value={`${pct(reviewsOnOthers, reviews)}%`}
                  label="Of those, on non-developers’ PRs"
                  title="How much of the developers' reviewing went to PRs from outside the developer teams"
                  note={`${reviewsOnOthers} of ${reviews}`}
               />
               <Tile
                  value={spread}
                  label={`On ${SPREAD_THIN} or more live projects`}
                  title="People with work in this many live projects at once"
               />
            </div>
         </StatsCard>
         <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(380px,1fr))]">
            {card(
               'Who opened PRs',
               <ChartSlot height={200}>
                  <SplitWeeksChart
                     weeks={data.window.weeks}
                     pick={w => [w.opened.developers, w.opened.non_developers]}
                     labels={['Developers', 'Non-developers']}
                     ariaLabel="PRs opened each week, by developers and by non-developers"
                  />
               </ChartSlot>
            )}
            {card(
               'Whose PRs got the reviews',
               <ChartSlot height={200}>
                  <SplitWeeksChart
                     weeks={data.window.weeks}
                     pick={w => [w.reviews.on_developers, w.reviews.on_non_developers]}
                     labels={['On developers’ PRs', 'On non-developers’ PRs']}
                     ariaLabel="Reviews given each week, split by whether a developer or a non-developer wrote the PR"
                  />
               </ChartSlot>
            )}
         </div>
         <section>
            <h2 className="m-0 mb-2 text-base font-semibold leading-snug">Everyone</h2>
            <Rows>
               <HeaderRow />
               {teams.map(team => (
                  <Section
                     key={team}
                     title={team}
                     rows={rows.filter(r => r.team === team)}
                     me={me}
                     onPerson={onPerson}
                  />
               ))}
               <Section
                  title="Non-developers"
                  rows={rows.filter(r => r.team == null)}
                  me={me}
                  onPerson={onPerson}
               />
            </Rows>
         </section>
      </div>
   );
}
