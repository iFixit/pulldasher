import { shortRepo } from '../../../../shared/format';
import type { RepoLoad } from '../../model/stats';
import { SplitBarRow, StatsCard } from './parts';

/**
 * Where the open PRs live. The bar splits into the repo's whole pile and the
 * amber share of it still awaiting CR — the reviewer-facing debt, not just
 * the total count — plus the oldest age trailing.
 */
export function RepoLoadCard({ rows, cap = 10 }: { rows: RepoLoad[]; cap?: number }) {
   const shown = rows.slice(0, cap);
   const max = Math.max(...rows.map(r => r.count), 1);
   const more = rows.length - shown.length;
   return (
      <StatsCard title="Open PRs by repo" sub="count · awaiting CR · oldest">
         <div className="mt-3 flex flex-col gap-2">
            {shown.map(r => (
               <SplitBarRow
                  key={r.repo}
                  pct={(r.count / max) * 100}
                  splitPct={r.count > 0 ? (r.awaitingCr / r.count) * 100 : 0}
                  color="var(--ink-3)"
                  splitColor="var(--warn)"
                  title={r.repo}
                  lead={
                     <span className="w-28 flex-none truncate font-medium text-ink" title={r.repo}>
                        {shortRepo(r.repo)}
                     </span>
                  }
                  trail={
                     <span className="flex-none text-right text-ink-2 tabular-nums">
                        {r.count}
                        <span className="ml-1 text-ink-3">
                           · {r.awaitingCr} CR · {r.oldestDays}d
                        </span>
                     </span>
                  }
               />
            ))}
            {more > 0 && <div className="text-[13px] text-ink-3">+{more} more repos</div>}
         </div>
      </StatsCard>
   );
}
