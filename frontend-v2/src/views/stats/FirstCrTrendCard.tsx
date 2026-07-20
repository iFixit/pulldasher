import { humanHours } from '../../model/stats';
import type { FirstCrMonthRow } from '../../model/statsHistory';
import { type AxisTick, PeriodColumns, StatsCard } from './parts';

function monthLabel(month: string): string {
   const [y, m] = month.split('-').map(Number);
   return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short' });
}

/**
 * Monthly first-CR latency, last 12 months. Complements the Shipping card's
 * 14-day "first CR in … median" figure: that one is the live window, this is
 * whether responsiveness is drifting over the year.
 */
export function FirstCrTrendCard({ months }: { months: FirstCrMonthRow[] }) {
   const sampled = months.reduce((a, m) => a + m.sampled, 0);
   const periods = months.map(m => ({
      key: m.month,
      title: `${monthLabel(m.month)}: median ${humanHours(m.medianHours)} · avg ${humanHours(m.avgHours)} · ${m.sampled} sampled`,
      value: m.medianHours,
   }));
   const axisTicks: AxisTick[] = months
      .map((m, i) => (i % 3 === 0 ? { index: i, label: monthLabel(m.month) } : null))
      .filter((t): t is AxisTick => t !== null);

   return (
      <StatsCard title="First CR trend" sub="median hours to first CR, last 12 months">
         {sampled === 0 ? (
            <div className="mt-3 text-[13px] text-ink-3">No CR'd merges in this window.</div>
         ) : (
            <div className="mt-3">
               <PeriodColumns periods={periods} color="var(--violet)" axisTicks={axisTicks} />
            </div>
         )}
         <div className="mt-3 text-[13px] text-ink-3">
            live window: the Shipping card above · trend: here
         </div>
      </StatsCard>
   );
}
