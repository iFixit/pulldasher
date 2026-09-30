import { useState } from 'react';
import { Check } from 'lucide-react';
import { n } from '../../../../shared/format';
import {
   compareRows,
   decideProjects,
   decideQueue,
   DECIDE_MIN_PRS,
   STALL_DAYS,
   type ClosedIssue,
   type DecideReason,
   type DecideRow,
} from '../../../../shared/model/decide';
import { firstOpenDay, LIVE_DAYS, type Today } from '../../../../shared/model/projects';
import { decideTurn, type DecideRotation } from '../../../../shared/model/settings';
import {
   addWeeks,
   HEALTH_WORD,
   mondayOf,
   ORIGIN_WORD,
   planEnd,
   planFor,
   ROADMAP_ORIGINS,
   weeksThrough,
   type RoadmapFields,
   type RoadmapItem,
   type RoadmapOrigin,
} from '../../../../shared/model/roadmap';
import { Segmented, textInputClass } from '../../components/bits';
import { Icon } from '../../components/Icon';
import { GroupHeader, Rows } from '../../components/Lane';
import { useArmedConfirm } from '../../components/useArmedConfirm';
import { mainTeam, type PortfolioItem } from '../../model/portfolio';
import { dayOf, dayWords } from '../../model/projectData';
import { commitEnds } from '../../model/roadmapTime';
import { saveDecideRotation } from '../../model/settingsData';
import {
   createRoadmapItem,
   dismissRoadmapProblem,
   updateRoadmapItem,
   useRoadmap,
} from '../../model/roadmapData';
import { openPlan, type Navigate, type ProjectsNav } from './parts';
import { PLAN_STATUS_WORD } from './roadmapHealth';

/** The decisions owed now, worst first, for this view, the tab's label and
 * the Overview's tile. */
export function decideRows(
   today: Today,
   items: readonly RoadmapItem[],
   closed: ReadonlyMap<string, ClosedIssue>
): DecideRow[] {
   return decideQueue({
      live: decideProjects(today),
      items,
      closed,
      today: dayOf(new Date()),
      now: Date.now() / 1000,
   });
}

/** The queue's sections, worst first, as decide.ts ranks them. A row sits
 * in the first section any of its reasons names. */
const SECTIONS: [DecideReason['kind'][], string, string][] = [
   [
      ['reopened'],
      'Still open after a decision',
      'Marked done or dropped a week ago or more, here or on its issue',
   ],
   [
      ['issue_closed'],
      'Issue closed, plan still going',
      'Its issue closed after the plan last changed',
   ],
   [['moving'], 'Parked, but moving', 'Its PRs changed after it was parked'],
   [['off_track'], 'Off track', 'Its latest update says so'],
   [['missed'], 'Missed a target', 'The target date passed with PRs still open'],
   [['over', 'ended'], 'Past their plans', 'The planned end has passed'],
   [['stalled'], 'Stalled', `Open PRs, no activity for ${STALL_DAYS} days`],
   [['at_risk'], 'At risk', 'Its latest update says so'],
   [['new'], 'New', `In flight with ${DECIDE_MIN_PRS} or more PRs, never decided`],
];

const sectionOf = (row: DecideRow) =>
   SECTIONS.findIndex(([kinds]) => row.reasons.some(r => kinds.includes(r.kind)));

const rowKey = (row: DecideRow) => `${row.slug ?? ''}:${row.item?.id ?? ''}`;
const kindsOf = (row: DecideRow) => row.reasons.map(r => r.kind).join(',');

const closedAs = (as: 'done' | 'dropped') => (as === 'done' ? 'completed' : 'not planned');

/** Why a row is here, in the words of the call it needs. */
function reasonWords(reason: DecideReason, item: RoadmapItem | null): string {
   switch (reason.kind) {
      case 'new':
         return reason.since
            ? `In flight since ${dayWords(reason.since)} with no decision`
            : 'In flight with no decision';
      case 'stalled':
         return `No PR activity for ${reason.days} days`;
      case 'over':
         return `Still in flight ${n(reason.weeks, 'week')} past its planned end`;
      case 'ended':
         return `Its plan ended ${n(reason.weeks, 'week')} ago and no PRs are open: done?`;
      case 'missed':
         return `Missed its ${dayWords(reason.due)} target with ${n(reason.open, 'PR')} open`;
      case 'off_track':
      case 'at_risk': {
         const u = item?.update;
         const said = u?.body ? `: ${u.body.split('\n')[0]}` : '';
         return `${HEALTH_WORD[reason.kind]}, says ${u?.author ?? 'its lead'}${said}`;
      }
      case 'issue_closed':
         return `Its issue was closed as ${closedAs(reason.as)} on ${dayWords(
            reason.on
         )}, but the plan still says ${
            item ? PLAN_STATUS_WORD[item.status].toLowerCase() : 'going'
         }`;
      case 'reopened': {
         const still = `${n(reason.open, 'PR is', 'PRs are')} still open`;
         return reason.by === 'issue'
            ? `Its issue was closed as ${closedAs(reason.as)}, but ${still}`
            : `Marked ${reason.as} on the roadmap, but ${still}`;
      }
      case 'moving':
         return 'Parked, but its PRs changed since';
   }
}

/** Where a plan the row makes starts: its item's start, or else the week
 * its first open PR opened. */
function startOf(row: DecideRow, project: PortfolioItem | undefined, today: string): string {
   if (row.item) return row.item.start;
   return mondayOf((project?.group && firstOpenDay(project.group)) || today);
}

/** A call made on this page, kept in the row's place so it doesn't vanish. */
interface Decided {
   /** the row as it stood when the call was made */
   row: DecideRow;
   words: string;
   /** the roadmap item holding the call; null while a new one is saving */
   id: number | null;
}

// the calls made since the page loaded, so a trip to a project's page and
// back still shows them
let madeThisVisit: ReadonlyMap<string, Decided> = new Map();

const buttonClass =
   'hit pressable rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-ink-2 hover:border-brand hover:text-brand disabled:opacity-40';
const quietButton =
   'pressable rounded border-0 bg-transparent p-0 text-left text-xs text-ink-3 hover:underline';

/** Its facts, in words a decision turns on: team, size, people, target. */
function Facts({
   project,
   team,
   onTeam,
   onProject,
}: {
   project: PortfolioItem | undefined;
   team: string | null;
   onTeam: (team: string) => void;
   onProject: () => void;
}) {
   const merged = project?.group?.merged.length ?? 0;
   const people = project ? [...project.developers, ...project.nonDevelopers] : [];
   const size = project
      ? [
           project.open ? `${project.open} open` : null,
           merged ? `${merged} merged in ${LIVE_DAYS} days` : null,
           people.length ? n(people.length, 'person', 'people') : null,
        ].filter(Boolean)
      : [];
   const due = project?.target?.due_on;
   const facts = [
      team && (
         <button
            type="button"
            key="team"
            onClick={() => onTeam(team)}
            className={quietButton}
            title={`Show only ${team}’s decisions`}
         >
            {team}
         </button>
      ),
      size.length > 0 && (
         <button
            type="button"
            key="size"
            onClick={onProject}
            className={quietButton}
            title={`${people.join(', ')}. Open the project and its PRs.`}
         >
            {size.join(', ')}
         </button>
      ),
      due && (
         <span key="due" className="text-xs text-ink-3">
            target {dayWords(due)}
         </span>
      ),
   ].filter(Boolean);
   return (
      <>
         {facts.map((fact, i) => (
            // the dot trails its fact, so a wrapped line never starts with one
            <span key={i} className="inline-flex items-baseline gap-x-2">
               {fact}
               {i < facts.length - 1 && (
                  <span aria-hidden className="text-xs text-ink-3">
                     ·
                  </span>
               )}
            </span>
         ))}
      </>
   );
}

function DecideRowView({
   row,
   decided,
   project,
   team,
   today,
   commitTo,
   decide,
   nav,
   navigate,
}: {
   row: DecideRow;
   /** the call made on it here, if any */
   decided: Decided | undefined;
   project: PortfolioItem | undefined;
   team: string | null;
   today: string;
   commitTo: { label: string; end: string }[];
   decide: (row: DecideRow, fields: Partial<RoadmapFields>, words: string) => void;
   nav: ProjectsNav;
   navigate: Navigate;
}) {
   const { armed, run } = useArmedConfirm();
   const name = row.item?.name ?? project?.name ?? row.slug ?? 'A plan';
   const lead = row.item?.lead ?? project?.lead ?? null;
   const start = startOf(row, project, today);
   const { item } = row;
   // where the work came from rides along with the call, so saying it
   // alone never counts as deciding
   const [origin, setOrigin] = useState<RoadmapOrigin | null>(item?.origin ?? null);
   const call = (fields: Partial<RoadmapFields>, words: string) =>
      decide(row, { ...fields, origin }, words);
   const openProject = () =>
      row.slug ? navigate({ project: row.slug }) : item && navigate(openPlan(nav, item.id));
   return (
      // a decided row keeps every line it had, so the rows below never slide
      // under the pointer between two clicks
      <div className="border-t border-secondary px-3.5 py-2.5 first:border-t-0">
         <div className={decided ? 'opacity-60' : ''}>
            <div className="flex flex-wrap items-baseline gap-x-2">
               <button
                  type="button"
                  onClick={openProject}
                  className="hit pressable rounded border-0 bg-transparent p-0 text-left text-[13px] font-medium text-ink hover:text-brand"
                  title={row.slug ? 'Open the project and its PRs' : 'Open its plan on the roadmap'}
               >
                  {name}
               </button>
               {lead && (
                  <button
                     type="button"
                     onClick={() => navigate({ view: 'roadmap', find: lead, item: null })}
                     className={quietButton}
                     title={`Show only ${lead}’s work on the roadmap`}
                  >
                     {lead}
                  </button>
               )}
               <Facts
                  project={project}
                  team={team}
                  onTeam={t => navigate({ team: t })}
                  onProject={openProject}
               />
            </div>
            {row.reasons.map(reason =>
               // a reason about the plan opens the plan, where its bar shows it
               item ? (
                  <button
                     type="button"
                     key={reason.kind}
                     onClick={() => navigate(openPlan(nav, item.id))}
                     className="pressable block rounded border-0 bg-transparent p-0 text-left text-[13px] text-ink-2 hover:underline"
                     title="Open its plan on the roadmap"
                  >
                     {reasonWords(reason, item)}
                  </button>
               ) : (
                  <p key={reason.kind} className="m-0 text-[13px] text-ink-2">
                     {reasonWords(reason, item)}
                  </p>
               )
            )}
         </div>
         <div className="mt-1.5 flex min-h-[22px] flex-wrap items-center gap-1.5 text-xs text-ink-3">
            {decided ? (
               <>
                  <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-2">
                     <Icon icon={Check} size={14} />
                     {decided.words}.
                  </span>
                  {decided.id == null ? (
                     'Saving…'
                  ) : (
                     <button
                        type="button"
                        onClick={() => navigate(openPlan(nav, decided.id as number))}
                        className="pressable rounded border-0 bg-transparent p-0 text-xs text-ink-3 underline hover:text-brand"
                     >
                        Change it on the roadmap
                     </button>
                  )}
               </>
            ) : (
               <>
                  Commit through
                  {commitTo.map(c => {
                     const weeks = weeksThrough(start, c.end);
                     return (
                        <button
                           type="button"
                           key={c.end}
                           onClick={() =>
                              call(
                                 { status: 'active', start, weeks },
                                 // "End of Q4" reads "the end of Q4"
                                 `Committed through the ${c.label.replace(/^End/, 'end')}`
                              )
                           }
                           title={`Plan it from ${dayWords(start)} to ${dayWords(
                              planEnd({ start, weeks })
                           )}`}
                           className={buttonClass}
                        >
                           {c.label}
                        </button>
                     );
                  })}
                  <span className="mx-1">or</span>
                  <button
                     type="button"
                     onClick={() => call({ status: 'parked' }, 'Parked')}
                     title="Stop for now without dropping it. It leaves the load until someone picks it up."
                     className={buttonClass}
                  >
                     Park
                  </button>
                  <button
                     type="button"
                     onClick={() => call({ status: 'done' }, 'Finished')}
                     title="It’s done"
                     className={buttonClass}
                  >
                     Finish
                  </button>
                  <button
                     type="button"
                     onClick={() => run(() => call({ status: 'dropped' }, 'Dropped'))}
                     title="We won’t do it"
                     className={
                        armed
                           ? 'hit pressable rounded-md border border-warn bg-surface px-2 py-0.5 text-xs font-semibold text-warn'
                           : buttonClass
                     }
                  >
                     {armed ? 'Click again to drop it' : 'Drop'}
                  </button>
                  <span
                     className="ml-2 inline-flex flex-wrap items-baseline gap-x-1.5"
                     title="Where the work came from. It’s saved with the call you make here."
                  >
                     came from
                     {ROADMAP_ORIGINS.map(o => (
                        <button
                           type="button"
                           key={o}
                           aria-pressed={origin === o}
                           onClick={() => setOrigin(origin === o ? null : o)}
                           className={`pressable rounded border-0 bg-transparent p-0 text-xs hover:underline ${
                              origin === o ? 'font-semibold text-ink' : 'text-ink-3'
                           }`}
                        >
                           {ORIGIN_WORD[o].toLowerCase()}
                        </button>
                     ))}
                  </span>
               </>
            )}
         </div>
      </div>
   );
}

/**
 * Who runs Decide this week: with no product manager, the list needs a name
 * on it, so people take turns a week each. Changing the turns starts them
 * over from the first name this week.
 */
function RunsDecide({ rotation, day }: { rotation: DecideRotation | null; day: string }) {
   const [draft, setDraft] = useState<string | null>(null);
   const [error, setError] = useState<string | null>(null);
   const now = decideTurn(rotation, day);
   const next = decideTurn(rotation, addWeeks(day, 1));
   const close = () => {
      setDraft(null);
      setError(null);
   };
   const save = async () => {
      const logins = (draft ?? '').split(/[\s,]+/).filter(Boolean);
      const saved = await saveDecideRotation(logins.length ? logins : null);
      if ('error' in saved) setError(saved.error);
      else close();
   };
   if (draft == null) {
      return (
         <p className="m-0 mt-2 text-[13px] text-ink-2">
            {now ? (
               <>
                  <span className="font-medium text-ink">{now}</span> runs Decide this week
                  {next && next !== now ? `, ${next} next week` : ''}.
               </>
            ) : (
               'Nobody runs Decide yet.'
            )}{' '}
            <button
               type="button"
               onClick={() => setDraft(rotation?.logins.join(', ') ?? '')}
               className={quietButton}
               title="People take turns running Decide, a week each"
            >
               {now ? 'Change the turns' : 'Name who takes turns'}
            </button>
         </p>
      );
   }
   return (
      <form
         className="mt-2 flex flex-wrap items-end gap-2"
         onSubmit={e => {
            e.preventDefault();
            void save();
         }}
         onKeyDown={e => {
            if (e.key === 'Escape') close();
         }}
      >
         <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-xs text-ink-3">
            Who takes turns running Decide, a week each, the first one this week
            <input
               autoFocus
               className={`px-2.5 ${textInputClass}`}
               value={draft}
               onChange={e => setDraft(e.target.value)}
               placeholder="GitHub logins, separated by commas or spaces"
            />
         </label>
         <button type="submit" className={buttonClass}>
            Save
         </button>
         <button type="button" onClick={close} className={quietButton}>
            Cancel
         </button>
         {error && (
            <span role="alert" className="basis-full text-xs text-warn">
               {error}
            </span>
         )}
      </form>
   );
}

/**
 * Decide: the weekly triage a product manager would run, as a queue that
 * empties. Every row is a project or plan that needs a call, and says why,
 * with the facts the call turns on. Each call (commit it through a month
 * or quarter, park, finish, drop) is one click that writes the roadmap; the
 * row stays in place saying what was decided, so nothing vanishes
 * unexplained. It weighs every project, whatever the filter bar narrows
 * the rest of the tab to. Worst first; a team's lead can take just theirs.
 */
export function Decide({
   today,
   items,
   closed,
   teamOf,
   teamMembers,
   rotation,
   scoped,
   nav,
   navigate,
}: {
   /** Today from every PR, not the filter bar's */
   today: Today;
   /** the portfolio from the same, for names, leads, sizes and teams */
   items: PortfolioItem[];
   closed: ReadonlyMap<string, ClosedIssue>;
   teamOf: (login: string) => string | null;
   teamMembers: Record<string, string[]>;
   /** who takes turns running this list; null for nobody */
   rotation: DecideRotation | null;
   /** whether the filter bar narrows the rest of the tab */
   scoped: boolean;
   nav: ProjectsNav;
   navigate: Navigate;
}) {
   const { items: plans, loadFailed, problem } = useRoadmap();
   const [decided, setDecided] = useState(madeThisVisit);
   const [copied, setCopied] = useState(false);
   const record = (next: (d: ReadonlyMap<string, Decided>) => ReadonlyMap<string, Decided>) =>
      setDecided(d => (madeThisVisit = next(d)));
   const day = dayOf(new Date());
   const bySlug = new Map(items.map(i => [i.slug, i]));
   if (!plans) {
      return (
         <p className="text-[13px] text-ink-3">
            {loadFailed ? 'Couldn’t load the roadmap. Try again in a minute.' : 'Loading…'}
         </p>
      );
   }
   const projectOf = (row: DecideRow) => (row.slug ? bySlug.get(row.slug) : undefined);
   // the team a row belongs to: its plan's, or the team most of its
   // developers are on, as the roadmap's lanes split them
   const teamOfRow = (row: DecideRow): string | null => {
      const project = projectOf(row);
      return row.item?.team ?? (project ? mainTeam(project, teamOf) : null);
   };
   const queue = decideRows(today, plans, closed);
   const byKey = new Map(queue.map(row => [rowKey(row), row]));
   // a call made here shows as made, unless its row came back for a new reason
   const settled = new Map(
      [...decided].filter(([key, d]) => {
         const again = byKey.get(key);
         return !again || kindsOf(again) === kindsOf(d.row);
      })
   );
   const rows = queue.filter(row => !settled.has(rowKey(row)));
   const inTeam = (row: DecideRow) => !nav.team || (teamOfRow(row) ?? '(none)') === nav.team;
   const all = [...rows, ...[...settled.values()].map(d => d.row)].filter(inTeam).sort(compareRows);
   const owed = rows.filter(inTeam);
   const commitTo = commitEnds(day);

   const decide = (row: DecideRow, fields: Partial<RoadmapFields>, words: string) => {
      const key = rowKey(row);
      // shown as made at once, so nothing moves while it saves
      record(d => new Map(d).set(key, { row, words, id: row.item?.id ?? null }));
      const forget = () =>
         record(d => {
            const next = new Map(d);
            next.delete(key);
            return next;
         });
      if (row.item) {
         void updateRoadmapItem(row.item.id, fields).then(ok => ok || forget());
         return;
      }
      // a first decision records the work so far, from its first open PR's
      // week through this one, unless it commits further
      const project = projectOf(row);
      const start = startOf(row, project, day);
      void createRoadmapItem({
         name: project?.name ?? row.slug ?? 'A project',
         project: row.slug,
         team: project ? mainTeam(project, teamOf) : null,
         lead: project?.lead ?? null,
         start,
         weeks: weeksThrough(start, day),
         ...fields,
      }).then(created =>
         created ? record(d => new Map(d).set(key, { row, words, id: created.id })) : forget()
      );
   };

   const nameOf = (row: DecideRow) =>
      row.item?.name ?? projectOf(row)?.name ?? row.slug ?? 'A plan';
   // the list as plain text, for the weekly meeting's notes or a chat post
   const copy = () => {
      const lines = SECTIONS.flatMap(([, title], index) => {
         const inSection = owed.filter(row => sectionOf(row) === index);
         if (!inSection.length) return [];
         return [
            title,
            ...inSection.map(row => {
               const lead = row.item?.lead ?? projectOf(row)?.lead;
               const why = row.reasons.map(r => reasonWords(r, row.item)).join('; ');
               return `- ${nameOf(row)}${lead ? ` (${lead})` : ''}: ${why}`;
            }),
         ];
      });
      const whose = !nav.team ? '' : nav.team === '(none)' ? ' with no team' : ` for ${nav.team}`;
      const runner = decideTurn(rotation, day);
      void navigator.clipboard
         ?.writeText(
            [
               `${n(owed.length, 'decision')} to make${whose}, ${dayWords(day)}`,
               ...(runner ? [`${runner} runs Decide this week`] : []),
               ...lines,
            ].join('\n')
         )
         .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
         });
   };

   // each team's decisions still owed, and its size, for the team switch
   const teams = Object.keys(teamMembers).sort();
   const owedBy = (team: string) =>
      rows.filter(row => (teamOfRow(row) ?? '(none)') === team).length;
   const liveIn = (team: string) =>
      items.filter(
         i =>
            i.status === 'live' &&
            (planFor(i.slug, plans)?.team ?? mainTeam(i, teamOf) ?? '(none)') === team
      ).length;
   return (
      <section className="mb-7">
         <div className="mb-4">
            <div className="flex flex-wrap items-baseline gap-x-3">
               <h2 className="m-0 text-base font-semibold leading-snug">
                  {owed.length ? `${n(owed.length, 'decision')} to make` : 'Nothing to decide'}
                  {nav.team && (nav.team === '(none)' ? ' with no team' : ` for ${nav.team}`)}
               </h2>
               {owed.length > 0 && (
                  <button
                     type="button"
                     onClick={copy}
                     className="hit pressable rounded border-0 bg-transparent p-0 text-xs text-ink-3 hover:text-brand"
                     title="Copy this list as plain text, for the meeting’s notes or a chat post"
                  >
                     {copied ? 'Copied' : 'Copy as text'}
                  </button>
               )}
            </div>
            <p className="m-0 mt-1 max-w-[72ch] text-[13px] text-ink-2">
               {owed.length
                  ? 'Each needs a call: commit to it through a month or quarter, park it, finish it, or drop it. The roadmap keeps the call.'
                  : 'New projects, stalls, and plans that slip or go off track show up here.'}{' '}
               Park stops work for now without dropping it, and takes it out of the roadmap’s load.
               Work with fewer than {DECIDE_MIN_PRS} PRs, open or merged in the last {LIVE_DAYS}{' '}
               days, ships without a call unless it stalls.
            </p>
            <RunsDecide rotation={rotation} day={day} />
            {scoped && (
               <p className="m-0 mt-1 max-w-[72ch] text-xs text-ink-3">
                  The repo and people filters don’t narrow Decide: it weighs every project, so none
                  looks finished just because its PRs are filtered out.
               </p>
            )}
            {teams.length > 0 && (
               <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Segmented
                     ariaLabel="team"
                     value={nav.team ?? ''}
                     options={[
                        ['', `All teams (${rows.length})`],
                        ...teams.map((t): [string, string] => [t, `${t} (${owedBy(t)})`]),
                        ['(none)', `No team (${owedBy('(none)')})`],
                     ]}
                     onChange={t => navigate({ team: t || null })}
                  />
                  {nav.team && nav.team !== '(none)' && (
                     <span className="text-xs text-ink-2">
                        {nav.team} has {n(liveIn(nav.team), 'live project')} for{' '}
                        {n(teamMembers[nav.team]?.length ?? 0, 'developer')}.
                     </span>
                  )}
               </div>
            )}
            {problem && (
               <div
                  className="mt-2 flex items-center gap-3 rounded-lg border border-warn bg-surface px-3 py-2 text-[13px]"
                  role="alert"
               >
                  <span className="text-ink-2">{problem}</span>
                  <span className="flex-1" />
                  <button
                     type="button"
                     onClick={dismissRoadmapProblem}
                     className="hit pressable rounded border-0 bg-transparent p-0 text-xs text-ink-3 hover:text-ink"
                  >
                     Dismiss
                  </button>
               </div>
            )}
         </div>
         {SECTIONS.map(([kinds, title, sub], index) => {
            const shown = all.filter(row => sectionOf(row) === index);
            if (!shown.length) return null;
            return (
               <div key={kinds[0]} className="mb-5">
                  <GroupHeader
                     title={title}
                     sub={sub}
                     count={shown.filter(row => !settled.has(rowKey(row))).length}
                  />
                  <Rows>
                     {shown.map(row => (
                        <DecideRowView
                           key={rowKey(row)}
                           row={row}
                           decided={settled.get(rowKey(row))}
                           project={projectOf(row)}
                           team={teamOfRow(row)}
                           today={day}
                           commitTo={commitTo}
                           decide={decide}
                           nav={nav}
                           navigate={navigate}
                        />
                     ))}
                  </Rows>
               </div>
            );
         })}
      </section>
   );
}
