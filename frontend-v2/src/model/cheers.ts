import { pullKey, shortRepo } from '../format';
import { actionState } from './actions';
import { buildReviewerPools, turnFor } from './rotation';
import type { DerivedPull } from './status';
import type { Toast } from './toast';

/**
 * "Cheers": the gamification layer. A pure, edge-triggered evaluator that turns
 * two board snapshots (last seen vs now) into transient toast messages —
 * rewards when your review work lands, nags when it piles up. Kept in model/
 * and side-effect-free so the trigger logic is unit-testable without a
 * renderer; toasts.tsx owns the React hook, timers, and DOM.
 *
 * The whole thing is viewer-relative and session-only: there's no per-user
 * history on the server (stats-history is org-wide aggregate), so "3 this
 * sitting" resets on reload — honestly, since a reload has no memory of what
 * you cleared. The first pass after load only primes the baseline: we never
 * dump a backlog of "new" stamps or a stale-since-forever nag the moment you
 * open the board, same discipline as desktop notifications.
 */

export type CheerTone = 'reward' | 'nag';

export type CheerToast = Toast;

/** Everything the evaluator must remember between ticks. Plain data (Sets and
 * numbers) so a caller can hold it in a ref and a test can assert on it. */
export interface CheerBaseline {
   primed: boolean;
   /** pull keys you currently hold a CR/QA stamp on */
   stamped: ReadonlySet<string>;
   /** your open review/qa/restamp count last tick */
   queue: number;
   /** highest queue threshold already nagged, so a growing pile nags once per
    * step up, not every tick; reset to 0 when the queue drains */
   nagLevel: number;
   /** stamps you've landed this session (drives milestones) */
   sessionStamps: number;
   /** milestone counts already celebrated */
   firedMilestones: ReadonlySet<number>;
   /** turn-rotation pulls already nagged, so "your turn" fires once per pull */
   seenTurns: ReadonlySet<string>;
   /** your restamp-owed count last tick (aggregate 0→>0 transition) */
   restamp: number;
}

export const EMPTY_BASELINE: CheerBaseline = {
   primed: false,
   stamped: new Set(),
   queue: 0,
   nagLevel: 0,
   sessionStamps: 0,
   firedMilestones: new Set(),
   seenTurns: new Set(),
   restamp: 0,
};

export interface CheerInput {
   pulls: DerivedPull[];
   me: string;
   claims: Readonly<Record<string, { login: string; at: number }>>;
}

/** Queue sizes that earn a nag as you cross them going up. */
const NAG_STEPS = [3, 5, 8];
/** Session stamp counts worth celebrating. */
const MILESTONES = [3, 5, 10];
/** No single tick fires more than this — a socket burst that flips many pulls
 * at once shouldn't bury the screen in toasts. */
const MAX_PER_TICK = 3;

const STAMP_PRAISE = ['Nice one.', 'The team thanks you.', "Keep 'em coming.", 'Clean.'];
const MILESTONE_PRAISE = ["Somebody's on a roll.", 'The queue fears you.', 'Unstoppable.'];
const NAG_LINES = [
   "They're getting lonely.",
   "The board's holding its breath.",
   'No rush. (There is a little rush.)',
];

/** Deterministic rotation through a copy list — seeded, not random, so tests
 * are stable and two clients narrate the same board the same way. */
function pick(list: string[], seed: number): string {
   return list[((seed % list.length) + list.length) % list.length];
}

/** Highest crossed nag step for a queue size (0 if below the first step). */
function nagStepFor(queue: number): number {
   let step = 0;
   for (const s of NAG_STEPS) if (queue >= s) step = s;
   return step;
}

export interface Signals {
   stamped: Set<string>;
   queue: number;
   review: number;
   qa: number;
   restamp: number;
   /** pull keys the rotation currently names the viewer for, unclaimed */
   turns: Map<string, DerivedPull>;
   /** the pull behind each freshly-stamped key, for the toast's body/link */
   byKey: Map<string, DerivedPull>;
}

export function readSignals(input: CheerInput): Signals {
   const { pulls, me, claims } = input;
   const pools = buildReviewerPools(pulls);
   const stamped = new Set<string>();
   const turns = new Map<string, DerivedPull>();
   const byKey = new Map<string, DerivedPull>();
   let review = 0;
   let qa = 0;
   let restamp = 0;
   for (const p of pulls) {
      const key = pullKey(p.data);
      byKey.set(key, p);
      const mine = p.crBy.includes(me) || p.qaBy.includes(me);
      if (mine) stamped.add(key);
      const st = actionState(p, me);
      if (st === 'review') review++;
      else if (st === 'qa') qa++;
      else if (st === 'restamp') restamp++;
      if (!mine && !claims[key] && turnFor(p, pools) === me) turns.set(key, p);
   }
   return { stamped, queue: review + qa + restamp, review, qa, restamp, turns, byKey };
}

/**
 * Read the board and diff it into toasts — the top-level entry the React hook
 * calls. readSignals does the model-touching read; diffCheers is the pure
 * transition logic (tested directly against synthetic Signals).
 */
export function evaluateCheers(
   input: CheerInput,
   base: CheerBaseline
): { toasts: CheerToast[]; next: CheerBaseline } {
   return diffCheers(readSignals(input), input.me, base);
}

/**
 * Diff two board snapshots into the toasts worth firing right now, plus the
 * baseline to carry into the next tick. Pure: everything it needs is in `sig`,
 * `me`, and `base`. The first call (an unprimed baseline) fires nothing: it
 * records where you started so only what changes afterward speaks up.
 */
export function diffCheers(
   sig: Signals,
   me: string,
   base: CheerBaseline
): { toasts: CheerToast[]; next: CheerBaseline } {
   if (!base.primed || !me) {
      // prime silently: adopt the current world as the baseline, including the
      // turns and nag level already standing, so a reload never dumps a backlog
      return {
         toasts: [],
         next: {
            primed: !!me,
            stamped: sig.stamped,
            queue: sig.queue,
            nagLevel: nagStepFor(sig.queue),
            sessionStamps: 0,
            firedMilestones: new Set(),
            seenTurns: new Set(sig.turns.keys()),
            restamp: sig.restamp,
         },
      };
   }

   const toasts: CheerToast[] = [];
   let sessionStamps = base.sessionStamps;
   const firedMilestones = new Set(base.firedMilestones);

   // ── Rewards ──────────────────────────────────────────────────────────────
   // a stamp of yours that wasn't there last tick landed
   const landed: DerivedPull[] = [];
   for (const key of sig.stamped) {
      if (!base.stamped.has(key)) {
         const p = sig.byKey.get(key);
         if (p) landed.push(p);
      }
   }
   for (const p of landed.slice(0, 2)) {
      sessionStamps++;
      const isQa = p.qaBy.includes(me) && !p.crBy.includes(me);
      toasts.push({
         tone: 'reward',
         icon: isQa ? '🧪' : '✅',
         title: pick(STAMP_PRAISE, sessionStamps),
         body: `${shortRepo(p.data.repo)}#${p.data.number} ${isQa ? 'QA' : 'CR'} landed`,
         pull: { repo: p.data.repo, number: p.data.number },
      });
   }
   // any leftover landed stamps past the cap still count toward milestones
   sessionStamps += Math.max(0, landed.length - 2);

   // milestone: a round number of stamps this sitting
   for (const m of MILESTONES) {
      if (sessionStamps >= m && !firedMilestones.has(m)) {
         firedMilestones.add(m);
         toasts.push({
            tone: 'reward',
            icon: '🔥',
            title: `${sessionStamps} reviews this sitting`,
            body: pick(MILESTONE_PRAISE, sessionStamps),
            celebrate: true,
         });
      }
   }

   // queue cleared: the hero moment
   let nagLevel = base.nagLevel;
   if (base.queue > 0 && sig.queue === 0) {
      toasts.push({
         tone: 'reward',
         icon: '🎉',
         title: 'Inbox zero',
         body: "Nothing's waiting on you. Go build something.",
         celebrate: true,
      });
      nagLevel = 0;
   }

   // ── Nags ─────────────────────────────────────────────────────────────────
   // your pile crossed a new threshold going up
   const step = nagStepFor(sig.queue);
   if (sig.queue === 0) {
      nagLevel = 0;
   } else if (step > nagLevel) {
      nagLevel = step;
      toasts.push({
         tone: 'nag',
         icon: sig.queue >= 8 ? '😰' : sig.queue >= 5 ? '😔' : '🥱',
         title: `${sig.queue} reviews are waiting on you`,
         body: pick(NAG_LINES, sig.queue),
      });
   } else if (step < nagLevel) {
      // pile shrank below the last nagged step: lower the bar so a later climb
      // back up nags again, but don't celebrate here (that's the cleared branch)
      nagLevel = step;
   }

   // the rotation newly named you on a starved pull. Next tick's seenTurns is
   // just the current turn keys — a pull that stops being yours is forgotten,
   // so if it later comes back around it can nag again.
   for (const [key, p] of sig.turns) {
      if (base.seenTurns.has(key)) continue;
      toasts.push({
         tone: 'nag',
         icon: '⏳',
         title: `${shortRepo(p.data.repo)}#${p.data.number} has your name on it`,
         body: `Waiting ${Math.max(1, Math.round(p.ageDays))}d — the rotation picked you.`,
         pull: { repo: p.data.repo, number: p.data.number },
      });
   }
   const seenTurns = new Set(sig.turns.keys());

   // a stamp of yours went stale (aggregate, so a re-QA storm is one toast)
   if (base.restamp === 0 && sig.restamp > 0) {
      toasts.push({
         tone: 'nag',
         icon: '🥀',
         title: 'A stamp of yours went stale',
         body: `${sig.restamp} need${sig.restamp > 1 ? '' : 's'} another look.`,
      });
   }

   return {
      toasts: toasts.slice(0, MAX_PER_TICK),
      next: {
         primed: true,
         stamped: sig.stamped,
         queue: sig.queue,
         nagLevel,
         sessionStamps,
         firedMilestones,
         seenTurns,
         restamp: sig.restamp,
      },
   };
}
