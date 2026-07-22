import { humanHours, type MergeBucket } from '../../model/stats';
import { BarRow, StatsCard, WEIGHT_RAMP as RAMP } from './parts';

export function MergeSizeCard({
   buckets,
   sampled,
   merged,
}: {
   /** exactly 5 entries, already in XS→XL order; count 0 kept for scale */
   buckets: MergeBucket[];
   /** merged PRs that had usable size+time data (fed the buckets) */
   sampled: number;
   /** merged PRs seen in the window total (some dropped for missing size) */
   merged: number;
}) {
   const max = Math.max(...buckets.map(b => b.medianHours));

   return (
      <StatsCard title="Time to merge by size" sub="median, last 14 days">
         {sampled === 0 ? (
            <div className="mt-3 text-[13px] text-ink-3">
               No merged PRs with size data in this window.
               {merged > 0 && (
                  <div className="text-ink-3/70">
                     {merged} merged, but no diff sizes from GitHub
                  </div>
               )}
            </div>
         ) : (
            <>
               <div className="mt-3 flex flex-col gap-2">
                  {buckets.map(b => {
                     const label = (
                        <span className="w-7 flex-none font-medium text-ink">{b.weight}</span>
                     );
                     if (b.count === 0) {
                        return (
                           <div key={b.weight} className="flex items-center gap-2 text-[13px]">
                              {label}
                              <div className="flex-1 text-ink-3">no data</div>
                           </div>
                        );
                     }
                     return (
                        <BarRow
                           key={b.weight}
                           title={`avg ${humanHours(b.avgHours)}`}
                           pct={max > 0 ? (b.medianHours / max) * 100 : 0}
                           color={RAMP[b.weight]}
                           lead={label}
                           trail={
                              <span className="flex-none text-right text-ink-2 tabular-nums">
                                 {humanHours(b.medianHours)}
                                 <span className="ml-1 text-ink-3">· {b.count}</span>
                              </span>
                           }
                        />
                     );
                  })}
               </div>
               <div className="mt-3 text-[13px] text-ink-3">
                  {merged > sampled
                     ? `${sampled} of ${merged} merged PRs had a size`
                     : `${sampled} merged PRs`}
               </div>
            </>
         )}
      </StatsCard>
   );
}
