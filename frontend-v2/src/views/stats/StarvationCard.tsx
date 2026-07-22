import { BarRow, PersonCell, StatsCard } from './parts';

export function StarvationCard({
   rows,
   me,
   onPerson,
   warnDays,
   rotDays,
   cap = 10,
}: {
   rows: { login: string; count: number; totalDays: number; worstDays: number }[]; // sorted desc by totalDays
   me?: string;
   onPerson?: (login: string) => void;
   /** worstDays >= warnDays => amber heat; >= rotDays => red heat */
   warnDays: number;
   rotDays: number;
   cap?: number;
}) {
   const shown = rows.slice(0, cap);
   const max = rows[0]?.totalDays ?? 0;

   return (
      <StatsCard
         title="Waiting longest for CR"
         sub="by author · total open-days their PRs sit unreviewed"
      >
         {shown.length === 0 ? (
            <div className="mt-3 text-[13px] text-ink-3">Nothing has been waiting long for CR.</div>
         ) : (
            <div className="mt-3 flex flex-col gap-2">
               {shown.map(row => {
                  const heat =
                     row.worstDays >= rotDays
                        ? 'var(--bad)'
                        : row.worstDays >= warnDays
                          ? 'var(--warn)'
                          : 'var(--ink-3)';
                  return (
                     <BarRow
                        key={row.login}
                        pct={max > 0 ? (row.totalDays / max) * 100 : 0}
                        color={heat}
                        lead={<PersonCell login={row.login} me={me} onPerson={onPerson} />}
                        trail={
                           <span className="flex-none text-right text-ink-3 tabular-nums">
                              {row.count} {row.count === 1 ? 'PR' : 'PRs'} · worst {row.worstDays}d
                           </span>
                        }
                     />
                  );
               })}
            </div>
         )}
      </StatsCard>
   );
}
