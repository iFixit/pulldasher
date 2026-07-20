import { humanHours } from '../../model/stats';
import type { MergeAgeDayRow } from '../../model/statsHistory';
import { PeriodColumns, StatsCard } from './parts';

/**
 * Merge age (open→merge) per day, last 60 days: the day's average as the bar,
 * its slowest merge as a thin marker above — so a single bad outlier doesn't
 * vanish inside a tame-looking daily average.
 */
export function MergeAgeByDayCard({ days }: { days: MergeAgeDayRow[] }) {
   const merged = days.reduce((a, d) => a + d.merged, 0);
   const withData = days.filter(d => d.merged > 0);
   const overallAvg = withData.length
      ? withData.reduce((a, d) => a + d.avgHours, 0) / withData.length
      : 0;
   const periods = days.map(d => ({
      key: d.day,
      title: `${d.day}: avg ${humanHours(d.avgHours)} · slowest ${humanHours(d.maxHours)} · ${d.merged} merged`,
      value: d.avgHours,
      marker: d.maxHours,
   }));

   return (
      <StatsCard title="Merge age by day" sub="avg (bar) · slowest (mark), last 60 days">
         <div className="mt-3">
            <PeriodColumns periods={periods} color="var(--brand)" />
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
