import { Avatar } from '../../components/bits';

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
      <section className="rounded-2xl border border-line bg-surface p-4">
         <h3 className="m-0 text-sm font-semibold text-ink">
            Waiting longest for CR
            <span className="ml-2 text-xs text-ink-3">
               by author · total open-days their PRs sit unreviewed
            </span>
         </h3>
         {shown.length === 0 ? (
            <div className="mt-3 text-[13px] text-ink-3">No PRs are starving for CR right now.</div>
         ) : (
            <div className="mt-3 flex flex-col gap-2">
               {shown.map(row => {
                  const pct = max > 0 ? (row.totalDays / max) * 100 : 0;
                  const heat =
                     row.worstDays >= rotDays
                        ? 'var(--bad)'
                        : row.worstDays >= warnDays
                          ? 'var(--warn)'
                          : 'var(--ink-3)';
                  return (
                     <div key={row.login} className="flex items-center gap-2 text-[13px]">
                        <Avatar login={row.login} size={20} onClick={onPerson} />
                        <span className="flex-none font-semibold text-ink">
                           {row.login === me ? (
                              <span className="text-brand">{row.login}</span>
                           ) : (
                              row.login
                           )}
                           {row.login === me && <span className="ml-1 text-ink-3">you</span>}
                        </span>
                        <div className="h-2 flex-1 overflow-hidden rounded bg-secondary">
                           <div
                              className="h-full rounded"
                              style={{ width: `${pct}%`, background: heat }}
                           />
                        </div>
                        <span className="flex-none text-right text-ink-3 tabular-nums">
                           {row.count} {row.count === 1 ? 'PR' : 'PRs'} · worst{' '}
                           <span style={{ color: heat }}>{row.worstDays}d</span>
                        </span>
                     </div>
                  );
               })}
            </div>
         )}
      </section>
   );
}
