import { STATUS_ORDER, type DerivedPull } from '../model/status';
import type { Team } from '../types';
import { Avatar } from '../components/bits';
import { Fold, Lane, RestGroup } from '../components/Lane';
import { Row, type RowOptions } from '../components/Row';
import { crSort } from './ForYou';

export function People({
   pulls,
   allPulls,
   teams,
   person,
   onPerson,
   opts,
}: {
   /** scoped pool (what the lanes show) */
   pulls: DerivedPull[];
   /** unscoped pool (for the picker counts and owed re-stamps) */
   allPulls: DerivedPull[];
   teams: Team[];
   person: string | null;
   onPerson: (login: string) => void;
   opts: RowOptions;
}) {
   const counts = new Map<string, number>();
   for (const p of allPulls)
      counts.set(p.data.user.login, (counts.get(p.data.user.login) ?? 0) + 1);
   const owes = new Map<string, DerivedPull[]>();
   for (const p of allPulls) for (const u of p.recrBy) owes.set(u, [...(owes.get(u) ?? []), p]);

   const logins = [...new Set([...counts.keys(), ...owes.keys()])].sort(
      (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0)
   );
   const selected = person && logins.includes(person) ? person : logins[0];
   if (!selected) return null;

   const theirs = pulls.filter(p => p.data.user.login === selected);
   const owed = owes.get(selected) ?? [];
   const reviewable = crSort(
      theirs.filter(
         p => ['needs_cr', 'needs_recr'].includes(p.status) && p.data.user.login !== opts.me
      )
   );
   const rest = theirs
      .filter(p => !reviewable.includes(p))
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
   const team = teams.find(t => t.members.includes(selected))?.team;
   const shipping = theirs.filter(p => ['ready', 'needs_qa'].includes(p.status)).length;

   return (
      <>
         <div className="mb-4 flex flex-wrap gap-1.5">
            {logins.slice(0, 24).map(login => (
               <button
                  key={login}
                  type="button"
                  onClick={() => onPerson(login)}
                  className={`pressable inline-flex items-center gap-1.5 rounded-lg border bg-surface py-[5px] pr-2.5 pl-1.5 text-[13px] font-medium text-ink-2 ${
                     login === selected
                        ? 'border-brand shadow-[0_0_0_1px_var(--brand)]'
                        : 'border-line hover:bg-muted'
                  }`}
               >
                  <Avatar login={login} />
                  <b className="font-semibold text-ink">{login}</b>
                  <span className="text-[11px] text-ink-3 tabular-nums">
                     {counts.get(login) ?? 0}
                  </span>
               </button>
            ))}
         </div>

         <div className="mb-4 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4">
            <Avatar login={selected} size={38} />
            <span>
               <span className="text-base leading-snug font-semibold">{selected}</span>
               <br />
               <span className="text-xs text-ink-3">
                  {team ? `${team} · ` : ''}
                  {theirs.length} open PRs
               </span>
            </span>
            <span className="ml-auto flex gap-4 text-center text-xs text-ink-3">
               <span>
                  <b className="block text-base font-semibold text-ink tabular-nums">
                     {reviewable.length}
                  </b>
                  you can review
               </span>
               <span>
                  <b className="block text-base font-semibold text-ink tabular-nums">{shipping}</b>
                  close to shipping
               </span>
               <span>
                  <b className="block text-base font-semibold text-ink tabular-nums">
                     {owed.length}
                  </b>
                  re-stamps owed
               </span>
            </span>
         </div>

         <Lane
            title="You can help ship these"
            sub="waiting on review, your move if you have time"
            pulls={reviewable}
            cap={8}
            opts={opts}
         />
         {(rest.length > 0 || owed.length > 0) && (
            <RestGroup>
               <Fold
                  dot="var(--ink-3)"
                  count={rest.length}
                  label="more on their board"
                  hint="their move or waiting"
               >
                  {rest.map(p => (
                     <Row
                        key={`${p.data.repo}#${p.data.number}`}
                        pull={p}
                        opts={{ ...opts, noDim: true }}
                     />
                  ))}
               </Fold>
               <Fold
                  dot="var(--brand)"
                  count={owed.length}
                  label="re-stamps they owe others"
                  hint="fair game to nudge"
               >
                  {owed.map(p => (
                     <Row
                        key={`${p.data.repo}#${p.data.number}`}
                        pull={p}
                        opts={{ ...opts, noDim: true }}
                     />
                  ))}
               </Fold>
            </RestGroup>
         )}
      </>
   );
}
