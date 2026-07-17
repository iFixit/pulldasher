import { BarRow, PersonCell, StatsCard } from './parts';

export function Leaderboard({
   title,
   sub,
   accent,
   rows,
   me,
   onPerson,
   cap = 12,
}: {
   title: string;
   sub?: string;
   /** CSS var for the bar fill, e.g. 'var(--brand)' for CR, 'var(--violet)' for QA */
   accent: string;
   rows: { login: string; count: number }[];
   me?: string;
   onPerson?: (login: string) => void;
   cap?: number;
}) {
   const shown = rows.slice(0, cap);
   const max = rows[0]?.count ?? 0;
   const more = rows.length - shown.length;

   return (
      <StatsCard title={title} sub={sub}>
         {shown.length === 0 ? (
            <div className="mt-3 text-[13px] text-ink-3">No sign-offs on the board yet.</div>
         ) : (
            <div className="mt-3 flex flex-col gap-2">
               {shown.map((row, i) => (
                  <BarRow
                     key={row.login}
                     pct={max > 0 ? (row.count / max) * 100 : 0}
                     color={accent}
                     lead={
                        <>
                           <span className="w-4 flex-none text-right text-ink-3 tabular-nums">
                              {i + 1}
                           </span>
                           <PersonCell login={row.login} me={me} onPerson={onPerson} />
                        </>
                     }
                     trail={
                        <span className="w-8 flex-none text-right text-ink-2 tabular-nums">
                           {row.count}
                        </span>
                     }
                  />
               ))}
               {more > 0 && <div className="text-[13px] text-ink-3">+{more} more reviewers</div>}
            </div>
         )}
      </StatsCard>
   );
}
