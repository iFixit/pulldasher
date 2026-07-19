import { shortRepo } from '../../format';
import type { RepoLoad } from '../../model/stats';
import { BarRow, StatsCard } from './parts';

/**
 * Where the open PRs live. The bar is the repo's whole pile; the trailing
 * numbers split out how much of it is still review work and how old the
 * oldest is, so a big-but-moving repo reads differently from a stuck one.
 */
export function RepoLoadCard({ rows, cap = 10 }: { rows: RepoLoad[]; cap?: number }) {
   const shown = rows.slice(0, cap);
   const max = Math.max(...rows.map(r => r.count), 1);
   const more = rows.length - shown.length;
   return (
      <StatsCard title="Open PRs by repo" sub="count · awaiting CR · oldest">
         <div className="mt-3 flex flex-col gap-2">
            {shown.map(r => (
               <BarRow
                  key={r.repo}
                  pct={(r.count / max) * 100}
                  color="var(--ink-3)"
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
