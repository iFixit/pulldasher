import type { Reciprocity } from '../../model/stats';
import { PairedBarRow, PersonCell, StatsCard } from './parts';

/**
 * Review give-and-take: PRs you stamped for others against stamps others put
 * on yours, as two bars sharing one scale instead of a bar plus a trailing
 * number the reader had to hold in their head. A healthy board reads roughly
 * balanced; all-given people are carrying it, all-received people are
 * coasting.
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
   const max = Math.max(...rows.flatMap(r => [r.given, r.received]), 1);
   const more = rows.length - shown.length;
   return (
      <StatsCard
         title="Give and take"
         sub="PRs reviewed (top bar) vs reviews received (bottom bar)"
      >
         {shown.length === 0 ? (
            <div className="mt-3 text-[13px] text-ink-3">No review activity in this window.</div>
         ) : (
            <div className="mt-3 flex flex-col gap-2.5">
               <div className="flex items-center gap-3 text-[11px] text-ink-3">
                  <span className="inline-flex items-center gap-1.5">
                     <span
                        aria-hidden
                        className="h-2 w-2 flex-none rounded-[2px]"
                        style={{ background: 'var(--brand)' }}
                     />
                     given
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                     <span
                        aria-hidden
                        className="h-2 w-2 flex-none rounded-[2px]"
                        style={{ background: 'var(--ink-3)' }}
                     />
                     received
                  </span>
               </div>
               {shown.map(r => (
                  <PairedBarRow
                     key={r.login}
                     colorA="var(--brand)"
                     colorB="var(--ink-3)"
                     aPct={(r.given / max) * 100}
                     bPct={(r.received / max) * 100}
                     title={`${r.login}: reviewed ${r.given} PR${r.given === 1 ? '' : 's'}, received ${r.received} stamp${r.received === 1 ? '' : 's'}`}
                     lead={<PersonCell login={r.login} me={me} onPerson={onPerson} />}
                     aTrail={
                        <span className="w-5 flex-none text-right text-ink-2 tabular-nums">
                           {r.given}
                        </span>
                     }
                     bTrail={
                        <span className="w-5 flex-none text-right text-ink-3 tabular-nums">
                           {r.received}
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
