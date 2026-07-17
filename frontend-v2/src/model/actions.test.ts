import { describe, expect, it } from 'vitest';
import type { DerivedPull, Status } from './status';
import { alertMove } from './actions';

/** A DerivedPull with only the fields the move functions read. */
function dp(o: {
   author?: string;
   status: Status;
   conflict?: boolean;
   qaingBy?: string | null;
   reqaBy?: string[];
   recrBy?: string[];
}): DerivedPull {
   return {
      data: { user: { login: o.author ?? 'author' } },
      status: o.status,
      conflict: o.conflict ?? false,
      qaingBy: o.qaingBy ?? null,
      reqaBy: o.reqaBy ?? [],
      recrBy: o.recrBy ?? [],
   } as unknown as DerivedPull;
}

describe('alertMove — which transitions earn a desktop nudge', () => {
   it('alerts the author on real transitions to their own PR', () => {
      expect(alertMove(dp({ author: 'me', status: 'ready' }), 'me')).toBe('Merge it');
      expect(alertMove(dp({ author: 'me', status: 'ci_red' }), 'me')).toBe('Fix CI');
      expect(alertMove(dp({ author: 'me', status: 'dev_block' }), 'me')).toBe('Address feedback');
      expect(alertMove(dp({ author: 'me', status: 'unmergeable' }), 'me')).toBe('Rebase');
   });

   it('does not alert on self-initiated / standing states', () => {
      // "Find a QA-er" and "Finish the draft" are conditions, not events
      expect(alertMove(dp({ author: 'me', status: 'needs_qa' }), 'me')).toBeNull();
      expect(alertMove(dp({ author: 'me', status: 'draft' }), 'me')).toBeNull();
   });

   it('alerts a reviewer only for re-CR / re-QA that fell to them', () => {
      expect(alertMove(dp({ author: 'a', status: 'needs_recr', recrBy: ['me'] }), 'me')).toBe(
         'Re-stamp'
      );
      expect(alertMove(dp({ author: 'a', status: 'needs_qa', reqaBy: ['me'] }), 'me')).toBe(
         'Re-QA'
      );
      // claiming QA yourself is not an incoming event
      expect(alertMove(dp({ author: 'a', status: 'needs_qa', qaingBy: 'me' }), 'me')).toBeNull();
      // a fresh needs-CR isn't owed by anyone in particular
      expect(alertMove(dp({ author: 'a', status: 'needs_cr' }), 'me')).toBeNull();
   });

   it('does not alert on a PR you neither own nor owe a stamp on', () => {
      expect(alertMove(dp({ author: 'other', status: 'ready' }), 'me')).toBeNull();
      expect(
         alertMove(dp({ author: 'other', status: 'needs_recr', recrBy: ['x'] }), 'me')
      ).toBeNull();
   });
});
