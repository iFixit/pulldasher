import type { DayCount } from '../../model/stats';
import { MiniColumns, StatsCard } from './parts';

/**
 * Review pulse: CR+QA stamps landed per day. Re-stamps count — they're real
 * review work — so this reads "how much reviewing happened", the input-side
 * twin of the Shipping card's output.
 */
export function PulseCard({ perDay }: { perDay: DayCount[] }) {
   const total = perDay.reduce((a, d) => a + d.count, 0);
   const quietDays = perDay.filter(d => d.count === 0).length;
   return (
      <StatsCard title="Review pulse" sub="CR + QA stamps per day, last 14 days">
         <div className="mt-3">
            <MiniColumns days={perDay} color="var(--brand)" unit="stamps" />
         </div>
         <div className="mt-3 text-[13px] text-ink-2">
            <b className="font-semibold text-ink tabular-nums">{total}</b> stamps
            {quietDays > 0 && (
               <span className="text-ink-3">
                  {' '}
                  · {quietDays} quiet day{quietDays > 1 ? 's' : ''}
               </span>
            )}
         </div>
      </StatsCard>
   );
}
