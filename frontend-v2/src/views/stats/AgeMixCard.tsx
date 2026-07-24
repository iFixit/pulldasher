import type { LabeledCount } from '../../model/stats';
import { BarRow, StatsCard } from './parts';

/**
 * How old the open board is, youngest bucket first. Color follows the same
 * fresh→amber read as the rows' age stamps: buckets still under warnDays stay
 * quiet ink (young isn't a "confirmation" worth --ok), buckets at/past
 * warnDays pick up --warn, and buckets at/past rotDays go full-strength warn
 * — never red, since --bad is reserved for broken CI.
 */
export function AgeMixCard({
   buckets,
   warnDays,
   rotDays,
}: {
   buckets: LabeledCount[];
   warnDays: number;
   rotDays: number;
}) {
   const max = Math.max(...buckets.map(b => b.count), 1);
   // bucket lower bounds (days), mirroring ageMix's today/1–2d/3–6d/7–13d/14d+ ranges
   const lowerBounds = [0, 1, 3, 7, 14];
   const color = (i: number) => {
      const lowerBound = lowerBounds[i];
      if (lowerBound >= rotDays) return 'var(--warn)';
      if (lowerBound >= warnDays) return 'color-mix(in oklab, var(--warn) 55%, transparent)';
      return 'var(--ink-3)';
   };
   return (
      <StatsCard title="Age of open PRs" sub="time since opened">
         <div className="mt-3 flex flex-col gap-2">
            {buckets.map((b, i) => (
               <BarRow
                  key={b.label}
                  pct={(b.count / max) * 100}
                  color={color(i)}
                  lead={<span className="w-12 flex-none font-medium text-ink">{b.label}</span>}
                  trail={
                     <span className="w-8 flex-none text-right text-ink-2 tabular-nums">
                        {b.count || ''}
                     </span>
                  }
               />
            ))}
         </div>
      </StatsCard>
   );
}
