import { ago } from '../../../shared/format';
import { claimFor } from './reviewers';
import { authorOwnsIt, feedbackAnswered, parked } from '../../../shared/model/stage';
import { CR_INCOMPLETE, unique, type DerivedPull } from '../../../shared/model/status';
import { isSuffixBot } from '../../../shared/model/visibility';

// these three live in the shared model, so the project flags (which the
// server builds too) read the same rules the board does
export { authorOwnsIt, feedbackAnswered, parked };

/**
 * The verb column: what moves this pull, and whose move is it? Review's
 * "Waiting on you" lane and My work's "Your move" both read from here so the
 * two tabs can never disagree about what you owe.
 *
 * The self-review policy (shared/model/status.ts ownReview): a developer CRs
 * and QAs their own pull unless they ask for a review, so an unrequested
 * pull's stamps are its author's move and nobody else owes it anything. Only
 * a pull that needs someone else (a review asked of people, one a reviewer
 * took on, one from outside the dev team) is anyone else's review work.
 */

/** The author reviews it themselves. A bot is never a developer, whatever
 * the roster says (with no roster derive counts everyone, bots included). */
export const selfReviewed = (p: DerivedPull): boolean =>
   !!p.ownReview && !isSuffixBot(p.data.user.login);

/** who the author's side asked to review it (people and team members),
 * read as [] off a pull derived before the policy existed */
export const askedOf = (p: DerivedPull): string[] => p.askedOf ?? [];

/** Requests are answered in hours: past this, the author's move is a nudge. */
export const ASK_OVERDUE_HOURS = 4;

/** Whole hours since the review request, or null when there's none or it
 * can't be dated. */
export function askedHours(p: DerivedPull, now = Date.now() / 1000): number | null {
   return p.askedAt == null ? null : Math.max(0, Math.floor((now - p.askedAt) / 3600));
}

/** "asked 3h ago", "asked just now"; null when the request can't be dated */
export function askedAgo(p: DerivedPull, now?: number): string | null {
   const h = askedHours(p, now);
   if (h == null) return null;
   return h < 1 ? 'asked just now' : `asked ${h}h ago`;
}

/** A request nobody has answered past ASK_OVERDUE_HOURS. */
export const askOverdue = (p: DerivedPull, now?: number): boolean =>
   (askedHours(p, now) ?? 0) >= ASK_OVERDUE_HOURS;

/**
 * Whether this pull is `me`'s review work: asked of me (by name or through a
 * team), or one I said I'd review; otherwise one that needs someone else and
 * that nobody was asked for or took on (an author outside the dev team, or a
 * team request naming nobody on the roster). Never my own, and never a
 * developer's own unrequested pull: its review is its author's.
 */
export function reviewIsMine(p: DerivedPull, me: string): boolean {
   if (p.data.user.login === me) return false;
   const claim = claimFor(p.data);
   if (claim?.login === me) return true;
   const asked = askedOf(p);
   if (asked.length) return asked.includes(me);
   if (claim) return false;
   return !selfReviewed(p);
}

const INPUT_HINT_WORDS: Record<string, string> = {
   ci: 'CI',
   migrations: 'migrations',
   alerting: 'alerting',
   'agent-docs': 'agent docs',
   deploy: 'deploy config',
   dependencies: 'dependencies',
};

/** "a", "a and b", "a, b and c" */
const andList = (words: string[]) =>
   words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;

/**
 * The quiet hint on your own self-reviewed pull whose diff touches what
 * usually deserves team input (input_hints, from the changed paths): "touches
 * CI and migrations · worth asking for review?". Null once a review is
 * asked for, once CR is in, or with nothing to say.
 */
export function askForInputHint(p: DerivedPull): string | null {
   if (!selfReviewed(p) || parked(p) || p.crHave >= p.data.status.cr_req) return null;
   const areas = unique((p.data.input_hints ?? []).map(h => INPUT_HINT_WORDS[h] ?? h));
   return areas.length ? `touches ${andList(areas)} · worth asking for review?` : null;
}

/** The author's move to chase a request gone past ASK_OVERDUE_HOURS. */
const nudgeMove = (asked: string[]) => `Nudge ${asked.length === 1 ? asked[0] : 'reviewers'}`;

/** Your move on a pull you authored; null = waiting on someone else. Only ever
 * called for the viewer's own pulls, so the author IS the viewer here. The
 * same order authorNote weighs, without its context. */
export function authorMove(p: DerivedPull): string | null {
   return parked(p) ? null : authorNote(p, p.data.user.login).action;
}

/** Your move on someone else's pull; null = not your job right now. The QA
 * obligations are NOT gated on status === 'needs_qa': QA runs in parallel with
 * CR on this board (see Review.tsx's qaPool), so a push that invalidates both
 * your QA and someone's CR at once lands the pull at needs_recr while still
 * owing you a re-QA — and rowNote/actionState already surface it, so "Yours to
 * do" must too, or the card shows "Re-QA" while the lane silently drops it.
 * The one gate is authorOwnsIt: a draft / dev-blocked / red-CI pull asks
 * reviewers for nothing until the author's move lands. */
export function reviewerMove(p: DerivedPull, me: string): string | null {
   if (p.data.user.login === me) return null;
   if (parked(p) || authorOwnsIt(p)) return null;
   if (p.recrBy.includes(me)) return 'Re-stamp';
   if (p.qaingLogin === me) return 'Finish QA';
   if (p.reqaBy.includes(me)) return 'Re-QA';
   return null;
}

/**
 * The subset of moves worth a desktop nudge: a real transition that just
 * landed on you: your PR is mergeable / broke CI / got feedback / needs a
 * rebase, a re-CR/re-QA fell to you, or someone asked you for a review.
 * Excludes standing conditions on your own pull (your own stamp to give, a
 * draft, a block you put on yourself, a request gone quiet): nothing landed
 * on you there. Returns the action label, or null.
 */
export function alertMove(p: DerivedPull, me: string): string | null {
   if (p.data.user.login === me) {
      const v = authorMove(p);
      return v && ['Merge it', 'Fix CI', 'Address feedback', 'Rebase'].includes(v) ? v : null;
   }
   const v = reviewerMove(p, me);
   if (v === 'Re-stamp' || v === 'Re-QA') return v;
   return askedOf(p).includes(me) && rowNote(p, me).action === 'Review it' ? 'Review it' : null;
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

/**
 * Mirrors components/bits.tsx STATUS_LABEL. Duplicated rather than imported:
 * the model layer doesn't depend on components, and this is only the
 * defensive last resort below — the matrix above is meant to cover every
 * Status, so this should never actually be read.
 */
const FALLBACK_STATUS_LABEL: Record<DerivedPull['status'], string> = {
   ready: 'ready to merge',
   ci_pending: 'waiting on CI',
   needs_recr: 'needs re-CR',
   needs_qa: 'needs QA',
   needs_cr: 'needs CR',
   dev_block: 'dev blocked',
   deploy_block: 'deploy block',
   unmergeable: 'can’t merge',
   ci_red: 'CI failing',
   draft: 'draft',
};

/** The viewer authored this pull: what they owe, in priority order. */
function authorNote(p: DerivedPull, me: string): RowNote {
   const d = p.data;
   const who = (logins: string[]) => logins.map(l => (l === me ? 'you' : l)).join(', ');
   const pushed = p.headPushedAt ? ` · last commit ${ago(p.headPushedAt)} ago` : '';
   const crReq = d.status.cr_req;

   if (p.status === 'draft') return doOnly('Undraft');
   // flag, not just status: red CI mid-review still names the author's move
   if (p.status === 'ci_red' || p.ci === 'failing')
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
   if (CR_INCOMPLETE.includes(p.status) && p.changesRequestedBy.length) {
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
   const reviewing = p.status === 'needs_cr' || p.status === 'needs_recr';
   if (!reviewing && p.status !== 'needs_qa') {
      if (p.status === 'ci_pending') return waitOnly('merge when it goes green');
      if (p.status === 'deploy_block')
         return waitOnly(`ask ${who(p.deployBlockedBy)} before deploy`);
      return waitOnly(FALLBACK_STATUS_LABEL[p.status]);
   }

   // your own stamp went stale on a push: under self-review it's yours to
   // give again, whoever else is asked
   if ((reviewing && p.recrBy.includes(me)) || (!reviewing && p.reqaBy.includes(me)))
      return { action: 'Re-stamp', context: 'new commits since your stamp' };
   if (p.status === 'needs_cr') {
      // any reviewer with an unstamped verdict (CHANGES_REQUESTED already
      // handled above) has left something the author owes an answer to.
      // DISMISSED is excluded — a dismissed review no longer stands, so it
      // owes no answer. Bots are excluded too: the wire's unstamped_reviewers
      // carries every reviewer, and the CI review bot COMMENTs on most PRs.
      const reviewerLogins = unique(
         (d.status.unstamped_reviewers ?? [])
            .filter(r => r.state !== 'DISMISSED' && !isSuffixBot(r.login))
            .map(r => r.login)
      );
      if (reviewerLogins.length)
         return { action: 'Answer the review', context: `from ${who(reviewerLogins)}` };
   }
   if (p.status === 'needs_qa' && p.qaingLogin)
      return waitOnly(`${who([p.qaingLogin])} is testing it`);
   // you asked for a review: theirs to give, answered in hours
   const asked = askedOf(p);
   if (asked.length) {
      const when = askedAgo(p);
      if (askOverdue(p))
         return { action: nudgeMove(asked), context: `asked ${who(asked)} ${askedHours(p)}h ago` };
      return waitOnly(`waiting on ${who(asked)}${when ? ` · ${when}` : ''}`);
   }
   const claim = claimFor(d);
   if (claim) return waitOnly(`${claim.login} is reviewing it`);
   if (selfReviewed(p))
      return reviewing
         ? { action: 'Stamp CR', context: 'review it yourself, or request a review' }
         : { action: 'Stamp QA', context: 'test it yourself, or request a review' };
   // outside the dev team: someone else reviews it, nobody's been asked yet
   if (p.status === 'needs_recr')
      return waitOnly(`waiting on ${who(p.recrBy)} to re-stamp${pushed}`);
   if (p.status === 'needs_qa')
      return waitOnly(
         p.reqaBy.length ? `new commits undid ${who(p.reqaBy)}'s QA` : 'waiting on a tester'
      );
   if (p.engagedNoStamp.length) return waitOnly(`in discussion with ${who(p.engagedNoStamp)}`);
   return waitOnly(
      p.crHave > 0 ? `waiting on a review · ${p.crHave} of ${crReq}` : 'waiting on a review'
   );
}

/** A reviewer's claim on a pull: who, and when (epoch seconds — see
 * types.ts's review_requests). `at` is null when the server can't say yet
 * (e.g. it restarted before the webhook backfilled the timestamp). */
export interface Claim {
   login: string;
   at: number | null;
}

/** When an unfinished claim of yours starts reading as stale (the default for
 * the claim-warn nag, and the "claimed it 3h ago" wording elsewhere). */
export const STALE_CLAIM_SECS = 2 * 3600;

/** The viewer did not author this pull: what they owe, or why they're waiting. */
function reviewerNote(p: DerivedPull, me: string, extra?: { claim?: Claim | null }): RowNote {
   const d = p.data;
   const author = d.user.login;
   const who = (logins: string[]) => logins.map(l => (l === me ? 'you' : l)).join(', ');
   const pushed = p.headPushedAt ? ` · last commit ${ago(p.headPushedAt)} ago` : '';
   const crReq = d.status.cr_req;
   const qaReq = d.status.qa_req;
   const asked = askedOf(p);
   const when = askedAgo(p);
   const claim = extra?.claim !== undefined ? extra.claim : claimFor(d);

   // your personal obligations — but only once the pull is reviewable: while
   // the author owns it (draft / dev block / red CI, the statuses below that
   // return early anyway) a stale stamp asks nothing of you yet, or "Re-stamp"
   // would nag you about a head the author is still about to replace
   if (!authorOwnsIt(p)) {
      if (p.recrBy.includes(me))
         return {
            action: 'Re-stamp',
            context: p.headPushedAt ? `last commit ${ago(p.headPushedAt)} ago` : null,
         };
      if (p.qaingLogin === me) return doOnly('Finish QA');
      if (p.reqaBy.includes(me)) return doOnly('Re-QA');
   }

   if (p.status === 'draft') return waitOnly('draft, not reviewable yet');
   if (p.status === 'ci_red') return waitOnly('CI failing · author fixes');
   if (p.status === 'dev_block')
      return waitOnly(
         p.devBlockedBy.includes(me)
            ? 'your block stands; lift it when ready'
            : `feedback from ${who(p.devBlockedBy)}`
      );
   if (CR_INCOMPLETE.includes(p.status) && p.changesRequestedBy.length) {
      // the author has pushed past the review: the requester's move now is to
      // re-review (an action for them, a wait for everyone else)
      if (feedbackAnswered(p)) {
         if (p.changesRequestedBy.includes(me))
            return { action: 'Re-review', context: `you asked for changes${pushed}` };
         return waitOnly(`waiting on ${who(p.changesRequestedBy)} to re-review${pushed}`);
      }
      return waitOnly(`changes requested by ${who(p.changesRequestedBy)}`);
   }
   // an already-active CR stamp earns the reassuring "you've stamped" count
   // instead of the generic wait, so this runs before the review branches
   if (CR_INCOMPLETE.includes(p.status) && p.crBy.includes(me))
      return waitOnly(`you've stamped · ${p.crHave} of ${crReq}`);
   if (p.status === 'needs_qa') {
      if (p.qaBy.includes(me)) return waitOnly(`you've QA'd · ${p.qaHave} of ${qaReq}`);
      if (p.qaingLogin) return waitOnly(`${who([p.qaingLogin])} is testing it`);
   }

   const reviewing = p.status === 'needs_cr' || p.status === 'needs_recr';
   if (reviewing || p.status === 'needs_qa') {
      if (claim?.login === me) {
         const since = claim.at != null ? ` · ${ago(claim.at)} ago` : '';
         return { action: 'Finish your review', context: `you said you’d review it${since}` };
      }
      if (asked.includes(me))
         return { action: reviewing ? 'Review it' : 'QA it', context: when ?? 'review requested' };
      if (claim) return waitOnly(`${claim.login} is reviewing it`);
      if (p.status === 'needs_recr') return waitOnly(`waiting on ${who(p.recrBy)}${pushed}`);
      if (asked.length) return waitOnly(`waiting on ${who(asked)}${when ? ` · ${when}` : ''}`);
      // the author reviews their own: nobody else owes it anything
      if (selfReviewed(p)) return waitOnly('in self-review');
      // needs someone else and nobody's on it: an author outside the dev
      // team, or a request to a team nobody on the roster is in
      if (p.status === 'needs_qa')
         return { action: 'QA it', context: p.qaHave > 0 ? `${p.qaHave} of ${qaReq} in` : null };
      const context = p.starved
         ? `waiting ${p.ageDays}d`
         : p.crHave > 0
         ? `${p.crHave} of ${crReq} in`
         : p.engagedNoStamp.length
         ? `${who(p.engagedNoStamp)} looking`
         : null;
      return { action: 'Review it', context };
   }
   if (p.status === 'deploy_block') return waitOnly(`ask ${who(p.deployBlockedBy)} first`);
   if (p.status === 'unmergeable')
      return waitOnly(p.conflict ? 'conflicts · author rebases' : 'lands with its parent');
   if (p.status === 'ci_pending') return waitOnly('all stamps in, waiting on green');
   if (p.status === 'ready') return waitOnly(`ready · ${author} merges it`);

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
   // keyed off the note's action, not raw recrBy/reqaBy, so the bucket can
   // never disagree with the word on the card: a stale stamp on a pull the
   // author still owns (authorOwnsIt) isn't a re-stamp yet, and a re-tester
   // who holds the QAing label reads "Finish QA", which is `mine`
   const note = rowNote(p, me);
   if (note.action === 'Re-stamp' || note.action === 'Re-QA') return 'restamp';
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
 * `extra.claim` overrides the pull's own claim (claimFor) for the
 * reviewer-side note; callers normally leave it out.
 */
export function rowNote(p: DerivedPull, me: string, extra?: { claim?: Claim | null }): RowNote {
   // parked outranks everything, the author's own moves included: a shelved
   // pull is a wait for everyone until the label comes off
   if (parked(p)) return waitOnly('parked, kept open on purpose');
   const note = p.data.user.login === me ? authorNote(p, me) : reviewerNote(p, me, extra);
   // An external blocker is worth surfacing over a generic wait, but never
   // hides an actual move — a real action always wins. On your OWN pull the
   // hold itself is the thing to unstick (chase the dependency, lift the tag),
   // so it reads as a move, not a shrug.
   if (p.externalBlock && !note.action) {
      if (p.data.user.login === me)
         return { action: 'Unblock', context: 'on hold, external blocker' };
      return waitOnly('on hold, external blocker');
   }
   return note;
}

/** The one-word grouping key a card sorts under. */
export type RowWord = { kind: 'do' | 'wait'; word: string };

/** rowNote's action string → the one-word label its section header shows.
 * Falls back to the action string itself so a future action never renders
 * blank — but every string rowNote can produce today is listed here, the
 * author's "Nudge {name}" by its prefix (see rowWord). */
export const DO_WORD: Record<string, string> = {
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
   'Stamp CR': 'Stamp CR',
   'Stamp QA': 'Stamp QA',
   'Review it': 'Review',
   'QA it': 'QA',
   Undraft: 'Undraft',
};

/**
 * The wait-side word, computed straight from the pull's own facts rather than
 * parsed from rowNote's context — free text is for a human to read, not for a
 * grouping decision to key off. The branch order mirrors reviewerNote/
 * authorNote: changes-requested outranks your own stamp, and a claim only
 * absolves a viewer with no stake of their own in the pull. Who was asked
 * stays in the context ("waiting on bob · asked 3h ago"): one word per
 * name would split a lane into a header per person.
 */
export function waitWord(p: DerivedPull, me: string, extra?: { claim?: Claim | null }): string {
   if (parked(p)) return 'parked';
   if (p.externalBlock) return 'on hold';
   const isAuthor = p.data.user.login === me;
   const claim = extra?.claim !== undefined ? extra.claim : claimFor(p.data);
   // who it waits on, once nobody's specifically owed a stamp by you
   const holder = () => {
      if (claim && claim.login !== me) return 'claimed';
      if (askedOf(p).length) return 'review requested';
      if (selfReviewed(p)) return 'self-review';
      return null;
   };
   switch (p.status) {
      case 'draft':
         return 'draft';
      case 'ci_red':
         return 'CI failing';
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
         if (isAuthor && p.reqaBy.length && !askedOf(p).length) return 'waiting on re-QA';
         return holder() ?? 'waiting on QA';
      case 'needs_recr':
         if (p.crBy.includes(me)) return 'stamped';
         return holder() ?? 'waiting on re-CR';
      case 'needs_cr':
         if (p.changesRequestedBy.length)
            return feedbackAnswered(p) ? 'waiting on re-CR' : 'with author';
         if (p.crBy.includes(me)) return 'stamped';
         return holder() ?? 'waiting on CR';
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
export function rowWord(p: DerivedPull, me: string, extra?: { claim?: Claim | null }): RowWord {
   const note = rowNote(p, me, extra);
   if (note.action == null) return { kind: 'wait', word: waitWord(p, me, extra) };
   if (note.action.startsWith('Nudge ')) return { kind: 'do', word: 'Nudge' };
   return { kind: 'do', word: DO_WORD[note.action] ?? note.action };
}

/** Most-urgent-first order for the 'do' word groups. A review someone asked
 * of you leads: the policy measures answering one in hours. */
export const DO_WORD_RANK: readonly string[] = [
   'Review',
   'QA',
   'Re-stamp',
   'Re-QA',
   'Finish QA',
   'Finish CR',
   'Re-review',
   'Merge',
   'Fix CI',
   'Respond',
   'Stamp CR',
   'Stamp QA',
   'Nudge',
   'Unblock',
   'Rebase',
   'Undraft',
];

/** Most-urgent-first order for the 'wait' word groups. */
export const WAIT_WORD_RANK: readonly string[] = [
   'review requested',
   'waiting on re-CR',
   'waiting on CR',
   'with author',
   'waiting on re-QA',
   'waiting on QA',
   'in QA',
   'claimed',
   'self-review',
   'stamped',
   'CI running',
   'CI failing',
   'blocked',
   'deploy hold',
   'conflicts',
   'stacked',
   'on hold',
   'parked',
   'ready',
   'draft',
   'waiting',
];
