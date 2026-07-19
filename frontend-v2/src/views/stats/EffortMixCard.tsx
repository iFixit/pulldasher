import type { EffortMix } from '../../model/stats';
import { BarRow, StatsCard, WEIGHT_RAMP } from './parts';

/**
 * The open board's review effort by weight class — is the pile mostly quick
 * reads or heavy lifts? Same XS→XL ramp as the rows' weight meters.
 */
export function EffortMixCard({ mix }: { mix: EffortMix }) {
   const max = Math.max(...mix.buckets.map(b => b.count), 1);
   return (
      <StatsCard title="Review effort on the board" sub="open PRs by weight">
         <div className="mt-3 flex flex-col gap-2">
            {mix.buckets.map(b => (
               <BarRow
                  key={b.weight}
                  pct={(b.count / max) * 100}
                  color={WEIGHT_RAMP[b.weight]}
                  lead={<span className="w-7 flex-none font-medium text-ink">{b.weight}</span>}
                  trail={
                     <span className="w-8 flex-none text-right text-ink-2 tabular-nums">
                        {b.count || ''}
                     </span>
                  }
               />
            ))}
         </div>
         {mix.estimated > 0 && (
            <div className="mt-3 text-[13px] text-ink-3">
               {mix.estimated} without a wire size (weight estimated)
            </div>
         )}
      </StatsCard>
   );
}
