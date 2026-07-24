import type { CommitStatus } from '../types';
import { headStatuses, type DerivedPull } from './status';

/**
 * The CI lens's model: the board re-keyed by check instead of by pull. One
 * pass over every pull's head statuses builds a per-check ledger — who's
 * failing it, how many runs are green or still going, and how long a run
 * takes — so the view can answer "what's broken, by which check" and "how
 * healthy is each check" without re-walking pulls per section.
 */

const isRedCheck = (s: CommitStatus) => s.data.state === 'failure' || s.data.state === 'error';

export interface CheckLedger {
   context: string;
   /** pulls whose head run of this check is red, oldest first */
   failing: DerivedPull[];
   running: number;
   passing: number;
   /** every pull whose head carries this check */
   total: number;
   /** mean run time across completed runs with both timestamps, in seconds */
   avgSecs: number | null;
}

/**
 * Every check context across the pool, worst first: most failing pulls, then
 * most coverage, then name — so the band reads as a triage list, not an
 * alphabet. A pull contributes once per context (headStatuses is already one
 * entry per context at the head sha).
 */
export function checkLedgers(pulls: DerivedPull[]): CheckLedger[] {
   const by = new Map<
      string,
      { failing: DerivedPull[]; running: number; passing: number; total: number; durs: number[] }
   >();
   for (const p of pulls) {
      for (const s of headStatuses(p.data)) {
         const ctx = s.data.context;
         let entry = by.get(ctx);
         if (!entry) {
            entry = { failing: [], running: 0, passing: 0, total: 0, durs: [] };
            by.set(ctx, entry);
         }
         entry.total++;
         if (isRedCheck(s)) entry.failing.push(p);
         else if (s.data.state === 'pending') entry.running++;
         else entry.passing++;
         const { started_at, completed_at } = s.data;
         if (started_at != null && completed_at != null && completed_at >= started_at)
            entry.durs.push(completed_at - started_at);
      }
   }
   return [...by.entries()]
      .map(([context, e]) => ({
         context,
         failing: [...e.failing].sort((a, b) => b.ageDays - a.ageDays),
         running: e.running,
         passing: e.passing,
         total: e.total,
         avgSecs: e.durs.length ? e.durs.reduce((sum, d) => sum + d, 0) / e.durs.length : null,
      }))
      .sort(
         (a, b) =>
            b.failing.length - a.failing.length ||
            b.total - a.total ||
            a.context.localeCompare(b.context)
      );
}

/** completed − started as a terse "45s"/"6m", the CI popover's own format. */
export function ciSecsWord(secs: number): string {
   return secs < 60 ? `${Math.round(secs)}s` : `${Math.round(secs / 60)}m`;
}
