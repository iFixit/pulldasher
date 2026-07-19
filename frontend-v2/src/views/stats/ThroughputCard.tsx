import { humanHours, type DayCount, type Latency } from '../../model/stats';
import { MiniColumns, StatsCard } from './parts';

/**
 * Shipping cadence over the closed window: merges per day, this week against
 * last, and how fast a PR gets its first CR — the responsiveness number that
 * time-to-merge (which includes the author's own iteration) hides.
 */
export function ThroughputCard({ perDay, firstCr }: { perDay: DayCount[]; firstCr: Latency }) {
   const total = perDay.reduce((a, d) => a + d.count, 0);
   const half = Math.floor(perDay.length / 2);
   const lastWeek = perDay.slice(0, half).reduce((a, d) => a + d.count, 0);
   const thisWeek = perDay.slice(half).reduce((a, d) => a + d.count, 0);
   const delta = thisWeek - lastWeek;

   return (
      <StatsCard title="Shipping" sub="merged per day, last 14 days">
         <div className="mt-3">
            <MiniColumns days={perDay} color="var(--ok)" unit="merged" />
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
