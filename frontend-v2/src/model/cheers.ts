import { pullKey } from '../../../shared/format';
import type { PullData } from '../../../shared/types';
import { actionState, STALE_CLAIM_SECS } from './actions';
import { dealFrom, dealRank } from './deal';
import { reviewerRanks } from './leaderboard';
import { claimFor, reviewRequestedFrom } from './reviewers';
import { crSort } from './sort';
import { CR_INCOMPLETE, type DerivedPull } from '../../../shared/model/status';
import type { Toast } from './toast';
import { isSuffixBot } from '../../../shared/model/visibility';

/** The suffix bot check ('…[bot]') is enough in the cheers layer — like
 * status.ts's engagedNoStamp, this module has no reason to depend on
 * the org's configured bots list, and a non-suffixed bot slipping through just costs
 * one soft nudge, never a wrong review decision. */
const isBot = (p: DerivedPull) => isSuffixBot(p.data.user.login);

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

export type CheerToast = Toast;

/** Everything the evaluator must remember between ticks. Plain data (Sets and
 * numbers) so a caller can hold it in a ref and a test can assert on it. */
export interface CheerBaseline {
   primed: boolean;
   /** whose history this is — a baseline primed for one viewer must never be
    * diffed against another's signals (every pre-existing stamp would read as
    * freshly landed), so a login mismatch re-primes. '' = legacy/unprimed. */
   login: string;
   /** pull keys you currently hold a CR/QA stamp on */
   stamped: ReadonlySet<string>;
   /** your open review/qa/restamp count last tick */
   queue: number;
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
   /** your stamp count last tick — climbing requires it to have GROWN, so a
    * rank that improves passively (someone else's reviewed PRs merged away)
    * never cheers you for work you didn't do */
   myCount: number;
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
   login: '',
   stamped: new Set(),
   queue: 0,
   sessionStamps: 0,
   firedMilestones: new Set(),
   seenTurns: new Set(),
   restampKeys: new Set(),
   quickWinsNagged: false,
   favorsSeen: new Set(),
   myRank: 0,
   myCount: 0,
   wasTop: false,
   requestedSeen: new Set(),
   hadBacklog: false,
   authorPrs: new Map(),
   boardQueue: 0,
   staleClaimsSeen: new Set(),
};

/**
 * Flatten a baseline to a JSON-safe shape (Sets → arrays, the Map → entries)
 * so it can ride in sessionStorage. Persisting the baseline is what stops a
 * page reload from re-priming off EMPTY_BASELINE and replaying every load-time
 * greeting (start-here, return-the-favor, the shipped catch-up); a reload
 * instead resumes the diff, so only what genuinely changed while away speaks.
 */
export function serializeBaseline(b: CheerBaseline): unknown {
   return {
      primed: b.primed,
      login: b.login,
      stamped: [...b.stamped],
      queue: b.queue,
      sessionStamps: b.sessionStamps,
      firedMilestones: [...b.firedMilestones],
      seenTurns: [...b.seenTurns],
      restampKeys: [...b.restampKeys],
      quickWinsNagged: b.quickWinsNagged,
      favorsSeen: [...b.favorsSeen],
      myRank: b.myRank,
      myCount: b.myCount,
      wasTop: b.wasTop,
      requestedSeen: [...b.requestedSeen],
      hadBacklog: b.hadBacklog,
      authorPrs: [...b.authorPrs.entries()],
      boardQueue: b.boardQueue,
      staleClaimsSeen: [...b.staleClaimsSeen],
   };
}

/** Rebuild a baseline from serializeBaseline's output. Returns null on anything
 * malformed, so a corrupt or stale-shaped blob just falls back to priming. */
export function reviveBaseline(raw: unknown): CheerBaseline | null {
   if (!raw || typeof raw !== 'object') return null;
   const o = raw as Record<string, unknown>;
   const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
   try {
      return {
         primed: !!o.primed,
         // pre-login-field blobs revive as '' — treated as "unknown, keep",
         // not as a mismatch, so a deploy doesn't re-prime every open tab
         login: typeof o.login === 'string' ? o.login : '',
         stamped: new Set(arr(o.stamped) as string[]),
         queue: Number(o.queue) || 0,
         sessionStamps: Number(o.sessionStamps) || 0,
         firedMilestones: new Set(arr(o.firedMilestones) as number[]),
         seenTurns: new Set(arr(o.seenTurns) as string[]),
         restampKeys: new Set(arr(o.restampKeys) as string[]),
         quickWinsNagged: !!o.quickWinsNagged,
         favorsSeen: new Set(arr(o.favorsSeen) as string[]),
         myRank: Number(o.myRank) || 0,
         myCount: Number(o.myCount) || 0,
         wasTop: !!o.wasTop,
         requestedSeen: new Set(arr(o.requestedSeen) as string[]),
         hadBacklog: !!o.hadBacklog,
         authorPrs: new Map(arr(o.authorPrs) as [string, AuthorPrState][]),
         boardQueue: Number(o.boardQueue) || 0,
         staleClaimsSeen: new Set(arr(o.staleClaimsSeen) as string[]),
      };
   } catch {
      return null;
   }
}

interface CheerInput {
   pulls: DerivedPull[];
   /** whose turn each starved, unclaimed pull is (pull key → login), computed
    * once in app.tsx and shared by the rows, desktop notifications, and these
    * cheers — three surfaces, one rotation read */
   turns: ReadonlyMap<string, string>;
   /** closed pulls in the loaded window, for the leaderboard's tally — optional
    * so older callers still typecheck; an absent window just ranks off the
    * open board. */
   closed?: PullData[];
   me: string;
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
   /** the board's first payload has arrived. `false` means it's still loading
    * (an empty snapshot), and diffing that against a primed baseline would fire
    * a phantom "Board's clear" / "Inbox zero" and count every stamp as newly
    * landed — so evaluateCheers no-ops and carries the baseline until it's true.
    * Defaults to true so tests and older callers evaluate as before. */
   ready?: boolean;
}

/** A duration in ms as the loose phrase the claim-stale nudge shows: "30
 * minutes", "an hour", "2 hours" — matching whatever the viewer set claimWarn
 * to, so the copy never says "a couple hours" for a 30-minute threshold. */
function durationPhrase(ms: number): string {
   const mins = Math.round(ms / 60_000);
   if (mins < 60) return `${mins} minutes`;
   const hours = Math.round(mins / 60);
   return hours === 1 ? 'an hour' : `${hours} hours`;
}

/** A claim you're sitting on stops absolving other reviewers at 2h (see
 * model/actions STALE_CLAIM_SECS); that's the moment worth a nudge to either
 * finish it or hand it back. */
const STALE_CLAIM_MS = STALE_CLAIM_SECS * 1000;

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

/** Has `login` landed an active CR or QA stamp on this pull? Mirrors
 * deal.ts's private helper — duplicated rather than imported so this stays a
 * small, self-contained pure check like the rest of model/. */
function hasStamp(p: DerivedPull, login: string): boolean {
   return p.crBy.includes(login) || p.qaBy.includes(login);
}

/** Whoever's claimed this pull — model/reviewers' one claim predicate. */
const claimOf = (p: DerivedPull) => claimFor(p.data);

/**
 * The one-line "why this pull" for start-here, in priority order: returning a
 * favor beats a quick win beats plain urgency. `pulls` is the whole board (not
 * just the queue) so reciprocity can look across every author the viewer has
 * reviewed, matching deal.ts's own scoring.
 *
 * There's deliberately no "you know this repo" reason: in a monorepo everyone
 * has stamped something in it, so it's both always true and no motivation at
 * all — the reason has to be something specific to *this* pull.
 */
export function startHereReason(
   p: DerivedPull,
   pulls: DerivedPull[],
   me: string,
   superlative = false
): string {
   const author = p.data.user.login;
   const owedByAuthor = pulls.some(o => o.data.user.login === me && hasStamp(o, author));
   if (owedByAuthor) return `${author} reviewed yours, return the favor`;
   const quickWin = p.weight === 'XS' || p.weight === 'S';
   if (quickWin) return `Small one (${p.weight}), quick`;
   const days = Math.max(1, Math.round(p.ageDays));
   return superlative
      ? `Waiting ${days}d, the oldest on your plate`
      : `Waiting ${days}d without a full CR`;
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
   /** pulls you hold a stale (past the claim-warn threshold), still-unreviewed
    * claim on */
   staleClaims: Map<string, DerivedPull>;
   /** the claim-warn threshold as loose words ("an hour"), for the nudge copy */
   staleClaimAfter: string;
   /** pulls GitHub has asked YOU to review (and you haven't yet), for the
    * review-requested toast — the most direct "review this" the board carries */
   requestedOfMe: Map<string, DerivedPull>;
   /** logins holding each rank right now, you excluded, keyed by rank number —
    * the leaderboard neighborhood the overtaken nudge reads to name whoever
    * now sits at the rank you held last tick */
   rankHolders: Map<number, string[]>;
}

function readSignals(input: CheerInput): Signals {
   const { pulls, me } = input;
   const closed = input.closed ?? [];
   const now = input.now ?? Date.now();
   const stamped = new Set<string>();
   const turns = new Map<string, DerivedPull>();
   const byKey = new Map<string, DerivedPull>();
   const restampKeys = new Set<string>();
   let review = 0;
   let qa = 0;

   for (const p of pulls) {
      const key = pullKey(p.data);
      byKey.set(key, p);
      // a stamp on your OWN pull isn't review work you did — don't let a
      // self-tag fire "you reviewed this" (stamp-landed / milestone)
      const mine = hasStamp(p, me) && p.data.user.login !== me;
      if (mine) stamped.add(key);
      const st = actionState(p, me);
      if (st === 'review') review++;
      else if (st === 'qa') qa++;
      else if (st === 'restamp') restampKeys.add(key);
      // a starved BOT pull shouldn't tap you with "your turn — you're the best
      // fit"; bots are handled on their own low-priority cadence, not the rotation
      if (!mine && !isBot(p) && !claimOf(p) && input.turns.get(key) === me) turns.set(key, p);
   }

   const reviewableUnclaimed = pulls.filter(p => actionState(p, me) === 'review' && !claimOf(p));

   const quickWinCandidates = crSort(
      reviewableUnclaimed.filter(p => !isBot(p) && (p.weight === 'XS' || p.weight === 'S'))
   );
   const quickWinPull = quickWinCandidates[0] ?? null;

   // deprioritize bots exactly as Review's Deal-me-one does, so start-here never
   // calls a dependabot bump "the single best pull to review next" — it's only
   // the best when nothing human is left
   const bestStart = dealFrom(dealRank(reviewableUnclaimed, { me, pulls, deprioritize: isBot }), {
      passed: new Set(),
   });
   const startReason = bestStart ? startHereReason(bestStart, pulls, me, true) : '';

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
   // parked pulls sit out the edge system entirely: "ready to merge",
   // "waiting Nd", and "answer the feedback" are all asks, and a parked pull
   // asks nothing — the edges resume when the label comes off
   for (const p of myPulls.filter(x => !x.cryo)) {
      authorPrs.set(pullKey(p.data), {
         green: p.status === 'ready',
         // "someone picked up your PR" means someone ELSE — a self-CR stamp
         // isn't a reviewer showing up
         reviewed: p.crBy.some(l => l !== me),
         conflict: p.conflict,
         starved: p.starved,
         // the flag, not the status: ci_red now only exists once signed off,
         // but the author's "CI failed" nudge should fire mid-review too
         ciRed: p.ci === 'failing',
         needsAnswer: p.status === 'dev_block' || p.changesRequestedBy.length > 0,
      });
   }

   const boardReviewable = pulls.filter(
      p => !p.cryo && (CR_INCOMPLETE.includes(p.status) || p.status === 'needs_qa')
   ).length;

   // claims of yours gone stale that you still haven't stamped — the nudge to
   // either finish the review or release it back to the pool. The threshold is
   // the viewer's claim-warn setting (30m–4h), so the copy has to say the real
   // number, not a hardcoded "a couple hours". A claim with no `at` (metadata
   // not yet backfilled after a server restart) can't be proven stale, so it
   // never nags — same rule model/actions.ts's withCoordination applies.
   const warnMs = input.claimWarnMs ?? STALE_CLAIM_MS;
   const staleClaimAfter = durationPhrase(warnMs);
   const staleClaims = new Map<string, DerivedPull>();
   for (const p of pulls) {
      const key = pullKey(p.data);
      const c = claimOf(p);
      if (c && c.login === me && c.at != null && !hasStamp(p, me) && now - c.at * 1000 > warnMs) {
         staleClaims.set(key, p);
      }
   }

   // GitHub asked you to review these and you haven't stamped them — a direct
   // request, distinct from the rotation's guess (which stays silent on
   // requested pulls). reviewRequestedFrom already excludes a self-claim (see
   // model/reviewers.ts), so a pull you've claimed yourself never lands here.
   // Drives the review-requested toast.
   const requestedOfMe = new Map<string, DerivedPull>();
   for (const p of pulls) {
      const key = pullKey(p.data);
      if (
         !p.cryo &&
         CR_INCOMPLETE.includes(p.status) &&
         reviewRequestedFrom(p, me) &&
         !p.crBy.includes(me)
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
   // who holds each rank right now, so a later tick can name whoever now sits
   // at the rank the viewer held last time (the overtaken nudge); same
   // dense-rank tie caveat as peerBelow, since two logins can share a rank
   const rankHolders = new Map<number, string[]>();
   for (const [login, r] of ranks) {
      if (login === me) continue;
      const holders = rankHolders.get(r.rank) ?? [];
      holders.push(login);
      rankHolders.set(r.rank, holders);
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
      staleClaimAfter,
      requestedOfMe,
      rankHolders,
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
   // still loading — fire nothing and carry the baseline forward, so a primed
   // baseline never diffs against an empty board (the phantom-clear bug)
   if (input.ready === false) return { toasts: [], next: base };
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
   'overtaken',
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
   // Each label matches the toast's own headline so a toast you see maps to
   // an obvious switch — no guessing. Where the headline leads with a count or
   // a name ("5 stamps in view", "Return the favor to alice"), the label is
   // its stable phrase. stamp-landed is the one exception: its headline rotates
   // ("Nice one." / "Keep 'em coming." / "Clean."), so the label names the
   // event and the hint quotes the phrases.
   // Rewards — the good news
   {
      kind: 'stamp-landed',
      group: 'reward',
      label: 'Review landed',
      hint: 'The “Nice one.” / “Keep ’em coming.” cheer when a CR or QA stamp of yours lands.',
   },
   {
      kind: 'milestone',
      group: 'reward',
      label: 'Reviews this sitting',
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
      label: 'Top of the board',
      hint: 'You reach the top of the board’s leaderboard.',
   },
   {
      kind: 'climbing',
      group: 'reward',
      label: 'You’re climbing',
      hint: 'You move up the leaderboard.',
   },
   {
      kind: 'pr-green',
      group: 'reward',
      label: 'Green, ship it',
      hint: 'A PR of yours clears CR and QA, ready to ship.',
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
      label: 'Quick reviews on the board',
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
      label: 'Your turn to review',
      hint: 'You’re the best-matched reviewer for a long-waiting, unclaimed PR.',
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
      label: 'Claimed but still unreviewed',
      hint: 'A review you claimed has sat unreviewed too long.',
   },
   {
      kind: 'overtaken',
      group: 'nudge',
      label: 'Overtaken on the board',
      hint: 'Someone passes you on the leaderboard.',
   },
   // Your PRs — author-side alerts
   {
      kind: 'pr-first-review',
      group: 'author',
      label: 'Someone picked up your PR',
      hint: 'A reviewer started on your PR.',
   },
   {
      kind: 'pr-conflicts',
      group: 'author',
      label: 'Conflicts on your PR',
      hint: 'Your PR needs a rebase.',
   },
   {
      kind: 'pr-ci-red',
      group: 'author',
      label: 'CI failing on your PR',
      hint: 'A required check went red on your PR.',
   },
   {
      kind: 'pr-changes',
      group: 'author',
      label: 'Changes requested on your PR',
      hint: 'A reviewer wants edits on your PR.',
   },
   {
      kind: 'pr-starving',
      group: 'author',
      label: 'Waiting for review',
      hint: 'Your PR has gone a while with no review.',
   },
];

/** Kinds that don't come from diffCheers (so they're outside PRIORITY_ORDER),
 * but are still user-facing toasts that deserve a switch in Settings. The
 * shipped catch-up is fired from the app's `extras` path on load, not the
 * board diff, so it's catalogued here rather than in CHEER_CATALOG. */
export const SHIPPED_TOAST_KIND = 'shipped';
export const EXTRA_TOASTS: {
   kind: string;
   group: CheerGroup;
   label: string;
   hint: string;
}[] = [
   {
      kind: SHIPPED_TOAST_KIND,
      group: 'nudge',
      label: 'Shipped while you were away',
      hint: 'A recap of PRs that merged since your last visit.',
   },
];

/** Everything Settings shows a per-kind toggle for: the board-diff cheers plus
 * the extra load-time toasts. mutedCheers stores whichever of these are off. */
export const CONFIGURABLE_TOASTS = [...CHEER_CATALOG, ...EXTRA_TOASTS];

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
   if (!base.primed || !me || (base.login !== '' && base.login !== me)) {
      const toasts: CheerToast[] = [];
      if (me && sig.bestStart && sig.backlog > 0 && !muted.has('start-here')) {
         toasts.push(startHereToast(sig.bestStart, sig.startReason));
      }
      return {
         toasts,
         next: {
            primed: !!me,
            login: me,
            stamped: sig.stamped,
            queue: sig.queue,
            sessionStamps: 0,
            firedMilestones: new Set(),
            seenTurns: new Set(sig.turns.keys()),
            restampKeys: sig.restampKeys,
            quickWinsNagged: sig.quickWinCount >= QUICK_WIN_THRESHOLD,
            favorsSeen: new Set(),
            myRank: sig.myRank,
            myCount: sig.myCount,
            wasTop: sig.myRank === 1,
            requestedSeen: new Set(sig.requestedOfMe.keys()),
            hadBacklog: sig.backlog > 0,
            authorPrs: sig.authorPrs,
            boardQueue: sig.boardReviewable,
            staleClaimsSeen: new Set(sig.staleClaims.keys()),
         },
      };
   }

   const entries: { toast: CheerToast; kind: ToastKind; undo?: () => void }[] = [];
   // a muted kind is dropped here, before the priority sort and cap — the
   // bookkeeping around each push (session tallies, "already seen" sets) still
   // runs, so unmuting later never replays a backlog. `undo` reverts that
   // bookkeeping when the per-tick cap evicts the toast: an evicted toast is
   // deferred (the same edge re-fires next tick), never silently lost.
   const push = (kind: ToastKind, toast: CheerToast, undo?: () => void) => {
      if (!muted.has(kind)) entries.push({ toast, kind, undo });
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
         push(
            'milestone',
            {
               tone: 'reward',
               icon: '🔥',
               title: 'reviews this sitting',
               count: sessionStamps,
               body: pick(MILESTONE_PRAISE, sessionStamps),
               celebrate: true,
               dedupeKey: `milestone:${m}`,
            },
            () => firedMilestones.delete(m)
         );
      }
   }

   // queue cleared: the hero moment. On eviction the baseline keeps the old
   // queue count, so the >0 → 0 edge is still there to fire next tick.
   let nextQueue = sig.queue;
   if (base.queue > 0 && sig.queue === 0) {
      push(
         'inbox-zero',
         {
            tone: 'reward',
            icon: '🎉',
            title: 'Inbox zero',
            body: "Nothing's waiting on you.",
            celebrate: true,
            shimmer: true,
            dedupeKey: 'inbox:zero',
         },
         () => {
            nextQueue = base.queue;
         }
      );
   }

   // the rotation newly named you on a starved pull. Next tick's seenTurns is
   // just the current turn keys — a pull that stops being yours is forgotten,
   // so if it later comes back around it can nag again.
   const seenTurns = new Set(sig.turns.keys());
   for (const [key, p] of sig.turns) {
      if (base.seenTurns.has(key)) continue;
      push(
         'your-turn',
         {
            tone: 'nag',
            icon: '⏳',
            title: 'Your turn to review',
            body: `Waiting ${Math.max(1, Math.round(p.ageDays))}d with nobody on it; you're the best fit. Claim it?`,
            pull: pullRef(p),
            actionLabel: 'Claim it',
            dedupeKey: `turn:${key}`,
         },
         () => seenTurns.delete(key)
      );
   }

   // review requested: GitHub asked you directly. Fires once per pull (rebuilt
   // from the current tick, seenTurns-style, so a dropped-then-re-added request
   // can nag again). Distinct from your-turn: this is an explicit ask, not the
   // rotation's guess — which is why turnFor stays silent on requested pulls.
   const requestedSeen = new Set(sig.requestedOfMe.keys());
   for (const [key, p] of sig.requestedOfMe) {
      if (base.requestedSeen.has(key)) continue;
      push(
         'review-requested',
         {
            tone: 'info',
            icon: '✦',
            title: 'Review requested',
            body: `${p.data.user.login} asked you to review this.`,
            pull: pullRef(p),
            dedupeKey: `req:${key}`,
         },
         () => requestedSeen.delete(key)
      );
   }

   // start-here: the backlog re-arms after hitting zero (the prime-tick fire
   // is handled above, before this function's main body ever runs).
   let nextHadBacklog = sig.backlog > 0;
   if (!base.hadBacklog && sig.backlog > 0 && sig.bestStart) {
      push('start-here', startHereToast(sig.bestStart, sig.startReason), () => {
         nextHadBacklog = false;
      });
   }

   // re-stamp owed: one toast per pull newly needing another look, replacing
   // the old aggregate "a stamp went stale" nag with something you can act on.
   const restampKeys = new Set(sig.restampKeys);
   const newRestamps: DerivedPull[] = [];
   for (const key of sig.restampKeys) {
      if (base.restampKeys.has(key)) continue;
      const p = sig.byKey.get(key);
      if (p) newRestamps.push(p);
   }
   for (const p of newRestamps.slice(0, MAX_PER_TICK)) {
      const key = pullKey(p.data);
      push(
         're-stamp-owed',
         {
            tone: 'nag',
            icon: '🔁',
            title: 'Changed since your ✓',
            body: 'Give it another look?',
            pull: pullRef(p),
            dedupeKey: `recr:${key}`,
         },
         () => restampKeys.delete(key)
      );
   }
   // restamps past this loop's own slice were never offered at all — leave
   // them unmarked so they get their turn on a later tick
   for (const p of newRestamps.slice(MAX_PER_TICK)) restampKeys.delete(pullKey(p.data));

   // a claim of yours went stale (2h+) and you still haven't stamped it —
   // nudge once per pull to finish it or hand it back. seenTurns-style rebuild
   // from the current tick, so releasing then re-claiming can nag again.
   const staleClaimsSeen = new Set(sig.staleClaims.keys());
   for (const [key, p] of sig.staleClaims) {
      if (base.staleClaimsSeen.has(key)) continue;
      push(
         'claim-stale',
         {
            tone: 'nag',
            icon: '✋',
            title: 'You claimed this, still unreviewed',
            body: `It's been ${sig.staleClaimAfter}. Review it, or release it for someone else.`,
            pull: pullRef(p),
            dedupeKey: `claimstale:${key}`,
         },
         () => staleClaimsSeen.delete(key)
      );
   }

   // quick wins: the pile crossed the threshold going up
   let quickWinsNagged = base.quickWinsNagged;
   if (sig.quickWinCount >= QUICK_WIN_THRESHOLD && !quickWinsNagged) {
      quickWinsNagged = true;
      push(
         'quick-wins',
         {
            tone: 'info',
            icon: '⚡',
            title: `${sig.quickWinCount} quick reviews on the board`,
            body: 'XS/S: small ones, unclaimed.',
            pull: sig.quickWinPull ? pullRef(sig.quickWinPull) : undefined,
            dedupeKey: `quick:${sig.quickWinCount}`,
         },
         () => {
            quickWinsNagged = false;
         }
      );
   } else if (sig.quickWinCount < QUICK_WIN_THRESHOLD) {
      quickWinsNagged = false;
   }

   // return the favor: a debtor's open reviewable pull, nudged once per debtor
   const favorsSeen = new Set(base.favorsSeen);
   for (const { login, pull: p, count } of sig.debtors) {
      if (favorsSeen.has(login)) continue;
      favorsSeen.add(login);
      push(
         'return-the-favor',
         {
            tone: 'info',
            icon: '🤝',
            title: `Return the favor to ${login}`,
            body:
               count === 1
                  ? 'They reviewed one of your PRs.'
                  : `They've reviewed ${count} of your PRs.`,
            pull: pullRef(p),
            dedupeKey: `favor:${login}`,
         },
         () => favorsSeen.delete(login)
      );
   }

   // leaderboard: top and climbing. Evicted edges hold last tick's rank/top
   // state in the baseline so they re-fire while the standing persists.
   let nextWasTop = sig.myRank === 1;
   let nextMyRank = sig.myRank;
   let nextMyCount = sig.myCount;
   if (sig.myRank === 1 && !base.wasTop && sig.myCount > 0) {
      push(
         'top-of-board',
         {
            tone: 'reward',
            icon: '🏆',
            title: 'stamps in view',
            count: sig.myCount,
            body: "Top of the board, nobody's ahead of you.",
            celebrate: true,
            shimmer: true,
            dedupeKey: 'top:1',
         },
         () => {
            nextWasTop = false;
         }
      );
   }
   if (
      base.myRank > 0 &&
      sig.myRank > 0 &&
      sig.myRank < base.myRank &&
      // only cheer a climb you caused: rank also improves passively when
      // other people's reviewed PRs merge and their stamps leave the board,
      // and congratulating you for someone else's merge reads as the cheer
      // firing at random (the owner experienced exactly this)
      sig.myCount > (base.myCount ?? 0) &&
      sig.myRank > 1 &&
      sig.myCount >= 2 &&
      sig.peerBelow
   ) {
      push(
         'climbing',
         {
            tone: 'reward',
            icon: '📈',
            // don't name who you "passed": with dense-rank ties the login one
            // rank below you now may be someone you were already ahead of, not
            // the one you actually overtook this tick — and the baseline
            // doesn't carry the prior full ranking to tell them apart
            title: "You're climbing",
            body: `Now #${sig.myRank} reviewer on the board.`,
            celebrate: true,
            dedupeKey: `rank:${sig.myRank}`,
         },
         () => {
            nextMyRank = base.myRank;
            nextMyCount = base.myCount;
         }
      );
   }
   // the inverse of climbing: your rank got numerically worse (you dropped),
   // and someone identifiable now sits at the rank you held last tick. Same
   // edge-triggered shape as climbing (nextMyRank only advances once the
   // toast survives eviction, so the same drop keeps offering the nudge until
   // it's shown), just naming the person instead of staying anonymous, since
   // rankHolders reads the CURRENT tick's full board rather than guessing
   // from a single peer.
   if (base.myRank > 0 && sig.myRank > 0 && sig.myRank > base.myRank) {
      const holders = [...(sig.rankHolders.get(base.myRank) ?? [])].sort();
      const overtaker = holders[0] ?? null;
      if (overtaker) {
         push(
            'overtaken',
            {
               tone: 'nag',
               icon: '📉',
               title: `${overtaker} took your #${base.myRank} spot`,
               body: `You're #${sig.myRank} on the board now.`,
               dedupeKey: `overtaken:${base.myRank}:${overtaker}`,
            },
            () => {
               nextMyRank = base.myRank;
            }
         );
      }
   }

   // author-side: your own open PRs, watched for edge transitions only — a
   // brand-new key (a PR you just opened) has no baseline entry yet, so it
   // primes silently here rather than firing on however it first appears.
   const nextAuthorPrs = new Map(sig.authorPrs);
   // an evicted author edge writes the OLD flag back into the carried state
   // (reading the map entry fresh, so two undone edges on one pull compose)
   const keepEdge = (key: string, patch: Partial<AuthorPrState>) => {
      const cur = nextAuthorPrs.get(key);
      if (cur) nextAuthorPrs.set(key, { ...cur, ...patch });
   };
   for (const [key, now] of sig.authorPrs) {
      const was = base.authorPrs.get(key);
      if (!was) continue;
      const p = sig.byKey.get(key);
      if (!p) continue;
      if (!was.green && now.green) {
         push(
            'pr-green',
            {
               tone: 'reward',
               icon: '🚀',
               title: 'Green, ship it',
               body: 'CR + QA both cleared.',
               pull: pullRef(p),
               celebrate: true,
               shimmer: true,
               dedupeKey: `green:${key}`,
            },
            () => keepEdge(key, { green: false })
         );
      }
      if (!was.reviewed && now.reviewed) {
         push(
            'pr-first-review',
            {
               tone: 'info',
               icon: '👀',
               title: 'Someone picked up your PR',
               body: `${p.crBy.find(l => l !== p.data.user.login) ?? 'A reviewer'} is on it.`,
               pull: pullRef(p),
               dedupeKey: `firstrev:${key}`,
            },
            () => keepEdge(key, { reviewed: false })
         );
      }
      if (!was.conflict && now.conflict) {
         push(
            'pr-conflicts',
            {
               tone: 'nag',
               icon: '⚠️',
               title: 'Conflicts on your PR',
               body: 'Needs a rebase.',
               pull: pullRef(p),
               dedupeKey: `conflict:${key}`,
            },
            () => keepEdge(key, { conflict: false })
         );
      }
      if (!was.ciRed && now.ciRed) {
         push(
            'pr-ci-red',
            {
               tone: 'nag',
               icon: '🔴',
               title: 'CI failing on your PR',
               body: p.ciFailing?.length ? `Fix ${p.ciFailing.join(', ')}.` : 'Fix the build.',
               pull: pullRef(p),
               dedupeKey: `cired:${key}`,
            },
            () => keepEdge(key, { ciRed: false })
         );
      }
      if (!was.needsAnswer && now.needsAnswer) {
         push(
            'pr-changes',
            {
               tone: 'nag',
               icon: '💬',
               title: 'Changes requested on your PR',
               body: 'A reviewer wants edits, answer the feedback.',
               pull: pullRef(p),
               dedupeKey: `changes:${key}`,
            },
            () => keepEdge(key, { needsAnswer: false })
         );
      }
      if (!was.starved && now.starved) {
         push(
            'pr-starving',
            {
               tone: 'nag',
               icon: '🕰️',
               title: `Waiting ${p.ageDays}d for review`,
               body: 'Your PR, worth a nudge?',
               pull: pullRef(p),
               dedupeKey: `starve:${key}`,
            },
            () => keepEdge(key, { starved: false })
         );
      }
   }

   // board cleared: the whole board's awaiting-review count dropped to zero —
   // board-wide, so this is a rare all-hands moment, not just your queue
   let nextBoardQueue = sig.boardReviewable;
   if (base.boardQueue > 0 && sig.boardReviewable === 0) {
      push(
         'board-cleared',
         {
            tone: 'reward',
            icon: '🎊',
            title: "Board's clear",
            body: 'Nothing waiting on anyone.',
            celebrate: true,
            shimmer: true,
            dedupeKey: 'board:clear',
         },
         () => {
            nextBoardQueue = base.boardQueue;
         }
      );
   }

   const ranked = entries.sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind]);
   // the cap defers, it doesn't discard: whatever it evicts gets its "already
   // seen" bookkeeping undone, so the same edge is still live next tick
   for (const evicted of ranked.slice(MAX_PER_TICK)) evicted.undo?.();
   const toasts = ranked.slice(0, MAX_PER_TICK).map(e => e.toast);

   return {
      toasts,
      next: {
         primed: true,
         login: me,
         stamped: sig.stamped,
         queue: nextQueue,
         sessionStamps,
         firedMilestones,
         seenTurns,
         restampKeys,
         quickWinsNagged,
         favorsSeen,
         myRank: nextMyRank,
         myCount: nextMyCount,
         wasTop: nextWasTop,
         requestedSeen,
         hadBacklog: nextHadBacklog,
         authorPrs: nextAuthorPrs,
         boardQueue: nextBoardQueue,
         staleClaimsSeen,
      },
   };
}
