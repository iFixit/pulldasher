import type { Reciprocity } from '../../model/stats';
import { BarRow, PersonCell, StatsCard } from './parts';

/**
 * Review give-and-take: PRs you stamped for others (the bar) against stamps
 * others put on yours (the trailing number). A healthy board reads roughly
 * balanced; all-bar people are carrying it, no-bar people are coasting.
 */
export function ReciprocityCard({
   rows,
   me,
   onPerson,
   cap = 10,
}: {
   rows: Reciprocity[];
   me?: string;
   onPerson?: (login: string) => void;
   cap?: number;
}) {
   const shown = rows.slice(0, cap);
   const max = Math.max(...rows.map(r => r.given), 1);
   const more = rows.length - shown.length;
   return (
      <StatsCard title="Give and take" sub="PRs reviewed vs reviews received">
         {shown.length === 0 ? (
            <div className="mt-3 text-[13px] text-ink-3">No review activity in this window.</div>
         ) : (
            <div className="mt-3 flex flex-col gap-2">
               {shown.map(r => (
                  <BarRow
                     key={r.login}
                     pct={(r.given / max) * 100}
                     color="var(--brand)"
                     title={`${r.login}: reviewed ${r.given} PR${r.given === 1 ? '' : 's'}, received ${r.received} stamp${r.received === 1 ? '' : 's'}`}
                     lead={<PersonCell login={r.login} me={me} onPerson={onPerson} />}
                     trail={
                        <span className="flex-none text-right text-ink-2 tabular-nums">
                           {r.given} <span className="text-ink-3">/ {r.received}</span>
                        </span>
                     }
                  />
               ))}
               {more > 0 && <div className="text-[13px] text-ink-3">+{more} more people</div>}
            </div>
         )}
      </StatsCard>
   );
}
