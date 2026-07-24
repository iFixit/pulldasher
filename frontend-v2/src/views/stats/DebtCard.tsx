import type { ReviewDebt } from '../../model/stats';
import { MiniMeter, StatsCard } from './parts';

/**
 * The board's standing review debt, in stamps. Re-stamps get the amber tint
 * when nonzero: they're the cheapest debt on the board (the reviewer already
 * knows the code) and the most commonly forgotten. Each number carries a thin
 * meter scaled to the card's shared max, so relative size is glanceable
 * without reading four digits and doing the comparison in your head.
 */
export function DebtCard({ debt }: { debt: ReviewDebt }) {
   const max = Math.max(debt.crSlots, debt.qaSlots, debt.restamps, debt.unclaimedQa, 1);
   const cell = (value: number, label: string, hint: string, hot?: boolean) => (
      <div title={hint}>
         <div
            className="text-xl font-semibold tabular-nums"
            style={{ color: value === 0 ? 'var(--ink-3)' : hot ? 'var(--warn)' : 'var(--ink)' }}
         >
            {value}
         </div>
         <div className="text-xs text-ink-3">{label}</div>
         <MiniMeter
            pct={(value / max) * 100}
            color={value === 0 ? 'var(--secondary)' : hot ? 'var(--warn)' : 'var(--ink-3)'}
         />
      </div>
   );
   return (
      <StatsCard title="Review debt" sub="stamps the board is owed right now">
         <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            {cell(
               debt.crSlots,
               'CR stamps needed',
               'CR sign-offs still missing across CR-incomplete PRs'
            )}
            {cell(
               debt.qaSlots,
               'QA stamps needed',
               'QA sign-offs still missing across PRs at the QA gate'
            )}
            {cell(
               debt.restamps,
               're-stamps owed',
               'stamps a push invalidated; the reviewer already knows the code',
               true
            )}
            {cell(debt.unclaimedQa, 'QA unclaimed', 'needs-QA PRs nobody has picked up')}
         </div>
      </StatsCard>
   );
}
