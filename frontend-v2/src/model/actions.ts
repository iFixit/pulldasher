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

/** 'do' = your move (brand, bold imperative); 'wait' = context on someone else's move. */
export interface RowNote {
   text: string;
   tone: 'do' | 'wait';
}

const doNote = (text: string): RowNote => ({ text, tone: 'do' });
const waitNote = (text: string): RowNote => ({ text, tone: 'wait' });
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

   if (p.status === 'draft') return doNote('Finish the draft');
   if (p.status === 'ci_red')
      return doNote(p.ciFailing.length ? `Fix CI · ${p.ciFailing.join(', ')}` : 'Fix CI');
   // a dev block is feedback waiting on YOU — v1 lore said "ask them to lift
   // it", which misroutes the most common author action
   if (p.status === 'dev_block') return doNote(`Address ${who(p.devBlockedBy)}'s feedback`);
   if ((p.status === 'needs_cr' || p.status === 'needs_recr') && p.changesRequestedBy.length)
      return doNote(`Address ${who(p.changesRequestedBy)}'s feedback`);
   // A conflict masks whatever CR/QA state the pull is otherwise in — the
   // author's real next move is always the rebase, checked before (and
   // independent of) the status-driven branches below.
   if (p.conflict) return doNote(`Rebase${p.crHave < crReq ? ' · CR still needed' : ''}`);
   if (p.status === 'unmergeable' && p.dependent) return waitNote('lands with its parent');
   if (p.status === 'ready') return doNote('Merge it');
   if (p.status === 'needs_qa') {
      if (!p.qaingLogin && !p.reqaBy.length) return doNote('Find a QA-er');
      if (p.qaingLogin) return waitNote(`${who([p.qaingLogin])} is testing it`);
      if (p.reqaBy.length) return waitNote(`${who(p.reqaBy)}'s QA fell to a push`);
   }
   if (p.status === 'needs_recr')
      return waitNote(`waiting on ${who(p.recrBy)} to re-stamp${pushed}`);
   if (p.status === 'needs_cr') {
      // any reviewer with an unstamped verdict (CHANGES_REQUESTED already
      // handled above) has left something the author owes an answer to
      const reviewerLogins = unique((d.status.unstamped_reviewers ?? []).map(r => r.login));
      if (reviewerLogins.length) return doNote(`Answer ${who(reviewerLogins)}'s review`);
      if (p.engagedNoStamp.length) return waitNote(`in discussion with ${who(p.engagedNoStamp)}`);
      if (p.starved) return doNote(`Chase a review · unreviewed ${p.ageDays}d`);
      return waitNote(
         p.crHave > 0 ? `in the CR queue · ${p.crHave} of ${crReq}` : 'in the CR queue'
      );
   }
   if (p.status === 'ci_pending') return waitNote('CI running — then merge');
   if (p.status === 'deploy_block') return waitNote(`ask ${who(p.deployBlockedBy)} before deploy`);

   return waitNote(FALLBACK_STATUS_LABEL[p.status]);
}

/** The viewer did not author this pull: what they owe, or why they're waiting. */
function reviewerNote(p: DerivedPull, me: string): RowNote {
   const d = p.data;
   const author = d.user.login;
   const who = (logins: string[]) => logins.map(l => (l === me ? 'you' : l)).join(', ');
   const pushed = p.headPushedAt ? ` · fix pushed ${ago(p.headPushedAt)} ago` : '';
   const crReq = d.status.cr_req;
   const qaReq = d.status.qa_req;

   if (p.recrBy.includes(me)) return doNote(`Re-stamp${pushed}`);
   if (p.qaingLogin === me) return doNote('Finish QA');
   if (p.reqaBy.includes(me)) return doNote('Re-QA');

   if (p.status === 'draft') return waitNote('draft — not reviewable yet');
   if (p.status === 'ci_red') return waitNote('CI red · author fixes');
   if (p.status === 'dev_block')
      return waitNote(
         p.devBlockedBy.includes(me)
            ? 'your block stands — lift when happy'
            : `feedback from ${who(p.devBlockedBy)}`
      );
   if ((p.status === 'needs_cr' || p.status === 'needs_recr') && p.changesRequestedBy.length)
      return waitNote(`changes requested by ${who(p.changesRequestedBy)}`);
   // Adapted from the spec's literal order (see PR/report): an already-active
   // CR stamp earns the reassuring "you've stamped" count instead of the
   // generic "waiting on a re-stamp" line, so this check runs before the
   // plain needs_recr branch below, not after it.
   if ((p.status === 'needs_cr' || p.status === 'needs_recr') && p.crBy.includes(me))
      return waitNote(`you've stamped · ${p.crHave} of ${crReq}`);
   if (p.status === 'needs_recr') return waitNote(`waiting on ${who(p.recrBy)}${pushed}`);
   if (p.status === 'needs_cr') {
      let qualifier = '';
      if (p.starved) qualifier = ` · unreviewed ${p.ageDays}d`;
      else if (p.crHave > 0) qualifier = ` · ${p.crHave} of ${crReq} in`;
      else if (p.engagedNoStamp.length) qualifier = ` · ${who(p.engagedNoStamp)} looking`;
      return doNote(`Review it${qualifier}`);
   }
   if (p.status === 'needs_qa') {
      if (p.qaBy.includes(me)) return waitNote(`you've QA'd · ${p.qaHave} of ${qaReq}`);
      if (p.qaingLogin) return waitNote(`${who([p.qaingLogin])} is testing it`);
      return doNote(`QA it${p.qaHave > 0 ? ` · ${p.qaHave} of ${qaReq} in` : ''}`);
   }
   if (p.status === 'deploy_block') return waitNote(`ask ${who(p.deployBlockedBy)} first`);
   if (p.status === 'unmergeable')
      return waitNote(p.conflict ? 'conflicts · author rebases' : 'lands with its parent');
   if (p.status === 'ci_pending') return waitNote('only CI left');
   if (p.status === 'ready') return waitNote(`ready · nudge ${author} if it sits`);

   return waitNote(FALLBACK_STATUS_LABEL[p.status]);
}

/**
 * The one context line every row renders, in every lens: the imperative when
 * it's your move, enriched with the when/which detail the badge can't carry;
 * otherwise a terse who/when/why for whoever's move it is. Never blank for an
 * open pull — closed/merged rows are receipts and don't call this. It never
 * restates the status badge — "Needs QA" the badge already says; this line
 * adds "alice is QAing", not "needs a QA stamp".
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
   // hides an actual move — a 'do' nudge always wins.
   if (p.externalBlock && note.tone !== 'do') return waitNote('on hold — external blocker');
   return note;
}
