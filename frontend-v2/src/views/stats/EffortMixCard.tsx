import type { EffortMix } from '../../model/stats';
import { BarRow, Donut, StatsCard, WEIGHT_RAMP } from './parts';

/**
 * The open board's review effort by weight class — is the pile mostly quick
 * reads or heavy lifts? Same XS→XL ramp as the rows' weight meters, with a
 * compact donut alongside the bars: these five buckets are mutually
 * exclusive and sum to the open total, so a part-to-whole glyph is honest
 * here in a way it wouldn't be for friction's overlapping categories.
 */
export function EffortMixCard({ mix }: { mix: EffortMix }) {
   const max = Math.max(...mix.buckets.map(b => b.count), 1);
   return (
      <StatsCard title="Review effort on the board" sub="open PRs by weight">
         <div className="mt-3 flex flex-wrap items-start gap-4">
            <div className="flex flex-1 flex-col gap-2">
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
            <Donut
               ariaLabel="Open pull requests by weight class"
               size={72}
               thickness={10}
               centerSub="open"
               slices={mix.buckets.map(b => ({
                  label: b.weight,
                  value: b.count,
                  color: WEIGHT_RAMP[b.weight],
               }))}
            />
         </div>
         {mix.estimated > 0 && (
            <div className="mt-3 text-[13px] text-ink-3">
               {mix.estimated} without a wire size (weight estimated)
            </div>
         )}
      </StatsCard>
   );
}
