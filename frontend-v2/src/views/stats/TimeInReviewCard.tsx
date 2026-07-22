import type { TimeInReviewWeek } from '../../model/statsHistory';
import { type AxisTick, LineChart, StatsCard } from './parts';

/**
 * Replaces the three separate trend cards (monthly first-CR latency, weekly
 * PR duration, daily merge age) with one weekly chart: how long a PR waits
 * for its first review, and how long it takes to merge, over the last
 * half-year. All three source series ran on different cadences (month/week/
 * day) — `weeklyTimeInReview` in statsHistory.ts resamples them onto a
 * shared weekly x-axis so responsiveness and throughput drift show up on the
 * same chart instead of three disconnected ones.
 */
export function TimeInReviewCard({ weeks }: { weeks: TimeInReviewWeek[] }) {
   const sampled = weeks.some(w => w.firstCrMedianHours > 0 || w.mergeAvgHours > 0);
   const axisTicks: AxisTick[] = weeks
      .map((w, i) => (i % 4 === 0 ? { index: i, label: w.isoWeek.replace(/^\d+-/, '') } : null))
      .filter((t): t is AxisTick => t !== null);

   return (
      <StatsCard title="Time in review" sub="weekly, last 26 weeks">
         {!sampled ? (
            <div className="mt-3 text-[13px] text-ink-3">Not enough history yet.</div>
         ) : (
            <div className="mt-3">
               <LineChart
                  ariaLabel="Median and average hours to first CR, and average hours to merge, by week"
                  series={[
                     {
                        label: 'time to first CR (median)',
                        color: 'var(--brand)',
                        values: weeks.map(w => w.firstCrMedianHours),
                        area: true,
                     },
                     {
                        label: 'time to first CR (avg)',
                        color: 'var(--ink-3)',
                        values: weeks.map(w => w.firstCrAvgHours),
                        dashed: true,
                     },
                     {
                        label: 'time to merge (avg)',
                        color: 'var(--slate)',
                        values: weeks.map(w => w.mergeAvgHours),
                     },
                  ]}
                  axisTicks={axisTicks}
               />
            </div>
         )}
         <div className="mt-3 text-[13px] text-ink-3">hours · lower is faster</div>
      </StatsCard>
   );
}
