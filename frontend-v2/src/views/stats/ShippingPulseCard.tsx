import { humanHours, type DayCount, type Latency } from '../../model/stats';
import { type AxisTick, LineChart, StatsCard } from './parts';

/**
 * Volume vs. speed, one panel: merges per day (bars, left axis) against
 * CR+QA stamps per day (line, right axis) — the Shipping and Review-pulse
 * cards fused, since "how much shipped" only means something next to "how
 * much reviewing happened" the same days. First-CR median rides along as the
 * responsiveness number time-to-merge (which includes the author's own
 * iteration) hides.
 */
export function ShippingPulseCard({
   perDay,
   pulse,
   firstCr,
}: {
   perDay: DayCount[];
   pulse: DayCount[];
   firstCr: Latency;
}) {
   const total = perDay.reduce((a, d) => a + d.count, 0);
   const half = Math.floor(perDay.length / 2);
   const lastWeek = perDay.slice(0, half).reduce((a, d) => a + d.count, 0);
   const thisWeek = perDay.slice(half).reduce((a, d) => a + d.count, 0);
   const delta = thisWeek - lastWeek;
   const pulseTotal = pulse.reduce((a, d) => a + d.count, 0);
   const quietDays = pulse.filter(d => d.count === 0).length;

   const axisTicks: AxisTick[] = [0, Math.floor((perDay.length - 1) / 2), perDay.length - 1]
      .filter((idx, i, arr) => idx >= 0 && arr.indexOf(idx) === i)
      .map(index => ({
         index,
         label: new Date(perDay[index].day).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
         }),
      }));

   return (
      <StatsCard
         title="Shipping & review pulse"
         sub="merged/day (bars) · stamps/day (line) · last 14 days"
      >
         <div className="mt-3">
            <LineChart
               ariaLabel="Merged pull requests per day as bars on the left axis, and CR plus QA stamps per day as a line on the right axis, over the last 14 days"
               bars={[
                  {
                     label: 'merged/day',
                     color: 'var(--ok)',
                     values: perDay.map(d => d.count),
                     axis: 'left',
                  },
               ]}
               series={[
                  {
                     label: 'stamps/day',
                     color: 'var(--brand)',
                     values: pulse.map(d => d.count),
                     axis: 'right',
                  },
               ]}
               axisTicks={axisTicks}
            />
         </div>
         <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13px] text-ink-2">
            <span>
               <b className="font-semibold text-ink tabular-nums">{total}</b> merged
            </span>
            <span>
               this week <b className="font-semibold text-ink tabular-nums">{thisWeek}</b> vs{' '}
               <b className="font-semibold text-ink tabular-nums">{lastWeek}</b>
               {delta !== 0 && (
                  <span
                     className="ml-1 font-medium tabular-nums"
                     style={{ color: delta > 0 ? 'var(--ok)' : 'var(--warn)' }}
                  >
                     {delta > 0 ? '+' : ''}
                     {delta}
                  </span>
               )}
            </span>
            <span>
               <b className="font-semibold text-ink tabular-nums">{pulseTotal}</b> stamps
               {quietDays > 0 && (
                  <span className="text-ink-3">
                     {' '}
                     · {quietDays} quiet day{quietDays > 1 ? 's' : ''}
                  </span>
               )}
            </span>
            {firstCr.sampled > 0 && (
               <span
                  title={`avg ${humanHours(firstCr.avgHours)} · ${firstCr.sampled} merged PRs with a CR`}
               >
                  first CR in{' '}
                  <b className="font-semibold text-ink tabular-nums">
                     {humanHours(firstCr.medianHours)}
                  </b>{' '}
                  median
               </span>
            )}
         </div>
      </StatsCard>
   );
}
