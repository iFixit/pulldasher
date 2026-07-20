import { humanHours } from '../../model/stats';
import type { MergeAgeDayRow } from '../../model/statsHistory';
import { PeriodColumns, StatsCard } from './parts';

/**
 * Merge age (open→merge) per day, last 60 days. Bars are the daily average,
 * scaled to the average series — NOT to the outliers, which used to compress
 * every bar into an identical stub. The outlier story gets exactly one mark:
 * the window's slowest merge is flagged on its day and named in the summary
 * line. (A per-day max tick at 60-column density rendered as sixty floating
 * specks — noise, not information; each day's slowest still lives in its
 * tooltip.)
 */
export function MergeAgeByDayCard({ days }: { days: MergeAgeDayRow[] }) {
   const merged = days.reduce((a, d) => a + d.merged, 0);
   const withData = days.filter(d => d.merged > 0);
   const overallAvg = withData.length
      ? withData.reduce((a, d) => a + d.avgHours, 0) / withData.length
      : 0;
   const slowest = withData.reduce(
      (worst: MergeAgeDayRow | null, d) => (d.maxHours > (worst?.maxHours ?? 0) ? d : worst),
      null
   );
   const periods = days.map(d => ({
      key: d.day,
      title: `${d.day}: avg ${humanHours(d.avgHours)} · slowest ${humanHours(d.maxHours)} · ${d.merged} merged`,
      value: d.avgHours,
      // one mark in the whole chart: the window's slowest merge — its real
      // value, which the marker clamp pins to the top edge of its column
      marker: slowest && d.day === slowest.day ? d.maxHours : undefined,
   }));

   return (
      <StatsCard title="Merge age by day" sub="daily average, last 60 days · ▔ slowest">
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
                  {slowest && (
                     <>
                        <span className="text-ink-3"> · </span>
                        slowest{' '}
                        <b className="font-semibold text-ink tabular-nums">
                           {humanHours(slowest.maxHours)}
                        </b>
                     </>
                  )}
               </>
            ) : (
               <span className="text-ink-3">No merges in this window.</span>
            )}
         </div>
      </StatsCard>
   );
}
