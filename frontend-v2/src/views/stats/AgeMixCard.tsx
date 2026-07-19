import type { LabeledCount } from '../../model/stats';
import { BarRow, StatsCard } from './parts';

/**
 * How old the open board is, youngest bucket first. Color follows the same
 * fresh→amber→red read as the rows' age stamps, so a bottom-heavy chart here
 * and a wall of red ages on the board are the same fact.
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
   // bucket upper bounds, mirroring ageMix's edges
   const edges = [0, 2, 6, 13, Infinity];
   const color = (i: number) =>
      edges[i] >= rotDays ? 'var(--bad)' : edges[i] >= warnDays ? 'var(--warn)' : 'var(--ok)';
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
