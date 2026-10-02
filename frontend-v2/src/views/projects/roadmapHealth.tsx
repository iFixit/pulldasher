import {
   Fragment,
   useEffect,
   useRef,
   useState,
   type MutableRefObject,
   type ReactNode,
} from 'react';
import { n } from '../../../../shared/format';
import type { DecideReason } from '../../../../shared/model/decide';
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
   type Vouch,
} from '../../../../shared/model/roadmap';
import { PrimaryButton, Segmented, TextButton } from '../../components/bits';
import { dayOf, dayWords, useProjectsData } from '../../model/projectData';
import type { LoadWeek } from '../../../../shared/model/load';
import {
   loadRoadmapUpdates,
   postRoadmapUpdate,
   takeBackRoadmapUpdate,
   useRoadmap,
} from '../../model/roadmapData';
import { draftUpdate } from '../../model/updateDraft';
import {
   BEING_WORKED_ON,
   IN_PROGRESS,
   LAST_14_DAYS,
   missedTarget,
   NO_UPDATE_YET,
   pastEnd,
   pastEndMark,
   UPDATE_DUE,
} from '../../model/words';
import { openPlan, type Navigate, type ProjectsNav } from './parts';

const DAY = 86400;

/** A plan's status in a word. Only `active` has its word in words.ts so far:
 * "In progress" is only ever a plan's status. */
export const PLAN_STATUS_WORD: Record<RoadmapStatus, string> = {
   planned: 'Planned',
   active: IN_PROGRESS,
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
 * `amber` marks the one piece of a plan's words that is said in amber.
 * `wrap` lets a reason too long for a narrow row break across lines, where
 * a row's other words keep to one. */
export interface Piece {
   text: string;
   owed?: Owed;
   amber?: boolean;
   wrap?: boolean;
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
            ) : p.wrap ? (
               <span key={i} className="whitespace-normal">
                  {p.text}
               </span>
            ) : (
               <Fragment key={i}>{p.text}</Fragment>
            )
         )}
      </>
   );
}

/** A row's words in a line, a dot between each, the dot trailing its word
 * so a wrapped line never starts with one, as on Decide's rows. Each word
 * keeps to one line. */
export function Dotted({ children }: { children: ReactNode[] }) {
   const shown = children.filter(Boolean);
   return (
      <>
         {shown.map((child, i) => (
            <span key={i} className="inline-flex items-baseline gap-x-1.5 whitespace-nowrap">
               {child}
               {i < shown.length - 1 && <span aria-hidden>·</span>}
            </span>
         ))}
      </>
   );
}

const healthOwed = (h: RoadmapHealth): Owed | undefined => (h === 'on_track' ? undefined : h);

/** what a plan whose numbers vouch for it is owed instead of an update */
export const NO_UPDATE_NEEDED = 'no update needed';
/** the same, starting a row's words */
const NO_UPDATE_NEEDED_WORD = 'No update needed';

/** Why a plan in progress owes no update, said where its update would go:
 * "2 PRs merged in the last 14 days: no update needed". */
export const vouchWords = (v: Vouch) =>
   `${n(v.merged, 'PR')} merged in the ${LAST_14_DAYS}: ${NO_UPDATE_NEEDED}`;

/** The rule behind vouchWords, in a sentence, for a hover. */
export const vouchRule = (v: Vouch) =>
   `Its PRs are merging, it isn’t past its end, and ${
      v.finish == null
         ? 'nothing in its issues says it won’t finish by then'
         : `at their pace its issues are done around ${when(v.finish)}, by its end`
   }, so the numbers say how it’s going and its lead owes no update. Post one any time.`;

/**
 * An item's health in words, for the roadmap's rows and the project list:
 * the health its latest update gave, and an update owed. At risk, off track
 * and an owed update each ask someone to act, so each can be its plan's
 * amber piece (planWarnings picks one); the date stays ink. A plan its
 * numbers vouch for says why it owes nothing, in ink, where its update
 * would go. Null when there's nothing to say.
 */
export function healthWords(s: HealthStanding, changedAt: number | null = null): Said | null {
   // at risk or off track asks the planner for a call, until the plan changes
   // after it: then it's answered, as Decide counts it (decide.ts)
   const owedFor = (u: { health: RoadmapHealth; at: number }) =>
      u.at > (changedAt ?? 0) ? healthOwed(u.health) : undefined;
   switch (s.kind) {
      case 'quiet':
         // short on a row, with the numbers and the rule on hover: the
         // project's page says it in full where its update would be
         return s.vouch
            ? said(
                 [{ text: NO_UPDATE_NEEDED_WORD }],
                 `${vouchWords(s.vouch)}. ${vouchRule(s.vouch)}`
              )
            : null;
      case 'missing':
         return said(
            [{ text: NO_UPDATE_YET, owed: 'missing' }],
            `In progress for more than ${UPDATE_DUE_DAYS} days (counted from its start, or from when it was added if that’s later) with no update yet. Its lead owes one.`
         );
      case 'current': {
         // a full sentence, since callers add "Click to …" after it
         const body = s.update.body ? `: ${s.update.body.trim()}` : '';
         const last = `${s.update.author} on ${when(s.update.at)}${body}${
            /[.!?]$/.test(body) ? '' : '.'
         }`;
         if (s.vouch) {
            // its last word, from a while ago, and why no new one is owed
            return said(
               [
                  { text: HEALTH_WORD[s.update.health], owed: owedFor(s.update) },
                  { text: ` as of ${when(s.update.at)} · ${NO_UPDATE_NEEDED}` },
               ],
               `${last}\n${vouchWords(s.vouch)}. ${vouchRule(s.vouch)}`
            );
         }
         return said([{ text: HEALTH_WORD[s.update.health], owed: owedFor(s.update) }], last);
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

/**
 * A call Decide asks about a plan or a project (Decide.tsx), as the
 * roadmap's rows say it: its reason in the few words the Overview's Plan
 * cell uses, and its question.
 */
export interface PlanCall {
   kind: DecideReason['kind'];
   /** "Parked, still worked on" */
   text: string;
   /** "Back on?" */
   question: string;
   /** Decide's own sentence, the reason and the question, for the hover */
   title: string;
}

/** A plan's warnings, each where its words go on a row. */
export interface PlanWarnings {
   /** in the status word's place: Decide's call, or the status when it's
    * out of date */
   status: Said | null;
   health: Said | null;
   /** still in progress past its end: the words, and the timeline's own
    * mark for the piece of bar past the end */
   over: (Said & { weeks: number; mark: string }) | null;
   /** a missed target, or an end planned after it */
   target: (Said & { due: string }) | null;
   waits: (Said & { opens: RoadmapItem }) | null;
   /** the call Decide asks about it, said in one of the places above */
   call: PlanCall | null;
}

/**
 * Everything a plan's row warns of, in the same words on the timeline and
 * in now, next and later, with one amber piece at most, since one call gets
 * one mark and the facts behind it (dates, targets, lengths) stay ink. When
 * Decide asks about the plan (`call`), that's its question, said after the
 * words that hold its reason (an off-track update, a missed target) or else
 * in the status word's place, as the Overview's Plan cell names it.
 * Otherwise it's the worst thing the plan asks for (OWED). A plan running
 * past its end, while its project has work in flight, keeps counting; a
 * target is only weighed while the plan is under way.
 */
export function planWarnings(
   item: RoadmapItem,
   all: readonly RoadmapItem[],
   today: string,
   project: Tracked | null,
   now?: number,
   call: PlanCall | null = null
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
              `Still ${BEING_WORKED_ON} ${n(weeks, 'week')} after its plan’s end.`
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
      // "Missed its Sep 26 target", the amber (when it's owed) on its verb
      const missed = missedTarget(dayWords(due));
      const verb = missed.slice(0, missed.indexOf(' '));
      target = {
         ...(due < today
            ? said(
                 [
                    { text: verb, owed: replanned ? undefined : 'missed' },
                    { text: missed.slice(verb.length) },
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
   let status =
      item.status === 'planned' && item.start < mondayOf(today)
         ? said(
              [
                 { text: `Was to start ${dayWords(item.start)}, ` },
                 { text: 'still marked Planned', owed: 'unstarted' },
              ],
              `Its start week has gone by and it’s still marked Planned: mark it ${IN_PROGRESS}, or move it.`
           )
         : null;
   let health = healthWords(healthStanding(item, now), item.updated_at);
   const waits = waitsWords(item, all);
   if (call) {
      // Decide's question is the row's one amber mark, after its reason
      const ask: Piece[] = [{ text: ' · ' }, { text: call.question, amber: true }];
      const decide = `Decide asks: ${call.title}`;
      if ((call.kind === 'off_track' || call.kind === 'at_risk') && health) {
         health = said([...health.pieces, ...ask], `${health.title}\n${decide}`);
      } else if (call.kind === 'missed' && target) {
         target = {
            ...said([...target.pieces, ...ask], `${target.title} ${decide}`),
            due: target.due,
         };
      } else {
         status = said([{ text: call.text }, ...ask], decide);
      }
      return { status, health, over, target, waits, call };
   }
   const worst = [status, health, over, target, waits]
      .flatMap(w => w?.pieces ?? [])
      .filter(p => p.owed)
      .sort((a, b) => OWED.indexOf(a.owed as Owed) - OWED.indexOf(b.owed as Owed))[0];
   if (worst) worst.amber = true;
   return { status, health, over, target, waits, call };
}

/**
 * The one thing a plan's row says at rest, after its name: the words that
 * hold its amber piece (Decide's call with its question, or else the worst
 * thing owed), or else its health word alone ("On track"), or else nothing,
 * since the bar's form already says its status. Everything else waits in the
 * plan's details. A plan past its end whose bar draws the overrun
 * (`overDrawn`) lets that piece carry it, so it isn't said twice. `opens`
 * is what a click on the words opens: its updates when they're about an
 * update, else its plan, where Decide's call is answered.
 */
export function restWords(
   w: PlanWarnings,
   overDrawn: boolean
): { said: Said; opens: 'plan' | 'update' } | null {
   const owed = [w.status, w.health, w.over, w.target, w.waits].find(isAmber);
   if (owed && !(owed === w.over && overDrawn)) {
      return { said: owed, opens: owed === w.health && !w.call ? 'update' : 'plan' };
   }
   const word = w.health?.pieces[0];
   // a plan its numbers vouch for, with no update to quote, has nothing to say
   if (!w.health || !word || w.health.text === NO_UPDATE_NEEDED_WORD) return null;
   return { said: said([{ text: word.text }], w.health.title), opens: 'update' };
}

/**
 * The owed words a change takes away, for its receipt: the worst one the
 * plan said before and doesn't after. A week's nudge can do it without
 * anyone meaning to ("No update yet", when the start moves past the days an
 * update was owed for), so the receipt says so beside its Undo. Null when
 * nothing owed went away.
 */
export function clearedBy(before: PlanWarnings, after: PlanWarnings): string | null {
   const owed = (w: PlanWarnings) =>
      [w.status, w.health, w.over, w.target, w.waits]
         .flatMap(s => s?.pieces ?? [])
         .filter(p => p.owed)
         .sort((a, b) => OWED.indexOf(a.owed as Owed) - OWED.indexOf(b.owed as Owed));
   const still = new Set(owed(after).map(p => p.owed));
   return owed(before).find(p => !still.has(p.owed))?.text ?? null;
}

/** The same words with no amber piece, where another mark already says it. */
export const inInk = (s: Said): Said => ({
   ...s,
   pieces: s.pieces.map(p => ({ ...p, amber: false })),
});

/** What a team lane counts as being worked on this week, for its hover and
 * the roadmap's help (model/teamLoad.ts). */
export const TEAM_LOAD_RULE =
   'plans under way with PRs open, done or parked plans whose PRs still moved in the last week, and projects with PRs open and no plan';

/**
 * A team lane's load in words, for its band: what its developers have on
 * this week (model/teamLoad.ts, the count Decide's team sentence uses too),
 * against how many there are. Once that's as many as the developers or
 * more, at least one piece of work has one developer or none, so the
 * planner owes the lane a new order: the reason is said, in amber, after
 * the facts. Null with nothing being worked on.
 */
export function capacityWords(count: number, developers: number): Said | null {
   if (!count) return null;
   const facts = `${count} ${BEING_WORKED_ON} this week, for ${n(developers, 'developer')}`;
   const rule = `Counts ${TEAM_LOAD_RULE}.`;
   if (count < developers) return said([{ text: facts }], rule);
   return said(
      [
         { text: `${facts} · ` },
         { text: count > developers ? 'more than it can staff' : 'no one to spare', amber: true },
      ],
      `With as much ${BEING_WORKED_ON} as there are developers, at least one piece of work has one developer or none. ${rule}`
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
 * newest first, each with the plan as it stood then. The form opens with an
 * update drafted from the plan's numbers (model/updateDraft.ts), so posting
 * it is one click, "Post as drafted", and the lead can change it first. The
 * row's words change as soon as the server has the new one, and the form
 * says it was posted.
 */
export function UpdatesPanel({
   item,
   bare = false,
   autoFocus = false,
   actions,
   onClose,
   dirty,
}: {
   item: RoadmapItem;
   /** kept true while its box holds words someone wrote and hasn't posted */
   dirty?: MutableRefObject<boolean>;
   /** no rule of its own on top: it sits in a box that already has an edge */
   bare?: boolean;
   /** put the focus in the update's box when it opens */
   autoFocus?: boolean;
   /** more ways out, beside Post update */
   actions?: ReactNode;
   /** Escape closes it, once nothing's typed in the box */
   onClose?: () => void;
}) {
   const [history, setHistory] = useState<RoadmapUpdate[] | 'failed' | null>(null);
   // drafted once, as it opens: the numbers moving on a reload mustn't
   // change what the lead is reading
   const [draft] = useState(() => draftUpdate(item, Date.now() / 1000));
   const [health, setHealth] = useState<RoadmapHealth>(
      draft?.health ?? item.update?.health ?? 'on_track'
   );
   const [body, setBody] = useState(draft?.body ?? '');
   const [posting, setPosting] = useState(false);
   const [error, setError] = useState<string | null>(null);
   // the update just posted, so its Undo can take it back
   const [posted, setPosted] = useState<RoadmapUpdate | null>(null);
   const [tookBack, setTookBack] = useState(false);
   const box = useRef<HTMLTextAreaElement>(null);
   const asDrafted = !!draft && health === draft.health && body === draft.body;
   // someone's own words, not the draft as it came
   const written = !!body.trim() && body !== draft?.body;
   useEffect(() => {
      if (!dirty) return;
      dirty.current = written;
      return () => {
         dirty.current = false;
      };
   });
   useEffect(() => {
      // the opener scrolls the panel into view, clear of the sticky headers;
      // the caret after the draft, to add to it
      const el = box.current;
      if (!autoFocus || !el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
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
      setPosted(result.update);
      setTookBack(false);
      setHistory(h => [result.update, ...(Array.isArray(h) ? h : [])]);
   };
   // Undo where Post was: the update goes, and its words come back to the
   // box, as if it was never posted
   const takeBack = async () => {
      if (!posted) return;
      const result = await takeBackRoadmapUpdate(item.id, posted.id);
      if ('error' in result) return setError(result.error);
      setError(null);
      setHistory(h => (Array.isArray(h) ? h.filter(u => u.id !== posted.id) : h));
      setBody(posted.body);
      setHealth(posted.health);
      setPosted(null);
      setTookBack(true);
   };
   const list = Array.isArray(history) ? history : [];
   return (
      <div
         className={`${bare ? '' : 'border-t border-secondary'} bg-muted/40 px-3.5 py-3`}
         onKeyDown={e => {
            if (e.key !== 'Escape' || !onClose) return;
            // a stray Escape mustn't throw away an update half written; the
            // draft as it came isn't anyone's writing
            if (written) {
               setError('Post the update, or empty the box to close it.');
            } else onClose();
         }}
      >
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
               {asDrafted && (
                  <span className="text-xs text-ink-3">Drafted from its PRs and issues</span>
               )}
            </div>
            <textarea
               ref={box}
               aria-label={`Update on ${item.name}`}
               // as tall as the draft, where the browser can size it, and
               // narrow enough to read as prose
               className="min-h-16 max-w-[70ch] rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] field-sizing-content"
               value={body}
               maxLength={2000}
               onChange={e => {
                  setBody(e.target.value);
                  setPosted(null);
                  setTookBack(false);
               }}
               placeholder="What changed, what’s in the way, what’s next"
            />
            {item.update && <SinceLast item={item} last={item.update} />}
            <div className="flex flex-wrap items-center gap-3">
               <PrimaryButton disabled={posting}>
                  {asDrafted ? 'Post as drafted' : 'Post update'}
               </PrimaryButton>
               {/* the result, where the click was, and read out */}
               <span role="status" className="text-xs text-ink-2">
                  {error ??
                     (posted ? (
                        <>
                           Posted. <TextButton onClick={() => void takeBack()}>Undo</TextButton>
                        </>
                     ) : tookBack ? (
                        'Took the update back.'
                     ) : (
                        ''
                     ))}
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
 * Plan cell above is its one amber mark.
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
      <TextButton className="ml-auto" onClick={() => navigate(patch)}>
         {label}
      </TextButton>
   );
   // a row with no plan draws its own line and the calls that make one
   // (Portfolio.tsx), so this only ever shows a plan
   if (!plan) return null;
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
