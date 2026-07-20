import { ago } from '../format';
import type { DerivedPull } from './status';

/**
 * The verb column: what moves this pull, and whose move is it? Review's
 * "Yours to do" lane and My work's "Your move" both read from here so the
 * two tabs can never disagree about what you owe.
 */

/** Your move on a pull you authored; null = waiting on someone else. */
export function authorMove(p: DerivedPull): string | null {
   if (p.status === 'ready') return 'Merge it';
   if (p.status === 'ci_red') return 'Fix CI';
   // a dev block is feedback waiting on YOU — v1 lore said "ask them to lift
   // it", which misroutes the most common author action
   if (p.status === 'dev_block') return 'Address feedback';
   if (p.status === 'unmergeable' || p.conflict) return 'Rebase';
   if (p.status === 'needs_qa' && !p.qaingLogin && !p.reqaBy.length) return 'Find a QA-er';
   if (p.status === 'draft') return 'Finish the draft';
   return null;
}

/** Your move on someone else's pull; null = not your job right now. */
export function reviewerMove(p: DerivedPull, me: string): string | null {
   if (p.data.user.login === me) return null;
   if (p.status === 'needs_recr' && p.recrBy.includes(me)) return 'Re-stamp';
   if (p.status === 'needs_qa' && p.qaingLogin === me) return 'Finish QA';
   if (p.status === 'needs_qa' && p.reqaBy.includes(me)) return 'Re-QA';
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
      return v && v !== 'Find a QA-er' && v !== 'Finish the draft' ? v : null;
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
   const pushed = p.headPushedAt ? ` · fix pushed ${ago(p.headPushedAt)} ago` : '';
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
   if ((p.status === 'needs_cr' || p.status === 'needs_recr') && p.changesRequestedBy.length)
      return {
         action: 'Address feedback',
         context: `changes requested by ${who(p.changesRequestedBy)}`,
      };
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

/** The viewer did not author this pull: what they owe, or why they're waiting. */
function reviewerNote(p: DerivedPull, me: string): RowNote {
   const d = p.data;
   const author = d.user.login;
   const who = (logins: string[]) => logins.map(l => (l === me ? 'you' : l)).join(', ');
   const pushed = p.headPushedAt ? ` · fix pushed ${ago(p.headPushedAt)} ago` : '';
   const crReq = d.status.cr_req;
   const qaReq = d.status.qa_req;

   if (p.recrBy.includes(me))
      return {
         action: 'Re-stamp',
         context: p.headPushedAt ? `fix pushed ${ago(p.headPushedAt)} ago` : null,
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
   if ((p.status === 'needs_cr' || p.status === 'needs_recr') && p.changesRequestedBy.length)
      return waitOnly(`changes requested by ${who(p.changesRequestedBy)}`);
   // Adapted from the spec's literal order (see PR/report): an already-active
   // CR stamp earns the reassuring "you've stamped" count instead of the
   // generic "waiting on a re-stamp" line, so this check runs before the
   // plain needs_recr branch below, not after it.
   if ((p.status === 'needs_cr' || p.status === 'needs_recr') && p.crBy.includes(me))
      return waitOnly(`you've stamped · ${p.crHave} of ${crReq}`);
   if (p.status === 'needs_recr') return waitOnly(`waiting on ${who(p.recrBy)}${pushed}`);
   if (p.status === 'needs_cr') {
      const context = p.starved
         ? `unreviewed ${p.ageDays}d`
         : p.crHave > 0
           ? `${p.crHave} of ${crReq} in`
           : p.engagedNoStamp.length
             ? `${who(p.engagedNoStamp)} looking`
             : null;
      return { action: 'Review it', context };
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
   if (note.action === 'Review it') return 'review';
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
 */
export function rowNote(p: DerivedPull, me: string): RowNote {
   const note = p.data.user.login === me ? authorNote(p, me) : reviewerNote(p, me);
   // An external blocker is worth surfacing over a generic wait, but never
   // hides an actual move — a real action always wins.
   if (p.externalBlock && !note.action) return waitOnly('on hold — external blocker');
   return note;
}
