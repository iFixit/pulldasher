import type { AuthorLoad } from '../../model/stats';
import { PersonCell, SplitBarRow, StatsCard } from './parts';

/**
 * Who's carrying the most open PRs. The bar splits into the author's whole
 * pile and the amber share of it still awaiting CR, so a big-but-moving
 * author reads differently from one whose PRs are all stuck waiting.
 */
export function AuthorLoadCard({
   rows,
   me,
   onPerson,
   cap = 10,
}: {
   rows: AuthorLoad[];
   me?: string;
   onPerson?: (login: string) => void;
   cap?: number;
}) {
   const shown = rows.slice(0, cap);
   const max = Math.max(...rows.map(r => r.count), 1);
   const more = rows.length - shown.length;
   return (
      <StatsCard title="Open PRs by author" sub="total · awaiting CR · oldest">
         <div className="mt-3 flex flex-col gap-2">
            {shown.map(r => (
               <SplitBarRow
                  key={r.login}
                  pct={(r.count / max) * 100}
                  splitPct={r.count > 0 ? (r.awaitingCr / r.count) * 100 : 0}
                  color="var(--slate)"
                  splitColor="var(--warn)"
                  title={`${r.login}: ${r.count} open, ${r.awaitingCr} awaiting CR, oldest ${r.oldestDays}d`}
                  lead={<PersonCell login={r.login} me={me} onPerson={onPerson} />}
                  trail={
                     <span className="flex-none text-right text-ink-2 tabular-nums">
                        {r.count}
                        <span className="ml-1 text-ink-3">
                           · {r.awaitingCr} CR · oldest {r.oldestDays}d
                        </span>
                     </span>
                  }
               />
            ))}
            {more > 0 && <div className="text-[13px] text-ink-3">+{more} more authors</div>}
         </div>
      </StatsCard>
   );
}
