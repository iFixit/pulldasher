import type { Status } from '../../model/status';
import { StatsCard } from './parts';

/**
 * The open-PR breakdown, moved out of the header and given room to breathe: a
 * headline count, a single stacked bar of the mix, and a legend of every
 * status with its share. This is the board's shape at a glance — where the
 * work is piled up right now.
 */
export function StatusBar({
   items,
   total,
}: {
   items: { status: Status; count: number; label: string; color: string }[];
   total: number;
}) {
   return (
      <StatsCard>
         <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-ink">{total}</span>
            <span className="text-sm text-ink-2">open {total === 1 ? 'PR' : 'PRs'}</span>
         </div>
         {total > 0 && (
            <>
               <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-secondary">
                  {items.map(it => (
                     <div
                        key={it.status}
                        style={{ width: `${(it.count / total) * 100}%`, background: it.color }}
                        title={`${it.label}: ${it.count}`}
                     />
                  ))}
               </div>
               <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
                  {items.map(it => (
                     <span key={it.status} className="inline-flex items-center gap-1.5">
                        <span
                           className="h-2.5 w-2.5 flex-none rounded-[3px]"
                           style={{ background: it.color }}
                        />
                        <span className="text-ink-2">{it.label}</span>
                        <span className="font-semibold tabular-nums text-ink">{it.count}</span>
                     </span>
                  ))}
               </div>
            </>
         )}
      </StatsCard>
   );
}
