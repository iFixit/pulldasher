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
   if (p.status === 'needs_qa' && !p.qaingBy && !p.reqaBy.length) return 'Find a QA-er';
   if (p.status === 'draft') return 'Finish the draft';
   return null;
}

/** Your move on someone else's pull; null = not your job right now. */
export function reviewerMove(p: DerivedPull, me: string): string | null {
   if (p.data.user.login === me) return null;
   if (p.status === 'needs_recr' && p.recrBy.includes(me)) return 'Re-stamp';
   if (p.status === 'needs_qa' && p.qaingBy === me) return 'Finish QA';
   if (p.status === 'needs_qa' && p.reqaBy.includes(me)) return 'Re-QA';
   return null;
}

/** 'do' = your move (brand, bold imperative); 'wait' = context on someone else's move. */
export interface RowNote {
   text: string;
   tone: 'do' | 'wait';
}

/**
 * The one context line every row renders, in every lens: the imperative when
 * it's your move (the verb from authorMove/reviewerMove, enriched with the
 * when/which detail the badge can't carry), otherwise a terse who/when/why for
 * whoever's move it is. It never restates the status badge — "Needs QA" the
 * badge already says; this line adds "alice is QAing", not "needs a QA stamp".
 *
 * Source-agnostic on purpose: a CR, a re-stamp, or a dev block is the same
 * whether it came from a `CR`/`dev_block` comment tag or a GitHub review, so
 * the wording never says "requested changes" or "approved".
 */
export function rowNote(p: DerivedPull, me: string): RowNote | null {
   const d = p.data;
   const who = (logins: string[]) => logins.map(l => (l === me ? 'you' : l)).join(', ');
   const pushed = p.headPushedAt ? ` · fix pushed ${ago(p.headPushedAt)} ago` : '';

   const verb = d.user.login === me ? authorMove(p) : reviewerMove(p, me);
   if (verb) {
      if (verb === 'Re-stamp') return { text: `Re-stamp${pushed}`, tone: 'do' };
      if (verb === 'Fix CI' && p.ciFailing.length)
         return { text: `Fix CI: ${p.ciFailing.join(', ')}`, tone: 'do' };
      return { text: verb, tone: 'do' };
   }

   // the badge already names the state; a wait note only adds who/when/why and
   // must not echo the badge's words ("re-stamp", "dev-blocked", "QA")
   const wait = (text: string): RowNote => ({ text, tone: 'wait' });
   switch (p.status) {
      case 'needs_recr':
         return p.recrBy.length ? wait(`waiting on ${who(p.recrBy)}${pushed}`) : null;
      case 'needs_qa':
         if (p.qaingBy) return wait(`${who([p.qaingBy])} is testing it`);
         if (p.reqaBy.length) return wait(`${who(p.reqaBy)}’s QA fell to a push`);
         return null;
      case 'needs_cr':
         if (p.crHave > 0) return wait(`${p.crHave} of ${d.status.cr_req} CRs`);
         return p.starved ? wait(`unreviewed for ${p.ageDays}d`) : null;
      case 'ci_red':
         return p.ciFailing.length ? wait(`${p.ciFailing.join(', ')}`) : null;
      case 'dev_block':
         return p.devBlockedBy.length ? wait(`feedback from ${who(p.devBlockedBy)}`) : null;
      case 'deploy_block':
         return p.deployBlockedBy.length ? wait(`ask ${who(p.deployBlockedBy)} first`) : null;
      case 'unmergeable':
         return wait(p.conflict ? 'conflicts, author rebases' : 'lands with its parent');
      default:
         return null;
   }
}
