import { useMemo } from 'react';
import { authorOwnsIt } from '../model/actions';
import type { DerivedPull } from '../model/status';
import { matchesRegion } from '../model/regions';
import { crSort } from '../model/sort';
import { teamBuckets } from '../model/team';
import { useSettings } from '../settings';
import { Avatar, EmptyState } from '../components/bits';
import { Fold, FoldRows, Lane, RestGroup, SubDoor } from '../components/Lane';
import { Popover } from '../components/Popover';
import type { RowOptions } from '../components/Row';
import { TeamPicker } from '../components/TeamPicker';

/**
 * The team lens: your own pick of teammates (Settings → Your team), not a
 * GitHub team. Empty state onboards straight into the picker; once you've
 * picked people it's a mini review board scoped to just them — the same
 * reviewable/stamped/rest split People.tsx uses for one person, generalized
 * to the whole list (see model/team.ts).
 */
export function Team({
   pulls,
   allPulls,
   me,
   opts,
   onPerson,
   extraBots,
}: {
   /** scoped pool (what the lanes show) */
   pulls: DerivedPull[];
   /** unscoped pool (for the member strip's counts and the scope-hides note) */
   allPulls: DerivedPull[];
   me: string;
   opts: RowOptions;
   onPerson: (login: string) => void;
   extraBots?: ReadonlySet<string>;
}) {
   const { myTeam, codeRegions } = useSettings();

   // authored/owed counts read the UNSCOPED pool, same as People.tsx — a
   // narrowed scope shouldn't make the member strip lie about the team's
   // real backlog.
   const authored = useMemo(() => {
      const m = new Map<string, number>();
      for (const p of allPulls) m.set(p.data.user.login, (m.get(p.data.user.login) ?? 0) + 1);
      return m;
   }, [allPulls]);
   const owes = useMemo(() => {
      const m = new Map<string, DerivedPull[]>();
      for (const p of allPulls.filter(x => !authorOwnsIt(x))) for (const u of p.recrBy) m.set(u, [...(m.get(u) ?? []), p]);
      return m;
   }, [allPulls]);

   const theirsUnscoped = useMemo(
      () => allPulls.filter(p => myTeam.includes(p.data.user.login)),
      [allPulls, myTeam]
   );
   const theirs = useMemo(
      () => pulls.filter(p => myTeam.includes(p.data.user.login)),
      [pulls, myTeam]
   );
   const scopeHides = theirsUnscoped.length - theirs.length;

   const { reviewable, stamped, rest } = useMemo(
      () => teamBuckets(pulls, myTeam, me),
      [pulls, myTeam, me]
   );
   const regionMatches = crSort(reviewable.filter(p => matchesRegion(p, codeRegions)));

   if (myTeam.length === 0) {
      return (
         <div className="mx-auto flex max-w-[440px] flex-col items-center gap-3 py-16 text-center">
            <h2 className="m-0 text-lg font-semibold text-ink">Build your team</h2>
            <p className="m-0 text-[13px] text-ink-3">
               Pick the people whose work you review, the Team view and the “Your team” filter
               follow this list.
            </p>
            <div className="w-full rounded-2xl border border-line bg-surface p-3 text-left">
               <TeamPicker extraBots={extraBots} />
            </div>
         </div>
      );
   }

   return (
      <>
         <div className="mb-4 flex flex-wrap items-center gap-1.5">
            {myTeam.map(login => (
               <button
                  key={login}
                  type="button"
                  onClick={() => onPerson(login)}
                  className="pressable inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface py-[5px] pr-2.5 pl-1.5 text-[13px] font-medium text-ink-2 hover:bg-muted"
               >
                  <Avatar login={login} size={22} />
                  <b className="font-semibold text-ink">{login}</b>
                  <span className="text-[11px] text-ink-3 tabular-nums">
                     {authored.get(login) ?? 0}
                  </span>
                  {(owes.get(login)?.length ?? 0) > 0 && (
                     <span
                        className="inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums"
                        style={{ color: 'var(--warn)' }}
                        title={`owes ${owes.get(login)!.length} re-stamp${
                           owes.get(login)!.length === 1 ? '' : 's'
                        }`}
                     >
                        <span className="pip pip-stale" />
                        {owes.get(login)!.length}
                     </span>
                  )}
               </button>
            ))}
            <Popover
               label="Edit your team"
               side="right"
               width="w-[280px]"
               panelClass="p-3 max-h-[60vh] overflow-auto"
               trigger={t => (
                  <button
                     {...t}
                     type="button"
                     className="pressable inline-flex h-8 items-center rounded-lg border border-line bg-surface px-2.5 text-[13px] font-medium text-ink-3 hover:text-brand"
                  >
                     Edit
                  </button>
               )}
            >
               <TeamPicker extraBots={extraBots} />
            </Popover>
         </div>

         {scopeHides > 0 && (
            <div className="mb-3 text-xs text-warn">filters hide {scopeHides} more</div>
         )}

         {reviewable.length === 0 && stamped.length === 0 && rest.length === 0 && (
            <EmptyState title="All clear" sub="Nothing open from your team right now." />
         )}

         {codeRegions.length > 0 && regionMatches.length > 0 && (
            <Lane
               title="In your code regions"
               sub={
                  <SubDoor label="How code regions match" text="areas you flagged in Settings">
                     <p>
                        A PR lands here when its title, description, labels, branch, or repo
                        contains one of your regions. Plain text, case-insensitive, no regex.
                     </p>
                  </SubDoor>
               }
               pulls={regionMatches}
               cap={8}
               // the lane heading already says "this is your region," so the
               // row-level region mark would just repeat it
               opts={{ ...opts, hideRegionMark: true }}
            />
         )}
         <Lane
            title="Review your team's work"
            sub={
               <SubDoor label="How this queue is ordered" text="best next review first">
                  <p>
                     Lightest first, so a short break fits a review. A PR that needs just one more
                     approval jumps up (yours would finish it), and PRs move up as they wait. PRs
                     the author is still actively pushing to sink to the bottom.
                  </p>
               </SubDoor>
            }
            pulls={reviewable}
            cap={9}
            opts={opts}
         />
         {(stamped.length > 0 || rest.length > 0) && (
            <RestGroup>
               <Fold
                  dot="var(--ok)"
                  count={stamped.length}
                  label="you've stamped"
                  hint="waiting on another reviewer"
                  id="team:stamped"
               >
                  <FoldRows list={stamped} opts={opts} id="team:stamped" />
               </Fold>
               <Fold dot="var(--ink-3)" count={rest.length} label="their other PRs" id="team:rest">
                  <FoldRows list={rest} opts={opts} id="team:rest" />
               </Fold>
            </RestGroup>
         )}
      </>
   );
}
