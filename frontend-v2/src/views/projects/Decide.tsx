import { useState } from 'react';
import { Check } from 'lucide-react';
import { n } from '../../../../shared/format';
import {
   compareRows,
   decideProjects,
   decideQueue,
   STALL_DAYS,
   type DecideReason,
   type DecideRow,
} from '../../../../shared/model/decide';
import { dayStart, type Today } from '../../../../shared/model/projects';
import {
   HEALTH_WORD,
   mondayOf,
   planEnd,
   type RoadmapFields,
   type RoadmapItem,
} from '../../../../shared/model/roadmap';
import { Icon } from '../../components/Icon';
import { GroupHeader, Rows } from '../../components/Lane';
import { useArmedConfirm } from '../../components/useArmedConfirm';
import { mainTeam, type PortfolioItem } from '../../model/portfolio';
import { dayOf, dayWords } from '../../model/projectData';
import { commitEnds } from '../../model/roadmapTime';
import {
   createRoadmapItem,
   dismissRoadmapProblem,
   updateRoadmapItem,
   useRoadmap,
} from '../../model/roadmapData';
import { openPlan, type Navigate, type ProjectsNav } from './parts';

const DAY = 86400;

function queue(today: Today, items: readonly RoadmapItem[]): DecideRow[] {
   return decideQueue({
      live: decideProjects(today),
      items,
      today: dayOf(new Date()),
      now: Date.now() / 1000,
   });
}

/** How many decisions are owed now, for the tab's label. */
export function decideCount(today: Today, items: readonly RoadmapItem[]): number {
   return queue(today, items).length;
}

/** The queue's sections, worst first, as decide.ts ranks them. A row sits
 * in the first section any of its reasons names. */
const SECTIONS: [DecideReason['kind'], string, string][] = [
   ['reopened', 'Still open after a decision', 'Marked done or dropped a week ago or more'],
   ['moving', 'Parked, but moving', 'PRs changed after it was parked'],
   ['off_track', 'Off track', 'Its latest update says so'],
   ['over', 'Past their plans', 'Still in flight after the planned end'],
   ['ended', 'Plans that ended', 'Nothing in flight, so maybe done'],
   ['stalled', 'Stalled', `Open PRs, no activity for ${STALL_DAYS} days`],
   ['at_risk', 'At risk', 'Its latest update says so'],
   ['new', 'New', 'In flight, never decided'],
];

const sectionOf = (row: DecideRow) =>
   SECTIONS.find(([kind]) => row.reasons.some(r => r.kind === kind))?.[0] ?? 'new';

const rowKey = (row: DecideRow) => `${row.slug ?? ''}:${row.item?.id ?? ''}`;

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
         return `Its plan ended ${n(reason.weeks, 'week')} ago and nothing is in flight: done?`;
      case 'off_track':
      case 'at_risk': {
         const u = item?.update;
         const said = u?.body ? `: ${u.body.split('\n')[0]}` : '';
         return `${HEALTH_WORD[reason.kind]}, says ${u?.author ?? 'its lead'}${said}`;
      }
      case 'reopened':
         return `Marked ${item?.status === 'dropped' ? 'dropped' : 'done'}, but ${n(
            reason.open,
            'PR is',
            'PRs are'
         )} still open`;
      case 'moving':
         return 'Parked, but its PRs changed since';
   }
}

/** Where a plan the row makes starts: its item's start, or else the week
 * its first open PR opened. */
function startOf(row: DecideRow, today: string): string {
   if (row.item) return row.item.start;
   const reason = row.reasons.find(r => r.kind === 'new');
   return mondayOf((reason?.kind === 'new' && reason.since) || today);
}

/** Whole weeks from a Monday through the week holding `end`. */
const weeksThrough = (start: string, end: string) =>
   Math.max(
      1,
      Math.round(((dayStart(mondayOf(end)) as number) - (dayStart(start) as number)) / (7 * DAY)) +
         1
   );

/** A call made on this page, kept in the row's place so it doesn't vanish. */
interface Decided {
   row: DecideRow;
   words: string;
   /** the roadmap item holding the call */
   id: number;
}

const buttonClass =
   'hit pressable rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-ink-2 hover:border-brand hover:text-brand disabled:opacity-40';

function DecideRowView({
   row,
   project,
   today,
   commitTo,
   decide,
   nav,
   navigate,
}: {
   row: DecideRow;
   project: PortfolioItem | undefined;
   today: string;
   commitTo: { label: string; end: string }[];
   decide: (row: DecideRow, fields: Partial<RoadmapFields>, words: string) => Promise<void>;
   nav: ProjectsNav;
   navigate: Navigate;
}) {
   const { armed, run } = useArmedConfirm();
   const [busy, setBusy] = useState(false);
   const name = row.item?.name ?? project?.name ?? row.slug ?? 'A plan';
   const lead = row.item?.lead ?? project?.lead ?? null;
   const start = startOf(row, today);
   const act = async (fields: Partial<RoadmapFields>, words: string) => {
      setBusy(true);
      await decide(row, fields, words);
      setBusy(false);
   };
   const { item } = row;
   return (
      <div className="border-t border-secondary px-3.5 py-2.5 first:border-t-0">
         <div className="flex flex-wrap items-baseline gap-x-2">
            <button
               type="button"
               onClick={() =>
                  row.slug
                     ? navigate({ project: row.slug })
                     : item && navigate(openPlan(nav, item.id))
               }
               className="hit pressable rounded border-0 bg-transparent p-0 text-left text-[13px] font-medium text-ink hover:text-brand"
               title={row.slug ? 'Open the project and its PRs' : 'Open its plan on the roadmap'}
            >
               {name}
            </button>
            {lead && (
               <button
                  type="button"
                  onClick={() => navigate({ view: 'roadmap', find: lead, item: null })}
                  className="pressable rounded border-0 bg-transparent p-0 text-xs text-ink-3 hover:underline"
                  title={`Show only ${lead}’s work on the roadmap`}
               >
                  {lead}
               </button>
            )}
            {project && project.open > 0 && (
               <span className="text-xs text-ink-3">{n(project.open, 'open PR')}</span>
            )}
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
         <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
            Commit through
            {commitTo.map(c => {
               const weeks = weeksThrough(start, c.end);
               const end = dayWords(planEnd({ start, weeks }));
               return (
                  <button
                     type="button"
                     key={c.end}
                     disabled={busy}
                     onClick={() =>
                        void act(
                           { status: 'active', start, weeks },
                           `Committed through the ${c.label.toLowerCase()}`
                        )
                     }
                     title={`Plan it from ${dayWords(start)} to ${end}`}
                     className={buttonClass}
                  >
                     {c.label}
                  </button>
               );
            })}
            <span className="mx-1">or</span>
            <button
               type="button"
               disabled={busy}
               onClick={() => void act({ status: 'parked' }, 'Parked')}
               title="Stop for now without dropping it. It leaves the load until someone picks it up."
               className={buttonClass}
            >
               Park
            </button>
            <button
               type="button"
               disabled={busy}
               onClick={() => void act({ status: 'done' }, 'Finished')}
               title="It’s done"
               className={buttonClass}
            >
               Finish
            </button>
            <button
               type="button"
               disabled={busy}
               onClick={() => run(() => void act({ status: 'dropped' }, 'Dropped'))}
               title="We won’t do it"
               className={
                  armed
                     ? 'hit pressable rounded-md border border-warn bg-surface px-2 py-0.5 text-xs font-semibold text-warn'
                     : buttonClass
               }
            >
               {armed ? 'Click again to drop it' : 'Drop'}
            </button>
         </div>
      </div>
   );
}

/** A decided row, the same height as it was, so the rows below don't
 * slide under the pointer between two clicks. */
function DecidedRowView({
   decided,
   name,
   nav,
   navigate,
}: {
   decided: Decided;
   name: string;
   nav: ProjectsNav;
   navigate: Navigate;
}) {
   return (
      <div className="border-t border-secondary px-3.5 py-2.5 text-[13px] text-ink-3 first:border-t-0">
         <button
            type="button"
            onClick={() =>
               decided.row.slug
                  ? navigate({ project: decided.row.slug })
                  : navigate(openPlan(nav, decided.id))
            }
            className="hit pressable rounded border-0 bg-transparent p-0 text-left text-[13px] text-ink-3 hover:text-brand"
            title={
               decided.row.slug ? 'Open the project and its PRs' : 'Open its plan on the roadmap'
            }
         >
            {name}
         </button>
         <p className="m-0 flex items-center gap-1.5 text-ink-2">
            <Icon icon={Check} size={14} />
            {decided.words}
         </p>
         <div className="mt-1.5 flex min-h-[22px] items-center">
            <button
               type="button"
               onClick={() => navigate(openPlan(nav, decided.id))}
               className="pressable rounded border-0 bg-transparent p-0 text-xs text-ink-3 underline hover:text-brand"
            >
               Change it on the roadmap
            </button>
         </div>
      </div>
   );
}

/**
 * Decide: the weekly triage a product manager would run, as a queue that
 * empties. Every row is a project or plan that needs a call, and says why.
 * Each call (commit it through a month or quarter, park, finish, drop) is
 * one click that writes the roadmap; the row then turns into a line saying
 * what was decided, so nothing vanishes unexplained. Worst first.
 */
export function Decide({
   today,
   items,
   teamOf,
   nav,
   navigate,
}: {
   today: Today;
   /** the portfolio, for names, leads and teams */
   items: PortfolioItem[];
   teamOf: (login: string) => string | null;
   nav: ProjectsNav;
   navigate: Navigate;
}) {
   const { items: plans, loadFailed, problem } = useRoadmap();
   const [decided, setDecided] = useState<ReadonlyMap<string, Decided>>(new Map());
   const day = dayOf(new Date());
   const bySlug = new Map(items.map(i => [i.slug, i]));
   if (!plans) {
      return (
         <p className="text-[13px] text-ink-3">
            {loadFailed ? 'Couldn’t load the roadmap. Try again in a minute.' : 'Loading…'}
         </p>
      );
   }
   const rows = queue(today, plans).filter(row => !decided.has(rowKey(row)));
   const commitTo = commitEnds(day);
   const decide = async (row: DecideRow, fields: Partial<RoadmapFields>, words: string) => {
      let id: number | null = null;
      if (row.item) {
         if (await updateRoadmapItem(row.item.id, fields)) id = row.item.id;
      } else {
         // a first decision records the work so far, from its first open
         // PR's week through this one, unless it commits further
         const project = row.slug ? bySlug.get(row.slug) : undefined;
         const start = startOf(row, day);
         const created = await createRoadmapItem({
            name: project?.name ?? row.slug ?? 'A project',
            project: row.slug,
            team: project ? mainTeam(project, teamOf) : null,
            lead: project?.lead ?? null,
            start,
            weeks: weeksThrough(start, day),
            ...fields,
         });
         id = created?.id ?? null;
      }
      if (id != null) {
         const made = { row, words, id };
         setDecided(d => new Map(d).set(rowKey(row), made));
      }
   };
   const nameOf = (row: DecideRow) =>
      row.item?.name ?? (row.slug && bySlug.get(row.slug)?.name) ?? row.slug ?? 'A plan';
   const all = [...rows, ...[...decided.values()].map(d => d.row)].sort(compareRows);
   return (
      <section className="mb-7">
         <div className="mb-4">
            <h2 className="m-0 text-base font-semibold leading-snug">
               {rows.length ? `${n(rows.length, 'decision')} to make` : 'Nothing to decide'}
            </h2>
            <p className="m-0 mt-1 max-w-[70ch] text-[13px] text-ink-2">
               {rows.length
                  ? 'Each project here needs a call: commit to it through a month or quarter, park it, finish it, or drop it. The roadmap keeps the call, and the project leaves this list.'
                  : 'New projects, stalls, and plans that slip or go off track show up here.'}{' '}
               Park stops work for now without dropping it, and takes it out of the roadmap’s load.
            </p>
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
         {SECTIONS.map(([kind, title, sub]) => {
            const shown = all.filter(row => sectionOf(row) === kind);
            if (!shown.length) return null;
            return (
               <div key={kind} className="mb-5">
                  <GroupHeader
                     title={title}
                     sub={sub}
                     count={shown.filter(row => !decided.has(rowKey(row))).length}
                  />
                  <Rows>
                     {shown.map(row => {
                        const made = decided.get(rowKey(row));
                        return made ? (
                           <DecidedRowView
                              key={rowKey(row)}
                              decided={made}
                              name={nameOf(row)}
                              nav={nav}
                              navigate={navigate}
                           />
                        ) : (
                           <DecideRowView
                              key={rowKey(row)}
                              row={row}
                              project={row.slug ? bySlug.get(row.slug) : undefined}
                              today={day}
                              commitTo={commitTo}
                              decide={decide}
                              nav={nav}
                              navigate={navigate}
                           />
                        );
                     })}
                  </Rows>
               </div>
            );
         })}
      </section>
   );
}
