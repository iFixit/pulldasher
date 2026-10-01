import { useEffect, useState } from 'react';
import { n } from '../../../../shared/format';
import {
   blockersOf,
   endShift,
   isStopped,
   HEALTH_WORD,
   healthStanding,
   planEnd,
   planFor,
   ROADMAP_HEALTHS,
   UPDATE_DUE_DAYS,
   type HealthStanding,
   type RoadmapHealth,
   type RoadmapItem,
   type RoadmapStatus,
   type RoadmapUpdate,
} from '../../../../shared/model/roadmap';
import { Segmented } from '../../components/bits';
import { dayOf, dayWords, useProjectsData } from '../../model/projectData';
import { peakFrom, type LoadWeek } from '../../../../shared/model/load';
import { loadRoadmapUpdates, postRoadmapUpdate, useRoadmap } from '../../model/roadmapData';
import { openPlan, type Navigate, type ProjectsNav } from './parts';

export const PLAN_STATUS_WORD: Record<RoadmapStatus, string> = {
   planned: 'Planned',
   active: 'In progress',
   parked: 'Parked',
   done: 'Done',
   dropped: 'Dropped',
};

/** An epoch-secs moment as its day, "Sep 22". */
const when = (at: number) =>
   new Date(at * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function planWords(plan: { start: string; weeks: number }): string {
   return `${dayWords(plan.start)} to ${dayWords(planEnd(plan))}, ${n(plan.weeks, 'week')}`;
}

/** Which way and how far a plan's end moved, "2 weeks later"; null when it didn't. */
export function shiftWords(weeks: number): string | null {
   if (!weeks) return null;
   return `${n(Math.abs(weeks), 'week')} ${weeks > 0 ? 'later' : 'earlier'}`;
}

const planOf = (u: RoadmapUpdate) => ({ start: u.plan_start, weeks: u.plan_weeks });

export const latestOf = (s: HealthStanding) =>
   s.kind === 'current' || s.kind === 'stale' ? s.update : null;

/**
 * An item's health in the words the roadmap row and the overview show, and
 * whether they're amber: at risk, off track, or an update owed, since each
 * means someone has something to do. Null when there's nothing to say.
 */
export function healthWords(
   s: HealthStanding
): { text: string; warn: boolean; title: string } | null {
   switch (s.kind) {
      case 'quiet':
         return null;
      case 'missing':
         return {
            text: 'No update yet',
            warn: true,
            title: `In progress for over ${UPDATE_DUE_DAYS} days by its plan, and nobody has posted an update on how it’s going.`,
         };
      case 'current':
         return {
            text: HEALTH_WORD[s.update.health],
            warn: s.update.health !== 'on_track',
            title: `${s.update.author} on ${when(s.update.at)}${
               s.update.body ? `: ${s.update.body}` : ''
            }`,
         };
      case 'stale':
         return {
            text: `${HEALTH_WORD[s.update.health]} · no update since ${when(s.update.at)}`,
            warn: true,
            title: `Work in progress gets an update every ${UPDATE_DUE_DAYS} days; the last was ${
               s.days
            } days ago.${s.update.body ? ` ${s.update.author}: ${s.update.body}` : ''}`,
         };
   }
}

/**
 * What an item waits on, in words for its row: "after Search reindex", or,
 * amber, how the plan clashes with it (the item starts before one of them
 * ends, or one was dropped), since the planner then owes a new order. Null
 * when it waits on nothing, or is done or dropped itself.
 */
export function waitsWords(
   item: RoadmapItem,
   all: readonly RoadmapItem[]
): { text: string; warn: boolean; title: string } | null {
   if (isStopped(item.status)) return null;
   const blockers = blockersOf(item, all);
   if (!blockers.length) return null;
   const title = `Waits on ${blockers
      .map(({ item: b }) =>
         isStopped(b.status)
            ? `${b.name} (${b.status})`
            : `${b.name} (planned to end ${dayWords(planEnd(b))})`
      )
      .join(', ')}`;
   const clashes = blockers.filter(b => b.clash).map(b => b.item);
   if (!clashes.length) {
      return { text: `after ${blockers.map(b => b.item.name).join(', ')}`, warn: false, title };
   }
   const text =
      clashes.length > 1
         ? `${clashes.length} things it waits on don’t fit its plan`
         : clashes[0].status === 'dropped' || clashes[0].status === 'parked'
         ? `waits on ${clashes[0].name}, which was ${clashes[0].status}`
         : `starts before ${clashes[0].name} ends`;
   return { text, warn: true, title };
}

/**
 * A lane's load in words, for its band: the most plans and projects it has
 * in flight in any week from this one on, against its developers. Amber
 * once that's as many as the developers or more, since then at least one
 * has one developer or none (the worry the "one person" flag names for live
 * projects), and the planner owes the lane a new order.
 */
export function loadWords(
   weeks: readonly LoadWeek[],
   developers: number,
   today: string
): { text: string; warn: boolean; title: string } | null {
   const peak = peakFrom(weeks, today);
   if (!peak) return null;
   const people = developers ? ` for ${n(developers, 'developer')}` : '';
   if (developers && peak.count >= developers) {
      return {
         text: `${peak.count} at once in the week of ${dayWords(peak.week)}${people}`,
         warn: true,
         title: 'With as much in flight as there are developers, at least one plan or project has one developer or none.',
      };
   }
   return {
      text: `at most ${peak.count} at once${people}`,
      warn: false,
      title: 'The most plans and projects in flight in any one week, from this week on',
   };
}

/** What happened since the last update, to write the next one from: the
 * linked project's PRs merged and opened, and how far the plan moved. */
function SinceLast({ item, last }: { item: RoadmapItem; last: RoadmapUpdate }) {
   const range = { start: dayOf(new Date(last.at * 1000)), end: dayOf(new Date()) };
   const data = useProjectsData(item.project ? range : null, item.project);
   const t = data?.window.totals;
   const moved = shiftWords(endShift(planOf(last), item));
   const parts: string[] = [];
   if (t) {
      parts.push(
         t.merged || t.opened
            ? `${n(t.merged, 'PR')} merged and ${t.opened} opened`
            : 'no PRs merged or opened'
      );
   }
   if (moved) parts.push(`the plan’s end moved ${moved}`);
   if (!parts.length) return null;
   return (
      <p className="m-0 text-xs text-ink-3">
         Since the last update on {when(last.at)}: {parts.join('; ')}.
      </p>
   );
}

/**
 * An item's updates, under its editor: a form to post a new one (how it's
 * going, and why), what changed since the last, and every update before,
 * newest first, each with the plan as it stood then. The row's words change
 * as soon as the server has the new one.
 */
export function UpdatesPanel({ item }: { item: RoadmapItem }) {
   const [history, setHistory] = useState<RoadmapUpdate[] | 'failed' | null>(null);
   const [health, setHealth] = useState<RoadmapHealth>(item.update?.health ?? 'on_track');
   const [body, setBody] = useState('');
   const [posting, setPosting] = useState(false);
   const [error, setError] = useState<string | null>(null);
   useEffect(() => {
      let live = true;
      void loadRoadmapUpdates(item.id).then(list => {
         if (live) setHistory(list ?? 'failed');
      });
      return () => {
         live = false;
      };
   }, [item.id]);
   const post = async () => {
      setPosting(true);
      const result = await postRoadmapUpdate(item.id, { health, body });
      setPosting(false);
      if ('error' in result) return setError(result.error);
      setError(null);
      setBody('');
      setHistory(h => [result.update, ...(Array.isArray(h) ? h : [])]);
   };
   const list = Array.isArray(history) ? history : [];
   return (
      <div className="border-t border-secondary bg-muted/40 px-3.5 py-3">
         <form
            className="flex flex-col gap-2"
            onSubmit={e => {
               e.preventDefault();
               void post();
            }}
         >
            <div className="flex flex-wrap items-center gap-3">
               <span className="text-xs font-semibold text-ink-2">How is it going?</span>
               <Segmented
                  ariaLabel="health"
                  value={health}
                  options={ROADMAP_HEALTHS.map(h => [h, HEALTH_WORD[h]])}
                  onChange={setHealth}
               />
            </div>
            <textarea
               aria-label="update"
               className="min-h-16 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px]"
               value={body}
               maxLength={2000}
               onChange={e => setBody(e.target.value)}
               placeholder="What changed, what’s in the way, what’s next"
            />
            {item.update && <SinceLast item={item} last={item.update} />}
            <div className="flex flex-wrap items-center gap-3">
               <button
                  type="submit"
                  disabled={posting}
                  className="pressable rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-surface hover:bg-brand-700 disabled:opacity-40"
               >
                  Post update
               </button>
               {error && <span className="text-xs text-warn">{error}</span>}
            </div>
         </form>
         {history === 'failed' && (
            <p className="m-0 mt-3 text-xs text-ink-3">Couldn’t load the earlier updates.</p>
         )}
         {Array.isArray(history) && !history.length && (
            <p className="m-0 mt-3 text-xs text-ink-3">No updates yet.</p>
         )}
         {list.length > 0 && (
            <ol className="m-0 mt-3 flex list-none flex-col gap-3 border-t border-secondary p-0 pt-3">
               {list.map((u, i) => {
                  const before = list[i + 1];
                  const moved = before && shiftWords(endShift(planOf(before), planOf(u)));
                  return (
                     <li key={u.id} className="text-[13px]">
                        <span className="font-medium text-ink">{HEALTH_WORD[u.health]}</span>
                        <span className="text-ink-3">
                           {' '}
                           · {when(u.at)} · {u.author}
                        </span>
                        {u.body && (
                           <p className="m-0 mt-0.5 whitespace-pre-line text-ink-2">{u.body}</p>
                        )}
                        <p className="m-0 mt-0.5 text-xs text-ink-3">
                           The plan then: {planWords(planOf(u))}
                           {moved ? `; its end moved ${moved} since the update before` : ''}.
                        </p>
                     </li>
                  );
               })}
            </ol>
         )}
      </div>
   );
}

/**
 * A plan in a word or two for a table cell: its health, "No update" or
 * "Update due" when one is owed (a stale "On track" reassures nobody), or
 * else its status. Amber on the same terms as everywhere.
 */
export function planCellWords(plan: RoadmapItem): { text: string; warn: boolean; title: string } {
   const standing = healthStanding(plan);
   const words = healthWords(standing);
   const u = latestOf(standing);
   return {
      text:
         standing.kind === 'missing'
            ? 'No update'
            : standing.kind === 'stale' && standing.update.health === 'on_track'
            ? 'Update due'
            : u
            ? HEALTH_WORD[u.health]
            : PLAN_STATUS_WORD[plan.status],
      warn: !!words?.warn,
      title: `${plan.name}: ${PLAN_STATUS_WORD[plan.status].toLowerCase()}, ${planWords(plan)}${
         words ? `. ${words.text}` : ''
      }`,
   };
}

/**
 * A project's plan, as one row on its page: the planned weeks, the status,
 * how it's going and the latest note, with the way to the roadmap. Says so
 * when the project isn't on the roadmap at all.
 */
export function PlanFacts({
   slug,
   nav,
   navigate,
}: {
   slug: string;
   nav: ProjectsNav;
   navigate: Navigate;
}) {
   const { items } = useRoadmap();
   if (!items) return null;
   const plan = planFor(slug, items);
   const link = (label: string, patch: Parameters<Navigate>[0]) => (
      <button
         type="button"
         onClick={() => navigate(patch)}
         className="hit pressable ml-auto rounded border-0 bg-transparent p-0 text-xs font-medium text-brand hover:underline"
      >
         {label}
      </button>
   );
   if (!plan) {
      return (
         <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-secondary px-3.5 py-2 text-xs text-ink-3">
            Not on the roadmap
            {link('Open the roadmap', { project: null, view: 'roadmap', item: null })}
         </div>
      );
   }
   const standing = healthStanding(plan);
   const health = healthWords(standing);
   const u = latestOf(standing);
   return (
      <div className="border-t border-secondary px-3.5 py-2 text-xs text-ink-3">
         <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
               Planned <span className="font-medium text-ink-2">{planWords(plan)}</span>
            </span>
            <span>{PLAN_STATUS_WORD[plan.status]}</span>
            {health && (
               <span className={health.warn ? 'text-warn' : 'text-ink-2'} title={health.title}>
                  {health.text}
               </span>
            )}
            {link('Open on the roadmap', openPlan(nav, plan.id))}
         </div>
         {u?.body && (
            <p className="m-0 mt-1 whitespace-pre-line text-[13px] text-ink-2">
               {u.body}{' '}
               <span className="text-xs text-ink-3">
                  ({u.author}, {when(u.at)})
               </span>
            </p>
         )}
      </div>
   );
}
