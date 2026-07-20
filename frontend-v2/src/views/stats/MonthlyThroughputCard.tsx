import type { MonthlyRow } from '../../model/statsHistory';
import { type AxisTick, type PairedPeriod, PairedPeriodColumns, StatsCard } from './parts';

function monthLabel(month: string): string {
   const [y, m] = month.split('-').map(Number);
   return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short' });
}

/**
 * Opened vs merged per month, last 12 months — the Shipping card's window
 * stretched from a fortnight to a year, so a seasonal slowdown or a sustained
 * ramp shows up instead of getting lost in the 14-day frame.
 */
export function MonthlyThroughputCard({ monthly }: { monthly: MonthlyRow[] }) {
   const totalOpened = monthly.reduce((a, m) => a + m.opened, 0);
   const totalMerged = monthly.reduce((a, m) => a + m.merged, 0);
   const periods: PairedPeriod[] = monthly.map(m => ({
      key: m.month,
      title: `${monthLabel(m.month)}: ${m.opened} opened · ${m.merged} merged`,
      a: m.opened,
      b: m.merged,
   }));
   const axisTicks: AxisTick[] = monthly
      .map((m, i) => (i % 3 === 0 ? { index: i, label: monthLabel(m.month) } : null))
      .filter((t): t is AxisTick => t !== null);

   return (
      <StatsCard title="Monthly throughput" sub="opened vs merged, last 12 months">
         <div className="mt-3">
            <PairedPeriodColumns
               periods={periods}
               colorA="var(--ink-3)"
               colorB="var(--ok)"
               axisTicks={axisTicks}
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
