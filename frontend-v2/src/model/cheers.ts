import { pullKey, shortRepo } from '../format';
import type { PullData } from '../types';
import { actionState } from './actions';
import { dealOne } from './deal';
import { reviewerRanks } from './leaderboard';
import { reviewRequestedFrom } from './reviewers';
import { buildReviewerPools, turnFor } from './rotation';
import { crSort } from './sort';
import type { DerivedPull } from './status';
import type { Toast } from './toast';

/**
 * "Cheers": the gamification layer. A pure, edge-triggered evaluator that turns
 * two board snapshots (last seen vs now) into transient toast messages —
 * rewards when your review work lands, nags when it piles up, and a steady
 * "here's the one thing to do next" nudge so a reviewer never has to browse.
 * Kept in model/ and side-effect-free so the trigger logic is unit-testable
 * without a renderer; toasts.tsx owns the React hook, timers, and DOM.
 *
 * The whole thing is viewer-relative and session-only: there's no per-user
 * history on the server (stats-history is org-wide aggregate), so "3 this
 * sitting" resets on reload — honestly, since a reload has no memory of what
 * you cleared. The first pass after load only primes the baseline, with one
 * deliberate exception: start-here still fires once, because "here's your
 * next pull" is the whole point of opening the board, not a backlog dump.
 * Every other signal is silent until it changes.
 */

export type CheerTone = 'reward' | 'nag' | 'info';

export type CheerToast = Toast;

/** Everything the evaluator must remember between ticks. Plain data (Sets and
 * numbers) so a caller can hold it in a ref and a test can assert on it. */
export interface CheerBaseline {
   primed: boolean;
   /** pull keys you currently hold a CR/QA stamp on */
   stamped: ReadonlySet<string>;
   /** your open review/qa/restamp count last tick */
   queue: number;
   /** highest queue threshold already crossed — no toast reads this anymore
    * (the old "N reviews waiting" nag is gone), but it's carried forward
    * as standing state for the next pass to reuse or retire outright. */
   nagLevel: number;
   /** stamps you've landed this session (drives milestones) */
   sessionStamps: number;
   /** milestone counts already celebrated */
   firedMilestones: ReadonlySet<number>;
   /** turn-rotation pulls already nagged, so "your turn" fires once per pull */
   seenTurns: ReadonlySet<string>;
   /** pull keys where you currently owe a re-stamp (recrBy/reqaBy has you) */
   restampKeys: ReadonlySet<string>;
   /** you've already been told about the current batch of quick wins */
   quickWinsNagged: boolean;
   /** debtor logins already nudged for reciprocity this session */
   favorsSeen: ReadonlySet<string>;
   /** your leaderboard rank last tick (0 = unranked / no stamps in view) */
   myRank: number;
   /** you were the #1 reviewer on the board last tick */
   wasTop: boolean;
   /** review requests already toasted, so each fires once per pull; rebuilt
    * from the current tick so a dropped-then-re-requested review nags again */
   requestedSeen: ReadonlySet<string>;
   /** you had at least one reviewable pull last tick */
   hadBacklog: boolean;
   /** per your-own open PR, last tick's state, for author-side edges */
   authorPrs: ReadonlyMap<string, AuthorPrState>;
   /** the whole board's viewer-reviewable count last tick (board-cleared) */
   boardQueue: number;
   /** pull keys you hold a stale, unreviewed claim on that were already nagged,
    * rebuilt from the current tick so a release-then-reclaim can nag again */
   staleClaimsSeen: ReadonlySet<string>;
}

export const EMPTY_BASELINE: CheerBaseline = {
   primed: false,
   stamped: new Set(),
   queue: 0,
   nagLevel: 0,
   sessionStamps: 0,
   firedMilestones: new Set(),
   seenTurns: new Set(),
   restampKeys: new Set(),
   quickWinsNagged: false,
   favorsSeen: new Set(),
   myRank: 0,
   wasTop: false,
   requestedSeen: new Set(),
   hadBacklog: false,
   authorPrs: new Map(),
   boardQueue: 0,
   staleClaimsSeen: new Set(),
};

export interface CheerInput {
   pulls: DerivedPull[];
   /** closed pulls in the loaded window, for the leaderboard's tally — optional
    * so older callers still typecheck; an absent window just ranks off the
    * open board. */
   closed?: PullData[];
   me: string;
   claims: Readonly<Record<string, { login: string; at: number }>>;
   /** current time (ms epoch), for aging claims into a stale-claim nag —
    * injected so the model stays pure and testable; the hook passes Date.now() */
   now?: number;
   /** how long a claim of yours may sit before the stale-claim nag fires (ms);
    * the viewer's claim-warning setting, falling back to STALE_CLAIM_MS */
   claimWarnMs?: number;
   /** cheer kinds the viewer has switched off — filtered before the per-tick
    * cap, so muting a high-priority kind frees its slot for a shown one rather
    * than firing then hiding it. */
   muted?: ReadonlySet<ToastKind>;
}

/** A claim you're sitting on stops absolving other reviewers at 2h (see
 * model/actions STALE_CLAIM_SECS); that's the moment worth a nudge to either
 * finish it or hand it back. Kept here as a self-contained duplicate, same as
 * hasStamp, so the evaluator doesn't couple to the actions module. */
const STALE_CLAIM_MS = 2 * 60 * 60 * 1000;

/** Queue sizes that used to earn the retired count nag as you crossed them. */
const NAG_STEPS = [3, 5, 8];
/** Session stamp counts worth celebrating. */
const MILESTONES = [3, 5, 10];
/** No single tick fires more than this — a socket burst that flips many pulls
 * at once shouldn't bury the screen in toasts. */
const MAX_PER_TICK = 3;
/** Quick-win pile size that's worth a heads-up. */
const QUICK_WIN_THRESHOLD = 3;

const STAMP_PRAISE = ['Nice one.', "Keep 'em coming.", 'Clean.'];
const MILESTONE_PRAISE = ['Good pace.'];

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

/** Has `login` landed an active CR or QA stamp on this pull? Mirrors
 * deal.ts's private helper — duplicated rather than imported so this stays a
 * small, self-contained pure check like the rest of model/. */
function hasStamp(p: DerivedPull, login: string): boolean {
   return p.crBy.includes(login) || p.qaBy.includes(login);
}

/**
 * The one-line "why this pull" for start-here, in the priority order the spec
 * calls for: reciprocity beats familiarity beats a quick win beats plain
 * urgency. `pulls` is the whole board (not just the queue) — familiarity and
 * reciprocity look across every repo/author the viewer touches, matching
 * deal.ts's own scoring.
 */
export function startHereReason(p: DerivedPull, pulls: DerivedPull[], me: string): string {
   const repo = p.data.repo;
   const author = p.data.user.login;
   const owedByAuthor = pulls.some(o => o.data.user.login === me && hasStamp(o, author));
   if (owedByAuthor) return `${author} reviewed yours — return the favor`;
   const familiar = pulls.some(o => o.data.repo === repo && hasStamp(o, me));
   if (familiar) return `You know ${shortRepo(repo)} — less to load in`;
   const quickWin = p.sizeKnown && (p.weight === 'XS' || p.weight === 'S');
   if (quickWin) return `Small one (${p.weight}) — quick`;
   return `Waiting ${Math.max(1, Math.round(p.ageDays))}d, the oldest on your plate`;
}

/** The PR a toast points at — repo, number, and human title, so the card can
 * render "#123 Fix the thing" as a link instead of a bare number. */
function pullRef(p: DerivedPull): { repo: string; number: number; title: string } {
   return { repo: p.data.repo, number: p.data.number, title: p.data.title };
}

function startHereToast(p: DerivedPull, reason: string): CheerToast {
   return {
      tone: 'info',
      icon: '🎯',
      title: 'Start here',
      body: reason,
      pull: pullRef(p),
      dedupeKey: `start:${pullKey(p.data)}`,
   };
}

/** A your-own-PR's state, watched for author-side toast transitions. */
export interface AuthorPrState {
   green: boolean;
   reviewed: boolean;
   conflict: boolean;
   starved: boolean;
   /** a required check went red — the author's build to fix */
   ciRed: boolean;
   /** a reviewer requested changes or holds a dev block — the author owes a
    * response (mirrors the desktop-notification "Changes requested" alert) */
   needsAnswer: boolean;
}

export interface Signals {
   stamped: Set<string>;
   /** your open review/qa/restamp count, any claim state */
   queue: number;
   review: number;
   qa: number;
   /** board-wide count of pulls still awaiting a review from anyone — drives
    * board-cleared, so clearing your OWN queue doesn't misfire "nice work team" */
   boardReviewable: number;
   /** pull keys where you currently owe a re-stamp */
   restampKeys: Set<string>;
   /** pull keys the rotation currently names the viewer for, unclaimed */
   turns: Map<string, DerivedPull>;
   /** the pull behind each key, for a toast's body/link */
   byKey: Map<string, DerivedPull>;
   /** unclaimed XS/S reviewable pulls on the board right now */
   quickWinCount: number;
   quickWinPull: DerivedPull | null;
   /** the single best pull to review next, or null with an empty backlog */
   bestStart: DerivedPull | null;
   startReason: string;
   /** unclaimed reviewable count (excludes claimed pulls, unlike `review`) */
   backlog: number;
   /** authors who owe you a favor and have an open reviewable PR, in a
    * deterministic order; one entry per debtor */
   debtors: { login: string; pull: DerivedPull; count: number }[];
   authorPrs: Map<string, AuthorPrState>;
   myRank: number;
   myCount: number;
   /** the login one rank behind you, for the "climbing" toast */
   peerBelow: string | null;
   /** pulls you hold a stale (2h+), still-unreviewed claim on */
   staleClaims: Map<string, DerivedPull>;
   /** pulls GitHub has asked YOU to review (and you haven't yet), for the
    * review-requested toast — the most direct "review this" the board carries */
   requestedOfMe: Map<string, DerivedPull>;
}

export function readSignals(input: CheerInput): Signals {
   const { pulls, me, claims } = input;
   const closed = input.closed ?? [];
   const now = input.now ?? Date.now();
   const pools = buildReviewerPools(pulls);
   const stamped = new Set<string>();
   const turns = new Map<string, DerivedPull>();
   const byKey = new Map<string, DerivedPull>();
   const restampKeys = new Set<string>();
   let review = 0;
   let qa = 0;

   for (const p of pulls) {
      const key = pullKey(p.data);
      byKey.set(key, p);
      const mine = hasStamp(p, me);
      if (mine) stamped.add(key);
      const st = actionState(p, me);
      if (st === 'review') review++;
      else if (st === 'qa') qa++;
      else if (st === 'restamp') restampKeys.add(key);
      if (!mine && !claims[key] && turnFor(p, pools) === me) turns.set(key, p);
   }

   const reviewableUnclaimed = pulls.filter(
      p => actionState(p, me) === 'review' && !claims[pullKey(p.data)]
   );

   const quickWinCandidates = crSort(
      reviewableUnclaimed.filter(p => p.sizeKnown && (p.weight === 'XS' || p.weight === 'S'))
   );
   const quickWinPull = quickWinCandidates[0] ?? null;

   const bestStart = dealOne(reviewableUnclaimed, { me, pulls, claims, passed: new Set() });
   const startReason = bestStart ? startHereReason(bestStart, pulls, me) : '';

   // reciprocity: who has stamped one of your own pulls, and do they have an
   // open reviewable pull of their own right now?
   const myPulls = pulls.filter(p => p.data.user.login === me);
   const debtorPullKeys = new Map<string, Set<string>>();
   for (const p of myPulls) {
      const key = pullKey(p.data);
      for (const login of new Set([...p.crBy, ...p.qaBy])) {
         const keys = debtorPullKeys.get(login) ?? new Set<string>();
         keys.add(key);
         debtorPullKeys.set(login, keys);
      }
   }
   const debtors: { login: string; pull: DerivedPull; count: number }[] = [];
   const seenDebtor = new Set<string>();
   for (const p of crSort(reviewableUnclaimed)) {
      const author = p.data.user.login;
      const count = debtorPullKeys.get(author)?.size ?? 0;
      if (count > 0 && !seenDebtor.has(author)) {
         seenDebtor.add(author);
         debtors.push({ login: author, pull: p, count });
      }
   }

   const authorPrs = new Map<string, AuthorPrState>();
   for (const p of myPulls) {
      authorPrs.set(pullKey(p.data), {
         green: p.status === 'ready',
         reviewed: p.crBy.length > 0,
         conflict: p.conflict,
         starved: p.starved,
         ciRed: p.status === 'ci_red',
         needsAnswer: p.status === 'dev_block' || p.changesRequestedBy.length > 0,
      });
   }

   const boardReviewable = pulls.filter(
      p => p.status === 'needs_cr' || p.status === 'needs_recr' || p.status === 'needs_qa'
   ).length;

   // claims of yours gone stale (past 2h) that you still haven't stamped — the
   // nudge to either finish the review or release it back to the pool
   const warnMs = input.claimWarnMs ?? STALE_CLAIM_MS;
   const staleClaims = new Map<string, DerivedPull>();
   for (const p of pulls) {
      const key = pullKey(p.data);
      const c = claims[key];
      if (c && c.login === me && !hasStamp(p, me) && now - c.at > warnMs) {
         staleClaims.set(key, p);
      }
   }

   // GitHub asked you to review these and you haven't stamped or claimed them —
   // a direct request, distinct from the rotation's guess (which stays silent
   // on requested pulls). Drives the review-requested toast.
   const requestedOfMe = new Map<string, DerivedPull>();
   for (const p of pulls) {
      const key = pullKey(p.data);
      if (
         (p.status === 'needs_cr' || p.status === 'needs_recr') &&
         reviewRequestedFrom(p, me) &&
         !p.crBy.includes(me) &&
         claims[key]?.login !== me
      ) {
         requestedOfMe.set(key, p);
      }
   }

   const ranks = reviewerRanks(pulls, closed);
   const mine = ranks.get(me);
   const myRank = mine?.rank ?? 0;
   const myCount = mine?.count ?? 0;
   let peerBelow: string | null = null;
   if (myRank > 0) {
      const candidates = [...ranks.entries()]
         .filter(([login, r]) => login !== me && r.rank === myRank + 1)
         .map(([login]) => login)
         .sort();
      peerBelow = candidates[0] ?? null;
   }

   return {
      stamped,
      queue: review + qa + restampKeys.size,
      review,
      qa,
      boardReviewable,
      restampKeys,
      turns,
      byKey,
      quickWinCount: quickWinCandidates.length,
      quickWinPull,
      bestStart,
      startReason,
      backlog: reviewableUnclaimed.length,
      debtors,
      authorPrs,
      myRank,
      myCount,
      peerBelow,
      staleClaims,
      requestedOfMe,
   };
}

/**
 * Read the board and diff it into toasts — the top-level entry the React hook
 * calls. readSignals does the model-touching read (including the leaderboard,
 * via reviewerRanks(input.pulls, input.closed)); diffCheers is the pure
 * transition logic (tested directly against synthetic Signals).
 */
export function evaluateCheers(
   input: CheerInput,
   base: CheerBaseline
): { toasts: CheerToast[]; next: CheerBaseline } {
   return diffCheers(readSignals(input), input.me, base, input.muted);
}

/** Toast categories, highest priority first — what survives when a tick
 * overflows MAX_PER_TICK. */
export const PRIORITY_ORDER = [
   'board-cleared',
   'inbox-zero',
   'pr-green',
   'milestone',
   'top-of-board',
   'climbing',
   'stamp-landed',
   'pr-first-review',
   'review-requested',
   'your-turn',
   're-stamp-owed',
   'claim-stale',
   'return-the-favor',
   'start-here',
   'quick-wins',
   'pr-ci-red',
   'pr-changes',
   'pr-conflicts',
   'pr-starving',
] as const;
export type ToastKind = (typeof PRIORITY_ORDER)[number];
const PRIORITY: Record<ToastKind, number> = Object.fromEntries(
   PRIORITY_ORDER.map((kind, i) => [kind, PRIORITY_ORDER.length - i])
) as Record<ToastKind, number>;

/** The three families a cheer/nudge falls into, for grouping the Settings
 * toggle list: rewards you earn, nudges toward review work, and alerts about
 * your own PRs. */
export type CheerGroup = 'reward' | 'nudge' | 'author';

/**
 * User-facing catalog of every cheer/nudge kind — the group it belongs to, plus
 * a one-line label and explanation for the per-kind toggle list in Settings.
 * Kept exactly 1:1 with PRIORITY_ORDER (a test asserts the two never drift), so
 * a new toast kind can't be added without also giving it a switch and a blurb.
 */
export const CHEER_CATALOG: {
   kind: ToastKind;
   group: CheerGroup;
   label: string;
   hint: string;
}[] = [
   // Rewards — the good news
   {
      kind: 'stamp-landed',
      group: 'reward',
      label: 'Review landed',
      hint: 'A CR or QA stamp of yours lands.',
   },
   {
      kind: 'milestone',
      group: 'reward',
      label: 'Review streak',
      hint: 'You pass a round number of reviews this sitting.',
   },
   {
      kind: 'inbox-zero',
      group: 'reward',
      label: 'Inbox zero',
      hint: 'Your own review queue drops to nothing.',
   },
   {
      kind: 'board-cleared',
      group: 'reward',
      label: 'Board’s clear',
      hint: 'Nothing on the whole board is waiting on anyone.',
   },
   {
      kind: 'top-of-board',
      group: 'reward',
      label: 'Top reviewer',
      hint: 'You reach the top of the board’s leaderboard.',
   },
   {
      kind: 'climbing',
      group: 'reward',
      label: 'Climbing the ranks',
      hint: 'You pass someone on the leaderboard.',
   },
   {
      kind: 'pr-green',
      group: 'reward',
      label: 'Your PR is green',
      hint: 'A PR of yours clears CR and QA — ready to ship.',
   },
   // Nudges — what to review next
   {
      kind: 'start-here',
      group: 'nudge',
      label: 'Start here',
      hint: 'The single best pull to pick up next.',
   },
   {
      kind: 'quick-wins',
      group: 'nudge',
      label: 'Quick wins',
      hint: 'A pile of small, unclaimed reviews worth a pass.',
   },
   {
      kind: 'review-requested',
      group: 'nudge',
      label: 'Review requested',
      hint: 'Someone asked for your review on GitHub.',
   },
   {
      kind: 'your-turn',
      group: 'nudge',
      label: 'Your turn',
      hint: 'The rotation named you on a starved review.',
   },
   {
      kind: 're-stamp-owed',
      group: 'nudge',
      label: 'Changed since your ✓',
      hint: 'A PR you approved changed and wants another look.',
   },
   {
      kind: 'return-the-favor',
      group: 'nudge',
      label: 'Return the favor',
      hint: 'Someone who reviewed your PRs has one open.',
   },
   {
      kind: 'claim-stale',
      group: 'nudge',
      label: 'Stale claim',
      hint: 'A review you claimed has sat unreviewed too long.',
   },
   // Your PRs — author-side alerts
   {
      kind: 'pr-first-review',
      group: 'author',
      label: 'Picked up',
      hint: 'A reviewer started on your PR.',
   },
   { kind: 'pr-conflicts', group: 'author', label: 'Conflicts', hint: 'Your PR needs a rebase.' },
   {
      kind: 'pr-ci-red',
      group: 'author',
      label: 'CI broke',
      hint: 'A required check went red on your PR.',
   },
   {
      kind: 'pr-changes',
      group: 'author',
      label: 'Changes requested',
      hint: 'A reviewer wants edits on your PR.',
   },
   {
      kind: 'pr-starving',
      group: 'author',
      label: 'Waiting too long',
      hint: 'Your PR has gone a while with no review.',
   },
];

const NO_MUTED: ReadonlySet<ToastKind> = new Set();

/**
 * Diff two board snapshots into the toasts worth firing right now, plus the
 * baseline to carry into the next tick. Pure: everything it needs is in `sig`,
 * `me`, and `base`.
 *
 * The first call (an unprimed baseline) fires only start-here, if there's a
 * backlog — the one load-time toast, so opening the board hands you exactly
 * one good next pull instead of dumping everything that's "new" since a
 * reload has no memory of what came before. Every other signal primes
 * silently: it records where you started so only what changes afterward
 * speaks up.
 */
export function diffCheers(
   sig: Signals,
   me: string,
   base: CheerBaseline,
   muted: ReadonlySet<ToastKind> = NO_MUTED
): { toasts: CheerToast[]; next: CheerBaseline } {
   if (!base.primed || !me) {
      const toasts: CheerToast[] = [];
      if (me && sig.bestStart && sig.backlog > 0 && !muted.has('start-here')) {
         toasts.push(startHereToast(sig.bestStart, sig.startReason));
      }
      return {
         toasts,
         next: {
            primed: !!me,
            stamped: sig.stamped,
            queue: sig.queue,
            nagLevel: nagStepFor(sig.queue),
            sessionStamps: 0,
            firedMilestones: new Set(),
            seenTurns: new Set(sig.turns.keys()),
            restampKeys: sig.restampKeys,
            quickWinsNagged: sig.quickWinCount >= QUICK_WIN_THRESHOLD,
            favorsSeen: new Set(),
            myRank: sig.myRank,
            wasTop: sig.myRank === 1,
            requestedSeen: new Set(sig.requestedOfMe.keys()),
            hadBacklog: sig.backlog > 0,
            authorPrs: sig.authorPrs,
            boardQueue: sig.boardReviewable,
            staleClaimsSeen: new Set(sig.staleClaims.keys()),
         },
      };
   }

   const entries: { toast: CheerToast; kind: ToastKind }[] = [];
   // a muted kind is dropped here, before the priority sort and cap — the
   // bookkeeping around each push (session tallies, "already seen" sets) still
   // runs, so unmuting later never replays a backlog.
   const push = (kind: ToastKind, toast: CheerToast) => {
      if (!muted.has(kind)) entries.push({ toast, kind });
   };

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
      push('stamp-landed', {
         tone: 'reward',
         icon: isQa ? '🧪' : '✅',
         title: pick(STAMP_PRAISE, sessionStamps),
         body: `${isQa ? 'QA' : 'CR'} landed`,
         pull: pullRef(p),
         dedupeKey: `stamp:${pullKey(p.data)}`,
      });
   }
   // any leftover landed stamps past the cap still count toward milestones
   sessionStamps += Math.max(0, landed.length - 2);

   // milestone: a round number of stamps this sitting
   for (const m of MILESTONES) {
      if (sessionStamps >= m && !firedMilestones.has(m)) {
         firedMilestones.add(m);
         push('milestone', {
            tone: 'reward',
            icon: '🔥',
            title: `${sessionStamps} reviews this sitting`,
            body: pick(MILESTONE_PRAISE, sessionStamps),
            celebrate: true,
            dedupeKey: `milestone:${m}`,
         });
      }
   }

   // queue cleared: the hero moment
   if (base.queue > 0 && sig.queue === 0) {
      push('inbox-zero', {
         tone: 'reward',
         icon: '🎉',
         title: 'Inbox zero',
         body: "Nothing's waiting on you.",
         celebrate: true,
         dedupeKey: 'inbox:zero',
      });
   }

   // the rotation newly named you on a starved pull. Next tick's seenTurns is
   // just the current turn keys — a pull that stops being yours is forgotten,
   // so if it later comes back around it can nag again.
   for (const [key, p] of sig.turns) {
      if (base.seenTurns.has(key)) continue;
      push('your-turn', {
         tone: 'nag',
         icon: '⏳',
         title: 'Your turn on this',
         body: `Waiting ${Math.max(1, Math.round(p.ageDays))}d — the rotation picked you.`,
         pull: pullRef(p),
         dedupeKey: `turn:${key}`,
      });
   }
   const seenTurns = new Set(sig.turns.keys());

   // review requested: GitHub asked you directly. Fires once per pull (rebuilt
   // from the current tick, seenTurns-style, so a dropped-then-re-added request
   // can nag again). Distinct from your-turn: this is an explicit ask, not the
   // rotation's guess — which is why turnFor stays silent on requested pulls.
   for (const [key, p] of sig.requestedOfMe) {
      if (base.requestedSeen.has(key)) continue;
      push('review-requested', {
         tone: 'info',
         icon: '✦',
         title: 'Review requested',
         body: `${p.data.user.login} asked you to review this.`,
         pull: pullRef(p),
         dedupeKey: `req:${key}`,
      });
   }
   const requestedSeen = new Set(sig.requestedOfMe.keys());

   // start-here: the backlog re-arms after hitting zero (the prime-tick fire
   // is handled above, before this function's main body ever runs).
   if (!base.hadBacklog && sig.backlog > 0 && sig.bestStart) {
      push('start-here', startHereToast(sig.bestStart, sig.startReason));
   }

   // re-stamp owed: one toast per pull newly needing another look, replacing
   // the old aggregate "a stamp went stale" nag with something you can act on.
   const newRestamps: DerivedPull[] = [];
   for (const key of sig.restampKeys) {
      if (base.restampKeys.has(key)) continue;
      const p = sig.byKey.get(key);
      if (p) newRestamps.push(p);
   }
   for (const p of newRestamps.slice(0, MAX_PER_TICK)) {
      push('re-stamp-owed', {
         tone: 'nag',
         icon: '🔁',
         title: 'Changed since your ✓',
         body: 'Give it another look?',
         pull: pullRef(p),
         dedupeKey: `recr:${pullKey(p.data)}`,
      });
   }

   // a claim of yours went stale (2h+) and you still haven't stamped it —
   // nudge once per pull to finish it or hand it back. seenTurns-style rebuild
   // from the current tick, so releasing then re-claiming can nag again.
   for (const [key, p] of sig.staleClaims) {
      if (base.staleClaimsSeen.has(key)) continue;
      push('claim-stale', {
         tone: 'nag',
         icon: '✋',
         title: 'You claimed this — still unreviewed',
         body: "It's been a couple hours. Review it, or release it for someone else.",
         pull: pullRef(p),
         dedupeKey: `claimstale:${key}`,
      });
   }
   const staleClaimsSeen = new Set(sig.staleClaims.keys());

   // quick wins: the pile crossed the threshold going up
   let quickWinsNagged = base.quickWinsNagged;
   if (sig.quickWinCount >= QUICK_WIN_THRESHOLD && !quickWinsNagged) {
      quickWinsNagged = true;
      push('quick-wins', {
         tone: 'info',
         icon: '⚡',
         title: `${sig.quickWinCount} quick reviews on the board`,
         body: 'XS/S — small ones, unclaimed.',
         pull: sig.quickWinPull ? pullRef(sig.quickWinPull) : undefined,
         dedupeKey: `quick:${sig.quickWinCount}`,
      });
   } else if (sig.quickWinCount < QUICK_WIN_THRESHOLD) {
      quickWinsNagged = false;
   }

   // return the favor: a debtor's open reviewable pull, nudged once per debtor
   const favorsSeen = new Set(base.favorsSeen);
   for (const { login, pull: p, count } of sig.debtors) {
      if (favorsSeen.has(login)) continue;
      favorsSeen.add(login);
      push('return-the-favor', {
         tone: 'info',
         icon: '🤝',
         title: `Return the favor to ${login}`,
         body:
            count === 1
               ? 'They reviewed one of your PRs.'
               : `They've reviewed ${count} of your PRs.`,
         pull: pullRef(p),
         dedupeKey: `favor:${login}`,
      });
   }

   // leaderboard: top and climbing
   if (sig.myRank === 1 && !base.wasTop && sig.myCount > 0) {
      push('top-of-board', {
         tone: 'reward',
         icon: '🏆',
         title: 'Top reviewer on the board',
         body: `${sig.myCount} stamps in view — nobody's ahead of you.`,
         celebrate: true,
         dedupeKey: 'top:1',
      });
   }
   if (
      base.myRank > 0 &&
      sig.myRank > 0 &&
      sig.myRank < base.myRank &&
      sig.myRank > 1 &&
      sig.myCount >= 2 &&
      sig.peerBelow
   ) {
      push('climbing', {
         tone: 'reward',
         icon: '📈',
         title: `You passed ${sig.peerBelow}`,
         body: `#${sig.myRank} reviewer on the board.`,
         dedupeKey: `rank:${sig.myRank}`,
      });
   }

   // author-side: your own open PRs, watched for edge transitions only — a
   // brand-new key (a PR you just opened) has no baseline entry yet, so it
   // primes silently here rather than firing on however it first appears.
   for (const [key, now] of sig.authorPrs) {
      const was = base.authorPrs.get(key);
      if (!was) continue;
      const p = sig.byKey.get(key);
      if (!p) continue;
      if (!was.green && now.green) {
         push('pr-green', {
            tone: 'reward',
            icon: '🚀',
            title: 'Green — ship it',
            body: 'CR + QA both cleared.',
            pull: pullRef(p),
            dedupeKey: `green:${key}`,
         });
      }
      if (!was.reviewed && now.reviewed) {
         push('pr-first-review', {
            tone: 'info',
            icon: '👀',
            title: 'Someone picked up your PR',
            body: `${p.crBy[0] ?? 'A reviewer'} is on it.`,
            pull: pullRef(p),
            dedupeKey: `firstrev:${key}`,
         });
      }
      if (!was.conflict && now.conflict) {
         push('pr-conflicts', {
            tone: 'nag',
            icon: '⚠️',
            title: 'Conflicts on your PR',
            body: 'Needs a rebase.',
            pull: pullRef(p),
            dedupeKey: `conflict:${key}`,
         });
      }
      if (!was.ciRed && now.ciRed) {
         push('pr-ci-red', {
            tone: 'nag',
            icon: '🔴',
            title: 'CI broke on your PR',
            body: p.ciFailing?.length ? `Fix ${p.ciFailing.join(', ')}.` : 'Fix the build.',
            pull: pullRef(p),
            dedupeKey: `cired:${key}`,
         });
      }
      if (!was.needsAnswer && now.needsAnswer) {
         push('pr-changes', {
            tone: 'nag',
            icon: '💬',
            title: 'Changes requested on your PR',
            body: 'A reviewer wants edits — answer the feedback.',
            pull: pullRef(p),
            dedupeKey: `changes:${key}`,
         });
      }
      if (!was.starved && now.starved) {
         push('pr-starving', {
            tone: 'nag',
            icon: '🕰️',
            title: `Waiting ${p.ageDays}d for review`,
            body: 'Your PR — worth a nudge?',
            pull: pullRef(p),
            dedupeKey: `starve:${key}`,
         });
      }
   }

   // board cleared: the whole board's awaiting-review count dropped to zero —
   // board-wide, so this is a rare all-hands moment, not just your queue
   if (base.boardQueue > 0 && sig.boardReviewable === 0) {
      push('board-cleared', {
         tone: 'reward',
         icon: '🎊',
         title: "Board's clear",
         body: 'Nothing waiting on anyone.',
         celebrate: true,
         dedupeKey: 'board:clear',
      });
   }

   // ── nagLevel bookkeeping only (no toast fires from this anymore — the old
   // count nag is retired in favor of start-here) ──────────────────────────
   let nagLevel = base.nagLevel;
   const step = nagStepFor(sig.queue);
   if (sig.queue === 0) nagLevel = 0;
   else nagLevel = step;

   const toasts = entries
      .sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind])
      .slice(0, MAX_PER_TICK)
      .map(e => e.toast);

   return {
      toasts,
      next: {
         primed: true,
         stamped: sig.stamped,
         queue: sig.queue,
         nagLevel,
         sessionStamps,
         firedMilestones,
         seenTurns,
         restampKeys: sig.restampKeys,
         quickWinsNagged,
         favorsSeen,
         myRank: sig.myRank,
         wasTop: sig.myRank === 1,
         requestedSeen,
         hadBacklog: sig.backlog > 0,
         authorPrs: sig.authorPrs,
         boardQueue: sig.boardReviewable,
         staleClaimsSeen,
      },
   };
}
