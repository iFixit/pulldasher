import { STATUS_ORDER, type DerivedPull } from '../model/status';
import type { Team } from '../types';
import { Avatar, EmptyState, STATUS_LABEL } from '../components/bits';
import { Fold, Lane, RestGroup } from '../components/Lane';
import { Row, type RowOptions } from '../components/Row';
import { crSort } from './ForYou';

export function Teams({
   pulls,
   teams,
   team,
   onTeam,
   opts,
}: {
   pulls: DerivedPull[];
   teams: Team[];
   team: string | null;
   onTeam: (team: string) => void;
   opts: RowOptions;
}) {
   if (!teams.length) {
      return (
         <EmptyState
            title="No team config"
            sub="Add frontend-v2/public/teams.json (see teams.example.json) to group the board by GitHub team."
         />
      );
   }

   const memberOf = (login: string) => teams.find(t => t.members.includes(login))?.team;
   const byTeam = new Map<string, DerivedPull[]>();
   for (const t of teams) byTeam.set(t.team, []);
   byTeam.set('everyone else', []);
   for (const p of pulls) byTeam.get(memberOf(p.data.user.login) ?? 'everyone else')!.push(p);
   const nonEmpty = [...byTeam.entries()].filter(([, v]) => v.length);
   const selected = team && byTeam.get(team)?.length ? team : nonEmpty[0]?.[0];
   if (!selected) return <EmptyState title="Workbench clear" sub="No team PRs in this scope." />;

   const teamPulls = byTeam.get(selected)!;
   const members = teams.find(t => t.team === selected)?.members ?? [
      ...new Set(teamPulls.map(p => p.data.user.login)),
   ];
   const statusCounts = new Map<string, number>();
   for (const p of teamPulls) statusCounts.set(p.status, (statusCounts.get(p.status) ?? 0) + 1);

   const reviewable = crSort(
      teamPulls.filter(
         p => ['needs_cr', 'needs_recr'].includes(p.status) && p.data.user.login !== opts.me
      )
   );
   const rest = teamPulls
      .filter(p => !reviewable.includes(p))
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

   return (
      <>
         <div className="mb-4 flex flex-wrap gap-1.5">
            {nonEmpty.map(([name, v]) => (
               <button
                  key={name}
                  type="button"
                  onClick={() => onTeam(name)}
                  className={`pressable inline-flex items-center gap-1.5 rounded-lg border bg-surface px-2.5 py-[7px] text-[13px] font-medium text-ink-2 ${
                     name === selected
                        ? 'border-brand shadow-[0_0_0_1px_var(--brand)]'
                        : 'border-line hover:bg-muted'
                  }`}
               >
                  <b className="font-semibold text-ink">{name}</b>
                  <span className="text-[11px] text-ink-3 tabular-nums">{v.length}</span>
               </button>
            ))}
         </div>

         <div className="mb-4 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4">
            <span className="flex">
               {members.slice(0, 12).map(m => (
                  <Avatar key={m} login={m} size={26} />
               ))}
            </span>
            <span>
               <span className="text-base leading-snug font-semibold">{selected}</span>
               <br />
               <span className="text-xs text-ink-3">
                  {members.length} members · {teamPulls.length} open PRs
               </span>
            </span>
            <span className="ml-auto flex gap-4 text-center text-xs text-ink-3">
               {[...statusCounts.entries()].map(([status, count]) => (
                  <span key={status}>
                     <b className="block text-base font-semibold text-ink tabular-nums">{count}</b>
                     {STATUS_LABEL[status as keyof typeof STATUS_LABEL].toLowerCase()}
                  </span>
               ))}
            </span>
         </div>

         <Lane
            title="Reviewable now"
            sub="the team’s PRs waiting on review"
            pulls={reviewable}
            cap={10}
            opts={opts}
         />
         {rest.length > 0 && (
            <RestGroup>
               <Fold
                  dot="var(--ink-3)"
                  count={rest.length}
                  label="more on the team board"
                  hint="shipping, stuck, or drafts"
               >
                  {rest.slice(0, 20).map(p => (
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
