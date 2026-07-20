import { humanHours } from '../../model/stats';
import type { DurationWeekRow } from '../../model/statsHistory';
import { type AxisTick, PeriodColumns, StatsCard } from './parts';

/**
 * Average PR duration (open→merge) per ISO week, last 26 weeks — the
 * merge-time-by-size card's twin over time instead of over diff size.
 */
export function WeeklyDurationCard({ weeks }: { weeks: DurationWeekRow[] }) {
   const merged = weeks.reduce((a, w) => a + w.merged, 0);
   const withData = weeks.filter(w => w.merged > 0);
   const overallAvg = withData.length
      ? withData.reduce((a, w) => a + w.avgHours, 0) / withData.length
      : 0;
   const periods = weeks.map(w => ({
      key: w.isoWeek,
      title: `${w.isoWeek}: avg ${humanHours(w.avgHours)} · ${w.merged} merged`,
      value: w.avgHours,
   }));
   const axisTicks: AxisTick[] = weeks
      .map((w, i) => (i % 4 === 0 ? { index: i, label: w.isoWeek.replace(/^\d+-/, '') } : null))
      .filter((t): t is AxisTick => t !== null);

   return (
      <StatsCard title="PR duration by week" sub="avg open→merge, last 26 weeks">
         <div className="mt-3">
            <PeriodColumns periods={periods} color="var(--ok)" axisTicks={axisTicks} />
         </div>
         <div className="mt-3 text-[13px] text-ink-2">
            {merged > 0 ? (
               <>
                  <b className="font-semibold text-ink tabular-nums">{merged}</b> merged
                  <span className="text-ink-3"> · </span>
                  avg{' '}
                  <b className="font-semibold text-ink tabular-nums">{humanHours(overallAvg)}</b>
               </>
            ) : (
               <span className="text-ink-3">No merges in this window.</span>
            )}
         </div>
      </StatsCard>
   );
}
