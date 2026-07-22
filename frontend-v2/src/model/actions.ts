import { ago } from '../format';
import { requestedReviewers } from './reviewers';
import type { DerivedPull } from './status';

/**
 * The verb column: what moves this pull, and whose move is it? Review's
 * "Yours to do" lane and My work's "Your move" both read from here so the
 * two tabs can never disagree about what you owe.
 */

/** Your move on a pull you authored; null = waiting on someone else. Only ever
 * called for the viewer's own pulls, so the author IS the viewer here. */
export function authorMove(p: DerivedPull): string | null {
   if (p.status === 'ready') return 'Merge it';
   if (p.status === 'ci_red') return 'Fix CI';
   // a dev block is feedback waiting on YOU — v1 lore said "ask them to lift
   // it", which misroutes the most common author action. But a block you put
   // on your own PR (self-flagged "hold off") isn't feedback to answer — the
   // move is lifting it, so mirror authorNote's self-only-blocker case rather
   // than telling you to "Address feedback" from yourself.
   if (p.status === 'dev_block') {
      const others = p.devBlockedBy.filter(l => l !== p.data.user.login);
      return others.length ? 'Address feedback' : 'Lift your block';
   }
   if (p.status === 'unmergeable' || p.conflict) return 'Rebase';
   if (p.status === 'needs_qa' && !p.qaingLogin && !p.reqaBy.length) return 'Find a QA-er';
   if (p.status === 'draft') return 'Finish the draft';
   return null;
}

/** Your move on someone else's pull; null = not your job right now. The QA
 * obligations are NOT gated on status === 'needs_qa': QA runs in parallel with
 * CR on this board (see Review.tsx's qaPool), so a push that invalidates both
 * your QA and someone's CR at once lands the pull at needs_recr while still
 * owing you a re-QA — and rowNote/actionState already surface it, so "Yours to
 * do" must too, or the card shows "Re-QA" while the lane silently drops it. */
export function reviewerMove(p: DerivedPull, me: string): string | null {
   if (p.data.user.login === me) return null;
   if (p.recrBy.includes(me)) return 'Re-stamp';
   if (p.qaingLogin === me) return 'Finish QA';
   if (p.reqaBy.includes(me)) return 'Re-QA';
   return null;
}

/**
 * The subset of moves worth a desktop nudge: a real transition that just
 * landed on you — your PR is mergeable / broke CI / got feedback / needs a
 * rebase, or a re-CR/re-QA fell to you. Excludes self-initiated states
 * (claiming QA, still drafting) and "go find someone" states, which aren't
 * events so much as standing conditions. Returns the action label, or null.
 */
export function alertMove(p: DerivedPull, me: string): string | null {
   if (p.data.user.login === me) {
      const v = authorMove(p);
      // 'Lift your block' is a block you put on yourself — a standing choice,
      // not an event that landed on you, so it earns no desktop nudge (same as
      // 'Find a QA-er' / 'Finish the draft')
      const standing = v === 'Find a QA-er' || v === 'Finish the draft' || v === 'Lift your block';
      return v && !standing ? v : null;
   }
   const v = reviewerMove(p, me);
   return v === 'Re-stamp' || v === 'Re-QA' ? v : null;
}

/**
 * action = the viewer's imperative move, rendered as a `.badge-do` pill right
 * after the status badge ("what to do"). context = the state detail anyone
 * can read, rendered muted after the diff chip ("who/when/why") — sometimes
 * behind a feedback popover. Either slot may be null, but for an open pull at
 * least one is always non-null (see the fallback in rowNote below).
 */
export interface RowNote {
   action: string | null;
   context: string | null;
}

const doOnly = (action: string): RowNote => ({ action, context: null });
const waitOnly = (context: string): RowNote => ({ action: null, context });
const unique = (xs: string[]): string[] => [...new Set(xs)];

/**
 * Mirrors components/bits.tsx STATUS_LABEL. Duplicated rather than imported:
 * the model layer doesn't depend on components, and this is only the
 * defensive last resort below — the matrix above is meant to cover every
 * Status, so this should never actually be read.
 */
const FALLBACK_STATUS_LABEL: Record<DerivedPull['status'], string> = {
   ready: 'ready to merge',
   ci_pending: 'only CI left',
   needs_recr: 'needs re-CR',
   needs_qa: 'needs QA',
   needs_cr: 'needs CR',
   dev_block: 'dev blocked',
   deploy_block: 'deploy block',
   unmergeable: 'can’t merge',
   ci_red: 'CI red',
   draft: 'draft',
};

/** The viewer authored this pull: what they owe, in priority order. */
function authorNote(p: DerivedPull, me: string): RowNote {
   const d = p.data;
   const who = (logins: string[]) => logins.map(l => (l === me ? 'you' : l)).join(', ');
   const pushed = p.headPushedAt ? ` · last commit ${ago(p.headPushedAt)} ago` : '';
   const crReq = d.status.cr_req;

   if (p.status === 'draft') return doOnly('Finish the draft');
   if (p.status === 'ci_red')
      return { action: 'Fix CI', context: p.ciFailing.length ? p.ciFailing.join(', ') : null };
   // a dev block is feedback waiting on YOU — v1 lore said "ask them to lift
   // it", which misroutes the most common author action. But when you're the
   // only blocker, "from you" reads as nonsense ("Address feedback · from
   // you") — the real move is lifting your own block, not answering it, so
   // that case gets its own action. A mix of you and others still owes an
   // answer to the others; who() drops you from that list so the context
   // doesn't also claim you're waiting on yourself.
   if (p.status === 'dev_block') {
      const otherBlockers = p.devBlockedBy.filter(l => l !== me);
      if (!otherBlockers.length) return doOnly('Lift your block');
      return { action: 'Address feedback', context: `from ${who(otherBlockers)}` };
   }
   if ((p.status === 'needs_cr' || p.status === 'needs_recr') && p.changesRequestedBy.length) {
      // ball-tracking: once you've pushed past the review, the move is theirs
      if (feedbackAnswered(p))
         return waitOnly(`waiting on ${who(p.changesRequestedBy)} to re-review${pushed}`);
      return {
         action: 'Address feedback',
         context: `changes requested by ${who(p.changesRequestedBy)}`,
      };
   }
   // A conflict masks whatever CR/QA state the pull is otherwise in — the
   // author's real next move is always the rebase, checked before (and
   // independent of) the status-driven branches below.
   if (p.conflict)
      return { action: 'Rebase', context: p.crHave < crReq ? 'CR still needed' : null };
   if (p.status === 'unmergeable' && p.dependent) return waitOnly('lands with its parent');
   if (p.status === 'ready') return doOnly('Merge it');
   if (p.status === 'needs_qa') {
      if (!p.qaingLogin && !p.reqaBy.length) return doOnly('Find a QA-er');
      if (p.qaingLogin) return waitOnly(`${who([p.qaingLogin])} is testing it`);
      if (p.reqaBy.length) return waitOnly(`${who(p.reqaBy)}'s QA fell to a push`);
   }
   if (p.status === 'needs_recr')
      return waitOnly(`waiting on ${who(p.recrBy)} to re-stamp${pushed}`);
   if (p.status === 'needs_cr') {
      // any reviewer with an unstamped verdict (CHANGES_REQUESTED already
      // handled above) has left something the author owes an answer to
      const reviewerLogins = unique((d.status.unstamped_reviewers ?? []).map(r => r.login));
      if (reviewerLogins.length)
         return { action: 'Answer the review', context: `from ${who(reviewerLogins)}` };
      if (p.engagedNoStamp.length) return waitOnly(`in discussion with ${who(p.engagedNoStamp)}`);
      if (p.starved) return { action: 'Chase a review', context: `unreviewed ${p.ageDays}d` };
      return waitOnly(
         p.crHave > 0 ? `in the CR queue · ${p.crHave} of ${crReq}` : 'in the CR queue'
      );
   }
   if (p.status === 'ci_pending') return waitOnly('CI running — then merge');
   if (p.status === 'deploy_block') return waitOnly(`ask ${who(p.deployBlockedBy)} before deploy`);

   return waitOnly(FALLBACK_STATUS_LABEL[p.status]);
}

/** Epoch secs of the newest still-standing changes-requested review, or null
 * when none of the unstamped reviews carries that verdict (or the wire didn't
 * send them). */
function lastChangesRequestedAt(p: DerivedPull): number | null {
   const dates = (p.data.status.unstamped_reviewers ?? [])
      .filter(r => r.state === 'CHANGES_REQUESTED')
      .map(r => r.date);
   return dates.length ? Math.max(...dates) : null;
}

/**
 * The author pushed AFTER the newest changes-requested review: the ball is
 * back with the reviewer, so "Address feedback" would nag the author about
 * work they already did — the truthful note is "waiting on X to re-review"
 * (and, for the reviewer who asked, an actionable "Re-review"). False when
 * the review can't be dated: nagging beats wrongly absolving.
 */
function feedbackAnswered(p: DerivedPull): boolean {
   const at = lastChangesRequestedAt(p);
   return at != null && p.headPushedAt != null && p.headPushedAt > at;
}

/** A reviewer's claim on a pull: who, and when (ms epoch — see
 * backend/socket.ts's ReviewClaims). */
export interface Claim {
   login: string;
   at: number;
}

/** A claim older than this no longer absolves anyone else — the reader may
 * have wandered off, so the pull goes back on the market. */
const STALE_CLAIM_SECS = 2 * 3600;

/**
 * Layers claim/turn coordination onto a base needs_cr/needs_recr note — the
 * note an uninvolved reviewer would see (no stamp of their own, nothing
 * specifically owed by them). A claim always wins over a turn: someone
 * actively reading it is a stronger signal than the rotation's guess, and a
 * fresh claim by someone else absolves the viewer entirely (action null) —
 * but a claim past STALE_CLAIM_SECS stops absolving, since the reader may
 * have moved on, and the pull's "Review it" action comes back.
 */
function withCoordination(
   base: RowNote,
   me: string,
   claim?: Claim | null,
   turn?: string | null,
   requestedFromMe?: boolean
): RowNote {
   if (claim) {
      const claimAgo = ago(claim.at / 1000);
      if (claim.login === me)
         return { action: 'Finish your review', context: `you claimed it · ${claimAgo} ago` };
      const staleSecs = Date.now() / 1000 - claim.at / 1000;
      if (staleSecs > STALE_CLAIM_SECS)
         return {
            action: 'Review it',
            context: `${claim.login} claimed it ${claimAgo} ago — pick it up?`,
         };
      return { action: null, context: `${claim.login} is reading it` };
   }
   // An explicit GitHub review request beats the rotation guess: it's a direct
   // ask, so it always earns the "Review it" pill (and turnFor already stays
   // silent on requested pulls, so `turn` is null here anyway).
   if (requestedFromMe)
      return {
         action: 'Review it',
         context: base.context ? `requested from you · ${base.context}` : 'requested from you',
      };
   if (turn === me)
      return {
         action: 'Review it',
         context: base.context ? `your turn · ${base.context}` : 'your turn',
      };
   if (turn)
      return {
         action: base.action,
         context: base.context ? `${base.context} · ${turn}'s turn` : `${turn}'s turn`,
      };
   return base;
}

/** The viewer did not author this pull: what they owe, or why they're waiting. */
function reviewerNote(
   p: DerivedPull,
   me: string,
   extra?: { claim?: Claim | null; turn?: string | null }
): RowNote {
   const d = p.data;
   const author = d.user.login;
   const who = (logins: string[]) => logins.map(l => (l === me ? 'you' : l)).join(', ');
   const pushed = p.headPushedAt ? ` · last commit ${ago(p.headPushedAt)} ago` : '';
   const crReq = d.status.cr_req;
   const qaReq = d.status.qa_req;
   // GitHub review requests: an ask aimed at you drives the note (via
   // withCoordination below); one aimed at someone else is still worth naming
   // as context, so an uninvolved reader sees who owns it.
   const requested = requestedReviewers(p);
   const requestedFromMe = requested.includes(me);
   const requestedOthers = requested.filter(l => l !== me);

   if (p.recrBy.includes(me))
      return {
         action: 'Re-stamp',
         context: p.headPushedAt ? `last commit ${ago(p.headPushedAt)} ago` : null,
      };
   if (p.qaingLogin === me) return doOnly('Finish QA');
   if (p.reqaBy.includes(me)) return doOnly('Re-QA');

   if (p.status === 'draft') return waitOnly('draft — not reviewable yet');
   if (p.status === 'ci_red') return waitOnly('CI red · author fixes');
   if (p.status === 'dev_block')
      return waitOnly(
         p.devBlockedBy.includes(me)
            ? 'your block stands — lift when happy'
            : `feedback from ${who(p.devBlockedBy)}`
      );
   if ((p.status === 'needs_cr' || p.status === 'needs_recr') && p.changesRequestedBy.length) {
      // the author has pushed past the review: the requester's move now is to
      // re-review (an action for them, a wait for everyone else)
      if (feedbackAnswered(p)) {
         if (p.changesRequestedBy.includes(me))
            return { action: 'Re-review', context: `you asked for changes${pushed}` };
         return waitOnly(`waiting on ${who(p.changesRequestedBy)} to re-review${pushed}`);
      }
      return waitOnly(`changes requested by ${who(p.changesRequestedBy)}`);
   }
   // Adapted from the spec's literal order (see PR/report): an already-active
   // CR stamp earns the reassuring "you've stamped" count instead of the
   // generic "waiting on a re-stamp" line, so this check runs before the
   // plain needs_recr branch below, not after it.
   if ((p.status === 'needs_cr' || p.status === 'needs_recr') && p.crBy.includes(me))
      return waitOnly(`you've stamped · ${p.crHave} of ${crReq}`);
   if (p.status === 'needs_recr')
      return withCoordination(
         waitOnly(`waiting on ${who(p.recrBy)}${pushed}`),
         me,
         extra?.claim,
         extra?.turn,
         requestedFromMe
      );
   if (p.status === 'needs_cr') {
      const context = p.starved
         ? `unreviewed ${p.ageDays}d`
         : p.crHave > 0
           ? `${p.crHave} of ${crReq} in`
           : requestedOthers.length
             ? `requested from ${who(requestedOthers)}`
             : p.engagedNoStamp.length
               ? `${who(p.engagedNoStamp)} looking`
               : null;
      return withCoordination(
         { action: 'Review it', context },
         me,
         extra?.claim,
         extra?.turn,
         requestedFromMe
      );
   }
   if (p.status === 'needs_qa') {
      if (p.qaBy.includes(me)) return waitOnly(`you've QA'd · ${p.qaHave} of ${qaReq}`);
      if (p.qaingLogin) return waitOnly(`${who([p.qaingLogin])} is testing it`);
      return { action: 'QA it', context: p.qaHave > 0 ? `${p.qaHave} of ${qaReq} in` : null };
   }
   if (p.status === 'deploy_block') return waitOnly(`ask ${who(p.deployBlockedBy)} first`);
   if (p.status === 'unmergeable')
      return waitOnly(p.conflict ? 'conflicts · author rebases' : 'lands with its parent');
   if (p.status === 'ci_pending') return waitOnly('only CI left');
   if (p.status === 'ready') return waitOnly(`ready · nudge ${author} if it sits`);

   return waitOnly(FALLBACK_STATUS_LABEL[p.status]);
}

/**
 * The viewer-relative bucket a pull sits in right now: the same six-way split
 * the State filter dropdown and its live counts are built from. One bucket
 * per (pull, viewer) — mutually exclusive, checked in priority order so a
 * pull never counts toward two buckets at once.
 *
 * Blocked here is viewer-relative — a dev-block YOU authored carries action
 * "Address feedback" so it lands in `mine`, deliberately diverging from the
 * viewer-agnostic `is:blocked` query token (which matches dev_block/
 * deploy_block for anyone, author included).
 */
export type ActionStateKey = 'restamp' | 'review' | 'qa' | 'mine' | 'blocked' | 'waiting';

export function actionState(p: DerivedPull, me: string): ActionStateKey {
   if (p.recrBy.includes(me) || p.reqaBy.includes(me)) return 'restamp';
   const note = rowNote(p, me);
   if (note.action === 'Review it' || note.action === 'Re-review') return 'review';
   if (note.action === 'QA it') return 'qa';
   if (note.action != null) return 'mine';
   if (p.status === 'dev_block' || p.status === 'deploy_block') return 'blocked';
   return 'waiting';
}

/**
 * The two-slot note every row renders, in every lens: `action` is the
 * imperative when it's your move (a `.badge-do` pill next to the status
 * badge); `context` is the terse who/when/why detail the badge can't carry,
 * shown for anyone regardless of whose move it is. Never both-null for an
 * open pull — closed/merged rows are receipts and don't call this. `context`
 * never restates the status badge — "Needs QA" the badge already says;
 * context adds "alice is QAing", not "needs a QA stamp".
 *
 * Source-agnostic on purpose: a CR, a re-stamp, or a dev block is the same
 * whether it came from a `CR`/`dev_block` comment tag or a GitHub review, so
 * the wording never says "requested changes" or "approved".
 *
 * Deliberately independent of authorMove/reviewerMove: those two back
 * alertMove's narrow desktop-notification filter and must keep behaving
 * exactly as before, so this rewrite duplicates rather than reuses their
 * (much narrower) checks.
 *
 * `extra` is optional and reviewer-side only (see withCoordination): a claim
 * or a rotation turn on a needs_cr/needs_recr pull layers on top of the base
 * note for anyone not already specifically implicated (no stamp, nothing
 * owed). Existing two-arg callers (query.ts's `has:action`, the popover)
 * keep reading the base note, unaware of claims/turns — that's fine, they
 * don't need the coordination detail.
 */
export function rowNote(
   p: DerivedPull,
   me: string,
   extra?: { claim?: Claim | null; turn?: string | null }
): RowNote {
   const note = p.data.user.login === me ? authorNote(p, me) : reviewerNote(p, me, extra);
   // An external blocker is worth surfacing over a generic wait, but never
   // hides an actual move — a real action always wins. On your OWN pull the
   // hold itself is the thing to unstick (chase the dependency, lift the tag),
   // so it reads as a move, not a shrug.
   if (p.externalBlock && !note.action) {
      if (p.data.user.login === me)
         return { action: 'Unblock', context: 'on hold — external blocker' };
      return waitOnly('on hold — external blocker');
   }
   return note;
}

/** The one-word grouping key a card sorts under. */
export type RowWord = { kind: 'do' | 'wait'; word: string };

/** rowNote's action string → the one-word label its section header shows.
 * Falls back to the action string itself so a future action never renders
 * blank — but every string rowNote can produce today is listed here. */
const DO_WORD: Record<string, string> = {
   'Re-stamp': 'Re-stamp',
   'Re-QA': 'Re-QA',
   'Finish QA': 'Finish QA',
   'Finish your review': 'Finish CR',
   'Re-review': 'Re-review',
   'Merge it': 'Merge',
   'Fix CI': 'Fix CI',
   'Address feedback': 'Respond',
   'Answer the review': 'Respond',
   'Lift your block': 'Unblock',
   Unblock: 'Unblock',
   Rebase: 'Rebase',
   'Chase a review': 'Chase CR',
   'Find a QA-er': 'Find QA-er',
   'Review it': 'Review',
   'QA it': 'QA',
   'Finish the draft': 'Finish draft',
};

/** Same freshness rule withCoordination uses for a claim by someone else — but
 * here it decides a single word (claimed vs. still-owed), not the fuller
 * action/context pair, so it's reimplemented rather than shared. */
function freshOtherClaim(me: string, claim?: Claim | null): boolean {
   if (!claim || claim.login === me) return false;
   return Date.now() / 1000 - claim.at / 1000 <= STALE_CLAIM_SECS;
}

/**
 * The wait-side word, computed straight from the pull's own facts rather than
 * parsed from rowNote's context — free text is for a human to read, not for a
 * grouping decision to key off. The branch order deliberately mirrors
 * reviewerNote/authorNote: changes-requested outranks your own stamp, and a
 * claim only absolves a viewer with no stake of their own in the pull.
 */
function waitWord(p: DerivedPull, me: string, extra?: { claim?: Claim | null }): string {
   if (p.externalBlock) return 'on hold';
   const isAuthor = p.data.user.login === me;
   switch (p.status) {
      case 'draft':
         return 'draft';
      case 'ci_red':
         return 'CI red';
      case 'dev_block':
         return 'blocked';
      case 'deploy_block':
         return 'deploy hold';
      case 'unmergeable':
         return p.conflict ? 'conflicts' : 'stacked';
      case 'ci_pending':
         return 'CI running';
      case 'ready':
         return 'ready';
      case 'needs_qa':
         if (p.qaBy.includes(me)) return 'stamped';
         if (p.qaingLogin) return 'in QA';
         if (isAuthor && p.reqaBy.length) return 'awaiting re-QA';
         return 'awaiting QA';
      case 'needs_recr':
         if (p.crBy.includes(me)) return 'stamped';
         if (freshOtherClaim(me, extra?.claim)) return 'claimed';
         return 'awaiting re-CR';
      case 'needs_cr':
         if (p.changesRequestedBy.length)
            return feedbackAnswered(p) ? 'awaiting re-CR' : 'with author';
         if (p.crBy.includes(me)) return 'stamped';
         if (freshOtherClaim(me, extra?.claim)) return 'claimed';
         return 'awaiting CR';
      default:
         return 'waiting';
   }
}

/**
 * The one word a card is grouped under — a section header, coarse on
 * purpose. Names, ages, and counts stay in the state popover; this only
 * answers "which pile does this card belong in?" Built on top of rowNote:
 * a non-null action is always the viewer's move (kind 'do'), mapped through
 * DO_WORD; otherwise the pull is waiting on someone else, and the word comes
 * from a case analysis on the pull's own facts (see waitWord) rather than
 * from parsing rowNote's context string, which is free text meant for a
 * human, not a stable key to group on.
 */
export function rowWord(
   p: DerivedPull,
   me: string,
   extra?: { claim?: Claim | null; turn?: string | null }
): RowWord {
   const note = rowNote(p, me, extra);
   if (note.action != null) return { kind: 'do', word: DO_WORD[note.action] ?? note.action };
   return { kind: 'wait', word: waitWord(p, me, extra) };
}

/** Most-urgent-first order for the 'do' word groups. */
export const DO_WORD_RANK: readonly string[] = [
   'Re-stamp',
   'Re-QA',
   'Finish QA',
   'Finish CR',
   'Re-review',
   'Merge',
   'Fix CI',
   'Respond',
   'Unblock',
   'Rebase',
   'Chase CR',
   'Find QA-er',
   'Review',
   'QA',
   'Finish draft',
];

/** Most-urgent-first order for the 'wait' word groups. */
export const WAIT_WORD_RANK: readonly string[] = [
   'awaiting re-CR',
   'awaiting CR',
   'with author',
   'awaiting re-QA',
   'awaiting QA',
   'in QA',
   'claimed',
   'stamped',
   'CI running',
   'CI red',
   'blocked',
   'deploy hold',
   'conflicts',
   'stacked',
   'on hold',
   'ready',
   'draft',
   'waiting',
];
