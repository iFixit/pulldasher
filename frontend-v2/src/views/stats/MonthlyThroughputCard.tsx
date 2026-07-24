import type { MonthlyRow } from '../../model/statsHistory';
import { type AxisTick, LineChart, StatsCard } from './parts';

function monthLabel(month: string): string {
   const [y, m] = month.split('-').map(Number);
   return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short' });
}

/**
 * Opened vs merged per month, last 12 months — the Shipping card's window
 * stretched from a fortnight to a year, so a seasonal slowdown or a sustained
 * ramp shows up instead of getting lost in the 14-day frame. The shaded area
 * between the two lines is the delta itself: opened above merged means the
 * backlog grew that stretch, merged above opened means it shrank.
 */
export function MonthlyThroughputCard({ monthly }: { monthly: MonthlyRow[] }) {
   const totalOpened = monthly.reduce((a, m) => a + m.opened, 0);
   const totalMerged = monthly.reduce((a, m) => a + m.merged, 0);
   const axisTicks: AxisTick[] = monthly
      .map((m, i) => (i % 3 === 0 ? { index: i, label: monthLabel(m.month) } : null))
      .filter((t): t is AxisTick => t !== null);

   return (
      <StatsCard title="Monthly volume" sub="opened vs merged, last 12 months">
         <div className="mt-3">
            <LineChart
               ariaLabel="Pull requests opened and merged per month, last 12 months, with the gap between them shaded"
               series={[
                  { label: 'opened', color: 'var(--ink-3)', values: monthly.map(m => m.opened) },
                  { label: 'merged', color: 'var(--ok)', values: monthly.map(m => m.merged) },
               ]}
               band={{ a: 0, b: 1, color: 'var(--brand)' }}
               axisTicks={axisTicks}
               pointLabels={monthly.map(m => monthLabel(m.month))}
            />
         </div>
         <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13px] text-ink-2">
            <span>
               <b className="font-semibold text-ink tabular-nums">{totalOpened}</b> opened
            </span>
            <span>
               <b className="font-semibold text-ink tabular-nums">{totalMerged}</b> merged
            </span>
         </div>
      </StatsCard>
   );
}
