import { Avatar } from '../../components/bits';

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
      <section className="rounded-2xl border border-line bg-surface p-4">
         <h3 className="m-0 text-sm font-semibold text-ink">
            {title}
            {sub && <span className="ml-2 text-xs text-ink-3">{sub}</span>}
         </h3>
         {shown.length === 0 ? (
            <div className="mt-3 text-[13px] text-ink-3">No sign-offs on the board yet.</div>
         ) : (
            <div className="mt-3 flex flex-col gap-2">
               {shown.map((row, i) => {
                  const pct = max > 0 ? (row.count / max) * 100 : 0;
                  return (
                     <div key={row.login} className="flex items-center gap-2 text-[13px]">
                        <span className="w-4 flex-none text-right text-ink-3 tabular-nums">
                           {i + 1}
                        </span>
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
                              style={{ width: `${pct}%`, background: accent }}
                           />
                        </div>
                        <span className="w-8 flex-none text-right text-ink-2 tabular-nums">
                           {row.count}
                        </span>
                     </div>
                  );
               })}
               {more > 0 && <div className="text-[13px] text-ink-3">+{more} more reviewers</div>}
            </div>
         )}
      </section>
   );
}
