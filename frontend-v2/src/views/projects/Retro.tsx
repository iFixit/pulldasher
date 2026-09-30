import { n } from '../../../../shared/format';
import { MISC_SLUG } from '../../../../shared/model/projects';
import { groupTime, type TimeGroup } from '../../../../shared/model/retro';
import { ORIGIN_WORD, planFor, type RoadmapItem } from '../../../../shared/model/roadmap';
import { Segmented } from '../../components/bits';
import { Rows } from '../../components/Lane';
import { rangeWords, type Range } from '../../model/projectData';
import { useRetroData, type RetroData } from '../../model/retroData';
import { PeopleStack, type Navigate, type ProjectsNav } from './parts';

type Row = RetroData['rows'][number];
type By = ProjectsNav['by'];

const BY_OPTIONS: [By, string][] = [
   ['project', 'Project'],
   ['origin', 'Where it came from'],
   ['team', 'Team'],
   ['person', 'Person'],
   ['repo', 'Repo'],
];

// the origin split's groups beyond a plan's own word
const NOT_FILED = 'not-filed';
const NO_PLAN = 'no-plan';
const UNSAID = 'unsaid';

const days = (d: number) => `${d < 10 ? d.toFixed(1) : Math.round(d)} ${d === 1 ? 'day' : 'days'}`;
const pct = (part: number, whole: number) => `${whole ? Math.round((100 * part) / whole) : 0}%`;

/**
 * Look back: where the days went over the picked range. The unit is a
 * developer-day, a day someone opened, merged, commented on, stamped or
 * reviewed a PR, split across the PRs they touched that day
 * (shared/model/retro.ts), so a month-long project outweighs a one-line fix
 * the way it did in people's weeks. Each split is one list, most days first,
 * and each row does the natural thing on click: a project opens its page, an
 * origin opens those plans on the roadmap, a team or a person narrows the
 * list to their days.
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
   if (data === undefined) {
      return <p className="m-0 text-[13px] text-ink-3">Adding up the days…</p>;
   }
   if (data === null) {
      return (
         <p className="m-0 text-[13px] text-warn">Couldn’t load the days. Try again in a minute.</p>
      );
   }
   // a team or a person picked from a row narrows everything to their days
   const rows = data.rows.filter(
      r =>
         (!nav.team || (teamOf(r.login) ?? '(none)') === nav.team) &&
         (!nav.who || r.login === nav.who)
   );
   const total = rows.reduce((sum, r) => sum + r.days, 0);
   const writing = rows.reduce((sum, r) => sum + (r.own ? r.days : 0), 0);
   const filed = rows.reduce((sum, r) => sum + (r.project ? r.days : 0), 0);
   const people = new Set(rows.map(r => r.login)).size;
   const originOf = (r: Row) => {
      if (!r.project) return NOT_FILED;
      // one-offs are filed, just never planned
      if (r.project === MISC_SLUG) return NO_PLAN;
      const plan = planFor(r.project, plans);
      return !plan || plan.status === 'dropped' ? NO_PLAN : plan.origin ?? UNSAID;
   };
   const keyOf: Record<By, (r: Row) => string> = {
      project: r => r.project ?? '',
      origin: originOf,
      team: r => teamOf(r.login) ?? '(none)',
      person: r => r.login,
      repo: r => r.repo,
   };
   const groups = groupTime(rows, keyOf[nav.by]);
   const narrowed =
      nav.who ?? (nav.team ? (nav.team === '(none)' ? 'people on no team' : nav.team) : null);
   return (
      <section className="mb-7">
         <div className="mb-4">
            <h2 className="m-0 text-base font-semibold leading-snug">
               Where the time went{narrowed ? `, ${narrowed}` : ''}
            </h2>
            <p className="m-0 mt-1 max-w-[72ch] text-[13px] text-ink-2">
               {rangeWords(range)}: {days(total)} from{' '}
               {n(
                  people,
                  data.counted === 'developers' ? 'developer' : 'person',
                  data.counted === 'developers' ? 'developers' : 'people'
               )}
               , {pct(writing, total)} writing and {pct(total - writing, total)} reviewing.
               {total > 0 && filed < total * 0.5 && (
                  <>
                     {' '}
                     {pct(total - filed, total)} of it went to PRs with no project label, so the
                     project split mostly shows who filed their PRs.
                  </>
               )}
            </p>
            <p className="m-0 mt-1 max-w-[72ch] text-xs text-ink-3">
               A day counts once for each person who opened, merged, commented on, stamped or
               reviewed a PR that day, split across the PRs they touched. Commits aren’t counted;
               here they add about 4%, since PRs open and merge within a day or two.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
               <Segmented
                  ariaLabel="split the days by"
                  value={nav.by}
                  options={BY_OPTIONS}
                  onChange={by => navigate({ by })}
               />
               {narrowed && (
                  <button
                     type="button"
                     onClick={() => navigate({ who: null, team: null })}
                     className="pressable rounded border-0 bg-transparent p-0 text-xs text-ink-3 underline hover:text-brand"
                  >
                     Show everyone’s days
                  </button>
               )}
            </div>
         </div>
         {groups.length ? (
            <Rows>
               {groups.map(g => (
                  <GroupRow
                     key={g.key}
                     group={g}
                     total={total}
                     label={labelOf(nav.by, g.key, nameOf)}
                     onOpen={openOf(nav.by, g.key, navigate)}
                  />
               ))}
            </Rows>
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
   if (by === 'team') return key === '(none)' ? 'No team' : key;
   return key;
}

/** What clicking a group does, or null when there's nowhere natural to go. */
function openOf(by: By, key: string, navigate: Navigate): (() => void) | null {
   if (by === 'project') return key && key !== MISC_SLUG ? () => navigate({ project: key }) : null;
   if (by === 'origin') {
      // the roadmap filters its plans by origin; unfiled work has no plan
      if (key === NOT_FILED || key === NO_PLAN) return null;
      return () => navigate({ view: 'roadmap', origin: key as ProjectsNav['origin'], item: null });
   }
   if (by === 'team') return () => navigate({ team: key, by: 'project' });
   if (by === 'person') return () => navigate({ who: key, by: 'project' });
   return null;
}

function GroupRow({
   group,
   total,
   label,
   onOpen,
}: {
   group: TimeGroup;
   total: number;
   label: string;
   onOpen: (() => void) | null;
}) {
   const share = total ? group.days / total : 0;
   const name = onOpen ? (
      <button
         type="button"
         onClick={onOpen}
         className="hit pressable min-w-0 truncate rounded border-0 bg-transparent p-0 text-left text-[13px] font-medium text-ink hover:text-brand"
      >
         {label}
      </button>
   ) : (
      <span className="min-w-0 truncate text-[13px] font-medium text-ink">{label}</span>
   );
   return (
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-t border-secondary px-3.5 py-2.5 first:border-t-0 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
         {name}
         <div className="order-last col-span-2 h-1.5 rounded-full bg-muted sm:order-none sm:col-span-1">
            <div
               className="h-full rounded-full bg-brand"
               style={{ width: `${Math.max(share * 100, 0.5)}%` }}
               title={`${pct(group.days, total)} of the days`}
            />
         </div>
         <span className="flex items-center gap-3 text-xs text-ink-2 tabular-nums">
            <span className="w-14 text-right">{days(group.days)}</span>
            <span className="w-9 text-right text-ink-3">{pct(group.days, total)}</span>
            <span
               className="w-24 text-ink-3"
               title="Days on PRs they wrote, against days reviewing others’"
            >
               {pct(group.writing, group.days)} writing
            </span>
            {/* a fixed width, so every row's bar runs on the same scale */}
            <span className="flex w-16 justify-end">
               <PeopleStack logins={group.people} />
            </span>
         </span>
      </div>
   );
}
