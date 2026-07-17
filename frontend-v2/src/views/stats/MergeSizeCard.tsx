import type { Weight } from '../../model/status';
import { humanHours, type MergeBucket } from '../../model/stats';

const RAMP: Record<Weight, string> = {
   XS: 'var(--ok)',
   S: 'var(--ok)',
   M: 'var(--ink-3)',
   L: 'var(--warn)',
   XL: 'var(--bad)',
};

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
      <section className="rounded-2xl border border-line bg-surface p-4">
         <h3 className="m-0 text-sm font-semibold text-ink">
            Time to merge by size
            <span className="ml-2 text-xs text-ink-3">median, last 14 days</span>
         </h3>
         {sampled === 0 ? (
            <div className="mt-3 text-[13px] text-ink-3">
               No merged PRs with size data in this window.
               {merged > 0 && (
                  <div className="text-ink-3/70">
                     {merged} merged, but no diff sizes on the wire
                  </div>
               )}
            </div>
         ) : (
            <>
               <div className="mt-3 flex flex-col gap-2">
                  {buckets.map(b => {
                     const pct = b.count > 0 && max > 0 ? (b.medianHours / max) * 100 : 0;
                     return (
                        <div
                           key={b.weight}
                           className="flex items-center gap-2 text-[13px]"
                           title={`avg ${humanHours(b.avgHours)}`}
                        >
                           <span className="w-7 flex-none font-medium text-ink">{b.weight}</span>
                           {b.count > 0 ? (
                              <div className="h-2 flex-1 overflow-hidden rounded bg-secondary">
                                 <div
                                    className="h-full rounded"
                                    style={{ width: `${pct}%`, background: RAMP[b.weight] }}
                                 />
                              </div>
                           ) : (
                              <div className="flex-1 text-ink-3">no data</div>
                           )}
                           {b.count > 0 && (
                              <span className="flex-none text-right text-ink-2 tabular-nums">
                                 {humanHours(b.medianHours)}
                                 <span className="ml-1 text-ink-3">· {b.count}</span>
                              </span>
                           )}
                        </div>
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
      </section>
   );
}
