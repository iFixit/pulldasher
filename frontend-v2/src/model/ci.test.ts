import { describe, expect, it } from 'vitest';
import type { DerivedPull } from '../../../shared/model/status';
import type { StatusState } from '../../../shared/types';
import { checkLedgers, ciSecsWord } from '../../../shared/model/ci';

/** A DerivedPull with only the fields checkLedgers reads: head statuses and
 * ageDays (for the failing-order tie inside a ledger). */
function dp(o: {
   number?: number;
   ageDays?: number;
   checks?: {
      context: string;
      state: StatusState;
      started?: number | null;
      completed?: number | null;
   }[];
}): DerivedPull {
   return {
      data: {
         repo: 'org/repo',
         number: o.number ?? 1,
         head: { sha: 'abc' },
         status: {
            commit_statuses: (o.checks ?? []).map(c => ({
               data: {
                  sha: 'abc',
                  context: c.context,
                  state: c.state,
                  started_at: c.started ?? null,
                  completed_at: c.completed ?? null,
                  target_url: null,
                  description: '',
               },
            })),
         },
      },
      ageDays: o.ageDays ?? 1,
   } as unknown as DerivedPull;
}

describe('checkLedgers', () => {
   it('buckets every head check by context with per-state counts', () => {
      const ledgers = checkLedgers([
         dp({ number: 1, checks: [{ context: 'lint', state: 'success' }] }),
         dp({ number: 2, checks: [{ context: 'lint', state: 'failure' }] }),
         dp({ number: 3, checks: [{ context: 'lint', state: 'pending' }] }),
      ]);
      expect(ledgers).toHaveLength(1);
      const lint = ledgers[0];
      expect(lint.context).toBe('lint');
      expect(lint.total).toBe(3);
      expect(lint.passing).toBe(1);
      expect(lint.running).toBe(1);
      expect(lint.failing.map(p => p.data.number)).toEqual([2]);
   });

   it('orders ledgers worst first: failing count, then coverage, then name', () => {
      const ledgers = checkLedgers([
         dp({ number: 1, checks: [{ context: 'b-wide', state: 'success' }] }),
         dp({ number: 2, checks: [{ context: 'b-wide', state: 'success' }] }),
         dp({ number: 3, checks: [{ context: 'a-thin', state: 'success' }] }),
         dp({ number: 4, checks: [{ context: 'broken', state: 'failure' }] }),
      ]);
      expect(ledgers.map(l => l.context)).toEqual(['broken', 'b-wide', 'a-thin']);
   });

   it('orders a ledger’s failing pulls oldest first and treats error as red', () => {
      const ledgers = checkLedgers([
         dp({ number: 1, ageDays: 2, checks: [{ context: 'e2e', state: 'failure' }] }),
         dp({ number: 2, ageDays: 9, checks: [{ context: 'e2e', state: 'error' }] }),
      ]);
      expect(ledgers[0].failing.map(p => p.data.number)).toEqual([2, 1]);
   });

   it('averages run time only over runs with both timestamps', () => {
      const [lint] = checkLedgers([
         dp({
            number: 1,
            checks: [{ context: 'lint', state: 'success', started: 100, completed: 160 }],
         }),
         dp({
            number: 2,
            checks: [{ context: 'lint', state: 'success', started: 100, completed: 220 }],
         }),
         dp({ number: 3, checks: [{ context: 'lint', state: 'pending', started: 100 }] }),
      ]);
      expect(lint.avgSecs).toBe(90);
   });

   it('reports no average when no run has finished', () => {
      const [e2e] = checkLedgers([
         dp({ number: 1, checks: [{ context: 'e2e', state: 'pending', started: 100 }] }),
      ]);
      expect(e2e.avgSecs).toBeNull();
   });
});

describe('ciSecsWord', () => {
   it('reads seconds under a minute, minutes above', () => {
      expect(ciSecsWord(45)).toBe('45s');
      expect(ciSecsWord(360)).toBe('6m');
   });
});
