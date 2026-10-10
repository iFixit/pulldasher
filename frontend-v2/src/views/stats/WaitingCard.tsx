import { shortRepo } from '../../../../shared/format';
import { humanHours, type PullRef, type WaitingOnSomeone } from '../../model/stats';
import { PersonCell, StatsCard } from './parts';

const link = (p: PullRef) => (
   <a
      className="min-w-0 flex-1 truncate text-ink hover:underline"
      href={`https://github.com/${p.repo}/pull/${p.number}`}
      target="_blank"
      rel="noreferrer"
      title={p.title}
   >
      {shortRepo(p.repo)}#{p.number} {p.title}
   </a>
);

/**
 * Review owed to a person other than the author: requests nobody has
 * answered (hours, the policy's clock) and pulls from outside the dev team
 * (days). An author's own review of their own pull is not waiting on anyone.
 */
export function WaitingCard({
   waiting,
   me,
   onPerson,
   cap = 6,
}: {
   waiting: WaitingOnSomeone;
   me?: string;
   onPerson?: (login: string) => void;
   cap?: number;
}) {
   const { requests, outside } = waiting;
   const empty = !requests.length && !outside.length;
   return (
      <StatsCard title="Waiting on someone" sub="review requests and outside pulls">
         {empty ? (
            <div className="mt-3 text-[13px] text-ink-3">Nobody is waiting on a review.</div>
         ) : (
            <div className="mt-3 flex flex-col gap-1.5 text-[13px]">
               {requests.slice(0, cap).map(r => (
                  <div
                     key={`${r.repo}#${r.number}@${r.login}`}
                     className="flex items-baseline gap-2"
                  >
                     {link(r)}
                     <PersonCell login={r.login} me={me} onPerson={onPerson} />
                     <span className="flex-none text-ink-3 tabular-nums">
                        {humanHours(r.hours)}
                     </span>
                  </div>
               ))}
               {requests.length > cap && (
                  <div className="text-ink-3">+{requests.length - cap} more requests</div>
               )}
               {outside.length > 0 && (
                  <div className="mt-2 text-xs font-semibold text-ink-3">
                     From outside the dev team
                  </div>
               )}
               {outside.slice(0, cap).map(o => (
                  <div key={`${o.repo}#${o.number}`} className="flex items-baseline gap-2">
                     {link(o)}
                     <span className="flex-none text-ink-3">{o.author}</span>
                     <span className="flex-none text-ink-3 tabular-nums">{o.days}d</span>
                  </div>
               ))}
               {outside.length > cap && (
                  <div className="text-ink-3">+{outside.length - cap} more pulls</div>
               )}
            </div>
         )}
      </StatsCard>
   );
}
