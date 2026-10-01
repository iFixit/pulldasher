import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { n } from '../../../../shared/format';
import { dayStart, type ProjectTarget } from '../../../../shared/model/projects';
import {
   blockersOf,
   endShift,
   isStopped,
   HEALTH_WORD,
   healthStanding,
   mondayOf,
   moveBefore,
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
import { PrimaryButton, Segmented } from '../../components/bits';
import { dayOf, dayWords, useProjectsData } from '../../model/projectData';
import { peakFrom, type LoadWeek } from '../../../../shared/model/load';
import { loadRoadmapUpdates, postRoadmapUpdate, useRoadmap } from '../../model/roadmapData';
import {
   NO_PLAN,
   NO_UPDATE_YET,
   pastEnd,
   pastEndMark,
   PLAN_IT,
   UPDATE_DUE,
} from '../../model/words';
import { openPlan, type Navigate, type ProjectsNav } from './parts';

const DAY = 86400;

export const PLAN_STATUS_WORD: Record<RoadmapStatus, string> = {
   planned: 'Planned',
   active: 'In progress',
   parked: 'Parked',
   done: 'Done',
   dropped: 'Dropped',
};

/** An epoch-secs moment as its day, "Sep 22". */
export const when = (at: number) =>
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
 * What a plan's words can ask someone for, worst first: Decide's own order
 * for the calls it asks (shared/model/decide.ts RANK), as the project list's
 * Plan cell picks its word, then the update a lead owes, then what only the
 * roadmap says.
 */
const OWED = [
   'off_track',
   'missed',
   'over',
   'at_risk',
   'missing',
   'stale',
   'clash',
   'unstarted',
] as const;
export type Owed = typeof OWED[number];

/** A piece of some words: `owed` names what it asks for, if anything, and
 * `amber` marks the one piece of a plan's words that is said in amber. */
export interface Piece {
   text: string;
   owed?: Owed;
   amber?: boolean;
}

/** Words in pieces, with the sentence their hover gives. */
export interface Said {
   /** the pieces, joined */
   text: string;
   pieces: Piece[];
   title: string;
}

const said = (pieces: Piece[], title: string): Said => ({
   text: pieces.map(p => p.text).join(''),
   pieces,
   title,
});

/** Whether these words hold their plan's amber piece. */
export const isAmber = (s: Said | null | undefined) => !!s?.pieces.some(p => p.amber);

/** Words with their amber piece, if they hold it, and the rest in the ink
 * around them. */
export function SaidWords({ said: s }: { said: Said }) {
   return (
      <>
         {s.pieces.map((p, i) =>
            p.amber ? (
               <span key={i} className="text-warn">
                  {p.text}
               </span>
            ) : (
               <Fragment key={i}>{p.text}</Fragment>
            )
         )}
      </>
   );
}

const healthOwed = (h: RoadmapHealth): Owed | undefined => (h === 'on_track' ? undefined : h);

/**
 * An item's health in words, for the roadmap's rows and the project list:
 * the health its latest update gave, and an update owed. At risk, off track
 * and an owed update each ask someone to act, so each can be its plan's
 * amber piece (planWarnings picks one); the date stays ink. Null when there's
 * nothing to say.
 */
export function healthWords(s: HealthStanding, changedAt: number | null = null): Said | null {
   // at risk or off track asks the planner for a call, until the plan changes
   // after it: then it's answered, as Decide counts it (decide.ts)
   const owedFor = (u: { health: RoadmapHealth; at: number }) =>
      u.at > (changedAt ?? 0) ? healthOwed(u.health) : undefined;
   switch (s.kind) {
      case 'quiet':
         return null;
      case 'missing':
         return said(
            [{ text: NO_UPDATE_YET, owed: 'missing' }],
            `In progress for more than ${UPDATE_DUE_DAYS} days (counted from its start, or from when it was added if that’s later) with no update yet. Its lead owes one.`
         );
      case 'current': {
         // a full sentence, since callers add "Click to …" after it
         const body = s.update.body ? `: ${s.update.body.trim()}` : '';
         return said(
            [{ text: HEALTH_WORD[s.update.health], owed: owedFor(s.update) }],
            `${s.update.author} on ${when(s.update.at)}${body}${/[.!?]$/.test(body) ? '' : '.'}`
         );
      }
      case 'stale':
         return said(
            [
               { text: HEALTH_WORD[s.update.health], owed: owedFor(s.update) },
               { text: ` as of ${when(s.update.at)} · ` },
               { text: UPDATE_DUE, owed: 'stale' },
            ],
            `A plan in progress needs an update every ${UPDATE_DUE_DAYS} days; the last was ${
               s.days
            } days ago, so its lead owes one.${
               s.update.body ? ` ${s.update.author}: ${s.update.body}` : ''
            }`
         );
   }
}

/**
 * What an item waits on, in words for its row: "after Search reindex", or
 * how the plan clashes with it (the item starts before one of them ends, or
 * one was dropped), which asks the planner for a new order. `opens` is the
 * one its words open: the one that clashes, else the first. Null when it
 * waits on nothing, or is done or dropped itself.
 */
export function waitsWords(
   item: RoadmapItem,
   all: readonly RoadmapItem[]
): (Said & { opens: RoadmapItem }) | null {
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
   const opens = clashes[0] ?? blockers[0].item;
   if (!clashes.length) {
      return {
         ...said([{ text: `after ${blockers.map(b => b.item.name).join(', ')}` }], title),
         opens,
      };
   }
   const text =
      clashes.length > 1
         ? `${clashes.length} things it waits on don’t fit its plan`
         : clashes[0].status === 'dropped' || clashes[0].status === 'parked'
         ? `waits on ${clashes[0].name}, which was ${clashes[0].status}`
         : `starts before ${clashes[0].name} ends`;
   return { ...said([{ text, owed: 'clash' }], title), opens };
}

/** The project a plan tracks, as far as its warnings go. */
export interface Tracked {
   /** it has work in flight */
   live: boolean;
   /** its milestone or Target date */
   target: ProjectTarget | null;
}

/** A plan's warnings, each where its words go on a row. */
export interface PlanWarnings {
   /** in the status word's place, when the status is out of date */
   status: Said | null;
   health: Said | null;
   /** still in progress past its end: the words, and the timeline's own
    * mark for the piece of bar past the end */
   over: (Said & { weeks: number; mark: string }) | null;
   /** a missed target, or an end planned after it */
   target: (Said & { due: string }) | null;
   waits: (Said & { opens: RoadmapItem }) | null;
}

/**
 * Everything a plan's row warns of, in the same words on the timeline and
 * in now, next and later, with one amber piece at most: the worst thing it
 * asks for (OWED), since one call gets one mark and the facts behind it
 * (dates, targets, lengths) stay ink. A plan running past its end, while its
 * project has work in flight, keeps counting; a target is only weighed while
 * the plan is under way.
 */
export function planWarnings(
   item: RoadmapItem,
   all: readonly RoadmapItem[],
   today: string,
   project: Tracked | null,
   now?: number
): PlanWarnings {
   const end = planEnd(item);
   const under = item.status === 'planned' || item.status === 'active';
   const weeksFrom = (a: string, b: string) =>
      Math.ceil(((dayStart(b) as number) - (dayStart(a) as number)) / (7 * DAY));
   const isOver = under && !!project?.live && today > end;
   const weeks = isOver ? weeksFrom(end, today) : 0;
   const over = isOver
      ? {
           ...said(
              [{ text: pastEnd(weeks), owed: 'over' }],
              `Still in progress ${n(weeks, 'week')} after its plan’s end.`
           ),
           weeks,
           mark: pastEndMark(weeks),
        }
      : null;
   // work still running past its plan ends no sooner than today
   const due = under ? project?.target?.due_on?.slice(0, 10) ?? null : null;
   const expected = isOver ? today : end;
   let target: PlanWarnings['target'] = null;
   if (due && expected > due) {
      // a milestone by its title; a Target date on the issue is just a date
      const name = project?.target?.title ? `The milestone ${project.target.title}` : 'Its target';
      const title = `${name} is due ${dayWords(due)}.`;
      // a replan after the target passed answers it, as Decide counts it
      const replanned = (item.updated_at ?? 0) >= (dayStart(due) as number) + DAY;
      target = {
         ...(due < today
            ? said(
                 [
                    { text: 'Missed', owed: replanned ? undefined : 'missed' },
                    { text: ` ${dayWords(due)} target` },
                 ],
                 title
              )
            : said(
                 [
                    {
                       text: `Ends ${n(weeksFrom(due, expected), 'week')} after its ${dayWords(
                          due
                       )} target`,
                    },
                 ],
                 title
              )),
         due,
      };
   }
   const status =
      item.status === 'planned' && item.start < mondayOf(today)
         ? said(
              [
                 { text: `Was to start ${dayWords(item.start)}, ` },
                 { text: 'still marked Planned', owed: 'unstarted' },
              ],
              'Its start week has gone by and it’s still marked Planned: mark it In progress, or move it.'
           )
         : null;
   const health = healthWords(healthStanding(item, now), item.updated_at);
   const waits = waitsWords(item, all);
   const worst = [status, health, over, target, waits]
      .flatMap(w => w?.pieces ?? [])
      .filter(p => p.owed)
      .sort((a, b) => OWED.indexOf(a.owed as Owed) - OWED.indexOf(b.owed as Owed))[0];
   if (worst) worst.amber = true;
   return { status, health, over, target, waits };
}

/** The same words with no amber piece, where another mark already says it. */
export const inInk = (s: Said): Said => ({
   ...s,
   pieces: s.pieces.map(p => ({ ...p, amber: false })),
});

/**
 * A lane's load in words, for its band: the most plans and projects it has
 * in progress in any week from this one on, against its developers. Once
 * that's as many as the developers or more, at least one has one developer
 * or none (the worry the "one person" flag names for live projects), so the
 * planner owes the lane a new order: the reason is said, in amber, after
 * the facts.
 */
export function loadWords(
   weeks: readonly LoadWeek[],
   developers: number,
   today: string
): Said | null {
   const peak = peakFrom(weeks, today);
   if (!peak) return null;
   const people = developers ? ` for ${n(developers, 'developer')}` : '';
   if (developers && peak.count >= developers) {
      return said(
         [
            { text: `${peak.count} in progress the week of ${dayWords(peak.week)}${people} · ` },
            {
               text: peak.count > developers ? 'more than it can staff' : 'no one to spare',
               amber: true,
            },
         ],
         'With as many plans and projects in progress as developers, at least one has one developer or none.'
      );
   }
   return said(
      [{ text: `at most ${peak.count} in progress at once${people}` }],
      'The most plans and projects in progress in any one week, from this week on'
   );
}

/** Whether a week from `from` on has more in flight than there are
 * developers: the load chart's developer line turns amber then, since the
 * planner owes the roadmap fewer things at once. Weeks before are history. */
export function crossesLine(weeks: readonly LoadWeek[], from: string, developers: number): boolean {
   return developers > 0 && weeks.some(w => w.week >= from && w.onPlan + w.offPlan > developers);
}

/**
 * The order after moving `id` one place up (-1) or down (1) among the
 * plans someone can see (`visible`, in order), the hidden ones keeping
 * their places between: the arrow keys on a grip move a plan past the
 * neighbor on screen, not one the find box hid. Null at either end.
 */
export function stepWithin(
   ids: readonly number[],
   visible: readonly number[],
   id: number,
   step: 1 | -1
): number[] | null {
   const at = visible.indexOf(id);
   const other = at < 0 ? undefined : visible[at + step];
   if (other == null) return null;
   if (step < 0) return moveBefore(ids, id, other);
   return moveBefore(ids, id, ids[ids.indexOf(other) + 1] ?? null);
}

type Span = { start: string; weeks: number };

/** A move or a resize in words, for its receipt: "Moved MySQL 8 4 weeks
 * later"; null when it ended where it began. */
export function moveWords(name: string, from: Span, to: Span): string | null {
   if (from.start === to.start && from.weeks === to.weeks) return null;
   if (from.weeks === to.weeks) return `Moved ${name} ${shiftWords(endShift(from, to))}`;
   if (from.start === to.start) {
      const d = to.weeks - from.weeks;
      return `Made ${name} ${n(Math.abs(d), 'week')} ${d > 0 ? 'longer' : 'shorter'}`;
   }
   return `Replanned ${name}: ${planWords(to)}`;
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
 * as soon as the server has the new one, and the form says it was posted.
 */
export function UpdatesPanel({
   item,
   bare = false,
   autoFocus = false,
   actions,
}: {
   item: RoadmapItem;
   /** no rule of its own on top: it sits in a box that already has an edge */
   bare?: boolean;
   /** put the focus in the update's box when it opens */
   autoFocus?: boolean;
   /** more ways out, beside Post update */
   actions?: ReactNode;
}) {
   const [history, setHistory] = useState<RoadmapUpdate[] | 'failed' | null>(null);
   const [health, setHealth] = useState<RoadmapHealth>(item.update?.health ?? 'on_track');
   const [body, setBody] = useState('');
   const [posting, setPosting] = useState(false);
   const [error, setError] = useState<string | null>(null);
   const [posted, setPosted] = useState(false);
   const box = useRef<HTMLTextAreaElement>(null);
   useEffect(() => {
      // the opener scrolls the panel into view, clear of the sticky headers
      if (autoFocus) box.current?.focus({ preventScroll: true });
   }, [autoFocus]);
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
      setPosted(true);
      setHistory(h => [result.update, ...(Array.isArray(h) ? h : [])]);
   };
   const list = Array.isArray(history) ? history : [];
   return (
      <div className={`${bare ? '' : 'border-t border-secondary'} bg-muted/40 px-3.5 py-3`}>
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
               ref={box}
               aria-label={`Update on ${item.name}`}
               className="min-h-16 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px]"
               value={body}
               maxLength={2000}
               onChange={e => {
                  setBody(e.target.value);
                  setPosted(false);
               }}
               placeholder="What changed, what’s in the way, what’s next"
            />
            {item.update && <SinceLast item={item} last={item.update} />}
            <div className="flex flex-wrap items-center gap-3">
               <PrimaryButton disabled={posting}>Post update</PrimaryButton>
               {/* the result, where the click was, and read out */}
               <span role="status" className="text-xs text-ink-2">
                  {error ?? (posted ? 'Posted.' : '')}
               </span>
               {actions && <span className="ml-auto flex items-center gap-3">{actions}</span>}
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
 * A plan in a word or two for a table cell: its health, "No update yet" or
 * "Update due" when one is owed (a stale "On track" reassures nobody), or
 * else its status. `warn` when the words ask someone for something.
 */
export function planCellWords(plan: RoadmapItem): { text: string; warn: boolean; title: string } {
   const standing = healthStanding(plan);
   const words = healthWords(standing, plan.updated_at);
   const u = latestOf(standing);
   return {
      text:
         standing.kind === 'missing'
            ? NO_UPDATE_YET
            : standing.kind === 'stale' && standing.update.health === 'on_track'
            ? UPDATE_DUE
            : u
            ? HEALTH_WORD[u.health]
            : PLAN_STATUS_WORD[plan.status],
      warn: !!words?.pieces.some(p => p.owed),
      title: `${plan.name}: ${PLAN_STATUS_WORD[plan.status].toLowerCase()}, ${planWords(plan)}${
         words ? `. ${words.text}` : ''
      }`,
   };
}

/**
 * A project's plan, as the detail under its row in the project list: the
 * planned weeks, the status, how it's going and the latest note, in the
 * roadmap's own words, with the way to the roadmap. All in ink: the row's
 * Plan cell above is its one amber mark. Says so when the project has no
 * plan at all.
 */
export function PlanFacts({
   slug,
   nav,
   navigate,
   live = false,
}: {
   slug: string;
   nav: ProjectsNav;
   navigate: Navigate;
   /** it has work in flight, so the roadmap's list of work with no plan has it */
   live?: boolean;
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
            {NO_PLAN}
            {/* narrowed to it when the roadmap lists it (work in flight), where
                its row's plus plans it */}
            {link(live ? PLAN_IT : 'Open the roadmap', {
               project: null,
               view: 'roadmap',
               item: null,
               find: live ? slug : '',
            })}
         </div>
      );
   }
   const w = planWarnings(plan, items, dayOf(new Date()), { live, target: null });
   const u = latestOf(healthStanding(plan));
   const fact = (s: Said | null) =>
      s && (
         <span className="text-ink-2" title={s.title}>
            {s.text}
         </span>
      );
   return (
      <div className="border-t border-secondary px-3.5 py-2 text-xs text-ink-3">
         <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
               Plan <span className="font-medium text-ink-2">{planWords(plan)}</span>
            </span>
            {fact(w.status) ?? <span>{PLAN_STATUS_WORD[plan.status]}</span>}
            {fact(w.health)}
            {fact(w.over)}
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
