import type { SelfReviewMix } from '../../model/stats';
import { BarRow, StatsCard } from './parts';

/**
 * How the pulls merged in the window were reviewed. The risk line is a rough
 * signal: it only sees what titles and descriptions say.
 */
export function SelfReviewCard({ mix }: { mix: SelfReviewMix }) {
   const rows = [
      { label: 'Self-reviewed', n: mix.self, color: 'var(--ink-3)' },
      { label: 'Asked for review', n: mix.asked, color: 'var(--brand)' },
      { label: 'Reviewed by someone else', n: mix.byOthers, color: 'var(--ok)' },
      { label: 'No stamp', n: mix.unstamped, color: 'var(--secondary)' },
   ];
   return (
      <StatsCard title="Self-reviewed vs asked" sub="merged, last 14 days">
         {mix.merged === 0 ? (
            <div className="mt-3 text-[13px] text-ink-3">Nothing merged in this window.</div>
         ) : (
            <div className="mt-3 flex flex-col gap-2">
               {rows.map(r => (
                  <BarRow
                     key={r.label}
                     pct={(r.n / mix.merged) * 100}
                     color={r.color}
                     lead={<span className="w-44 flex-none truncate text-ink">{r.label}</span>}
                     trail={
                        <span className="flex-none text-right text-ink-2 tabular-nums">
                           {r.n}
                           <span className="ml-1 text-ink-3">
                              · {Math.round((r.n / mix.merged) * 100)}%
                           </span>
                        </span>
                     }
                  />
               ))}
               <div
                  className="mt-1 text-xs text-ink-3"
                  title="Reverts by title, and merges saying Fixes or Reverts of a self-reviewed pull merged up to a week earlier"
               >
                  Rough signal: {mix.risk.reverts} {mix.risk.reverts === 1 ? 'revert' : 'reverts'},{' '}
                  {mix.risk.afterSelfReview} fix-up or revert of a self-reviewed pull within a week
               </div>
            </div>
         )}
      </StatsCard>
   );
}
