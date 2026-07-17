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
