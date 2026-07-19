import type { AuthorLoad } from '../../model/stats';
import { BarRow, PersonCell, StatsCard } from './parts';

/** who's carrying the most open PRs, with each person's oldest one alongside. */
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
      <StatsCard title="Open PRs by author" sub="work in progress">
         <div className="mt-3 flex flex-col gap-2">
            {shown.map(r => (
               <BarRow
                  key={r.login}
                  pct={(r.count / max) * 100}
                  color="var(--slate)"
                  lead={<PersonCell login={r.login} me={me} onPerson={onPerson} />}
                  trail={
                     <span className="flex-none text-right text-ink-2 tabular-nums">
                        {r.count}
                        <span className="ml-1 text-ink-3">· oldest {r.oldestDays}d</span>
                     </span>
                  }
               />
            ))}
            {more > 0 && <div className="text-[13px] text-ink-3">+{more} more authors</div>}
         </div>
      </StatsCard>
   );
}
