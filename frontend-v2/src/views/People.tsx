import { useState } from 'react';
import { STATUS_ORDER, type DerivedPull } from '../model/status';
import { useSettings } from '../settings';
import type { Team } from '../types';
import { Avatar, EmptyState } from '../components/bits';
import { Fold, FoldRows, Lane, RestGroup, SubDoor } from '../components/Lane';
import type { RowOptions } from '../components/Row';
import { crSort } from '../model/sort';

/**
 * The directory: one tab, pick a person OR a team, same board below.
 * (Teams used to be its own tab — structurally a clone of this view minus
 * the person-only data, so the two merged.)
 */
export function People({
   pulls,
   allPulls,
   teams,
   person,
   team,
   onPerson,
   onTeam,
   opts,
}: {
   /** scoped pool (what the lanes show) */
   pulls: DerivedPull[];
   /** unscoped pool (for the picker counts and owed re-stamps) */
   allPulls: DerivedPull[];
   teams: Team[];
   person: string | null;
   team: string | null;
   onPerson: (login: string) => void;
   onTeam: (team: string) => void;
   opts: RowOptions;
}) {
   const [allPeople, setAllPeople] = useState(false);
   const { starredPeople, mutedPeople } = useSettings();
   const starredSet = new Set(starredPeople);
   const mutedSet = new Set(mutedPeople);
   const counts = new Map<string, number>();
   for (const p of allPulls)
      counts.set(p.data.user.login, (counts.get(p.data.user.login) ?? 0) + 1);
   const owes = new Map<string, DerivedPull[]>();
   for (const p of allPulls) for (const u of p.recrBy) owes.set(u, [...(owes.get(u) ?? []), p]);

   // starred people lead the directory; muted ones drop out entirely unless
   // they're the person an explicit pick (a URL or a click) already landed on
   const logins = [...new Set([...counts.keys(), ...owes.keys()])]
      .filter(l => !mutedSet.has(l) || l === person)
      .sort(
         (a, b) =>
            Number(starredSet.has(b)) - Number(starredSet.has(a)) ||
            (counts.get(b) ?? 0) - (counts.get(a) ?? 0)
      );

   // an explicit pick always wins, even with zero open PRs — silently
   // showing someone else's board mid-conversation is worse than an empty one.
   // The default skips yourself: you can't review your own PRs.
   const defaultPerson = logins.find(l => l !== opts.me) ?? logins[0];
   const selectedTeam = team && teams.some(t => t.team === team) ? team : null;
   const selectedPerson = selectedTeam ? null : (person ?? defaultPerson);
   if (!selectedPerson && !selectedTeam) {
      return <EmptyState title="Nobody to show" sub="No open PRs from any person matching your filters." />;
   }

   const members = selectedTeam
      ? (teams.find(t => t.team === selectedTeam)?.members ?? [])
      : [selectedPerson as string];
   const isSubject = (p: DerivedPull) => members.includes(p.data.user.login);

   const theirs = pulls.filter(isSubject);
   const theirsUnscoped = allPulls.filter(isSubject);
   const owed = selectedPerson ? (owes.get(selectedPerson) ?? []) : [];
   // Live vs stale stamp split (same rule as teamBuckets): a stale stamp of
   // yours (recrBy) leaves the PR at 0-of-1, still reviewable by you or anyone
   // else, so it stays in `reviewable`. Only a live stamp (crBy) is "stamped,
   // waiting on another reviewer".
   const reviewable = crSort(
      theirs.filter(
         p =>
            ['needs_cr', 'needs_recr'].includes(p.status) &&
            p.data.user.login !== opts.me &&
            !p.crBy.includes(opts.me)
      )
   );
   const mine = theirs.filter(
      p =>
         ['needs_cr', 'needs_recr'].includes(p.status) &&
         p.data.user.login !== opts.me &&
         p.crBy.includes(opts.me)
   );
   const inLane = new Set([...reviewable, ...mine]);
   const rest = theirs
      .filter(p => !inLane.has(p))
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
   const memberTeam = selectedPerson
      ? teams.find(t => t.members.includes(selectedPerson))?.team
      : null;
   const shipping = theirs.filter(p => ['ready', 'needs_qa'].includes(p.status)).length;
   const scopeHides = theirsUnscoped.length - theirs.length;

   const chip = (key: string, label: React.ReactNode, active: boolean, onPick: () => void) => (
      <button
         key={key}
         type="button"
         onClick={onPick}
         aria-pressed={active}
         className={`pressable inline-flex items-center gap-1.5 rounded-lg border bg-surface py-[5px] pr-2.5 pl-1.5 text-[13px] font-medium text-ink-2 ${
            active
               ? 'border-brand shadow-[0_0_0_1px_var(--brand)] hover:bg-muted'
               : 'border-line hover:bg-muted'
         }`}
      >
         {label}
      </button>
   );

   const shownLogins = allPeople ? logins : logins.slice(0, 24);

   return (
      <>
         {teams.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
               {teams.map(t =>
                  chip(
                     `team:${t.team}`,
                     <>
                        <b className="pl-1 font-semibold text-ink">{t.team}</b>
                        <span className="text-[11px] text-ink-3 tabular-nums">
                           {allPulls.filter(p => t.members.includes(p.data.user.login)).length}
                        </span>
                     </>,
                     t.team === selectedTeam,
                     () => onTeam(t.team)
                  )
               )}
            </div>
         )}
         <div className="mb-4 flex flex-wrap gap-1.5">
            {shownLogins.map(login =>
               chip(
                  login,
                  <>
                     <Avatar login={login} />
                     <b className="font-semibold text-ink">{login}</b>
                     <span className="text-[11px] text-ink-3 tabular-nums">
                        {counts.get(login) ?? 0}
                     </span>
                     {/* the lead roll-up: who owes re-stamps, without clicking
                         through 30 people */}
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
                  </>,
                  login === selectedPerson,
                  () => onPerson(login)
               )
            )}
            {!allPeople && logins.length > 24 && (
               <button
                  type="button"
                  onClick={() => setAllPeople(true)}
                  className="pressable inline-flex items-center rounded-lg border border-line bg-surface px-2.5 py-[5px] text-[13px] font-medium text-ink-3 hover:text-brand"
               >
                  + {logins.length - 24} more
               </button>
            )}
         </div>

         <div className="mb-4 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4">
            {selectedPerson ? (
               <Avatar login={selectedPerson} size={38} />
            ) : (
               <span className="flex -space-x-1.5">
                  {members.slice(0, 6).map(m => (
                     <Avatar key={m} login={m} onClick={onPerson} />
                  ))}
               </span>
            )}
            <span>
               <span className="text-base leading-snug font-semibold">
                  {selectedPerson ?? selectedTeam}
               </span>
               <br />
               <span className="text-xs text-ink-3">
                  {memberTeam ? `${memberTeam} · ` : ''}
                  {selectedTeam ? `${members.length} members · ` : ''}
                  {theirs.length === 0
                     ? 'nothing open right now'
                     : `${theirs.length} open ${theirs.length === 1 ? 'PR' : 'PRs'}`}
                  {scopeHides > 0 && (
                     <span className="text-warn"> · filters hide {scopeHides} more</span>
                  )}
               </span>
            </span>
            <span className="ml-auto flex gap-4 text-center text-xs text-ink-3">
               <span>
                  <b className="block text-base text-ink-2 tabular-nums">{reviewable.length}</b>
                  you can review
               </span>
               <span>
                  <b className="block text-base text-ink-2 tabular-nums">{shipping}</b>
                  ready or in QA
               </span>
               {selectedPerson && (
                  <span>
                     <b className="block text-base text-ink-2 tabular-nums">{owed.length}</b>
                     {owed.length === 1 ? 're-stamp owed' : 're-stamps owed'}
                  </span>
               )}
            </span>
         </div>

         <Lane
            title="Review queue"
            sub={
               <SubDoor label="How this queue is ordered" text="best next review first">
                  <p>
                     Lightest first, so a short break fits a review. A PR that needs just one
                     more approval jumps up (yours would finish it), and PRs move up as they
                     wait. PRs the author is still actively pushing to sink to the bottom.
                  </p>
               </SubDoor>
            }
            pulls={reviewable}
            cap={8}
            opts={opts}
         />
         {(rest.length > 0 || owed.length > 0 || mine.length > 0) && (
            <RestGroup>
               <Fold
                  dot="var(--ok)"
                  count={mine.length}
                  label="stamped by you"
                  hint="waiting on another reviewer"
                  id="people:mine"
               >
                  <FoldRows list={mine} opts={opts} id="people:mine" />
               </Fold>
               <Fold
                  dot="var(--ink-3)"
                  count={rest.length}
                  label={selectedTeam ? 'their other team PRs' : 'their other PRs'}
                  id="people:rest"
               >
                  <FoldRows list={rest} opts={opts} id="people:rest" />
               </Fold>
               {selectedPerson && (
                  <Fold
                     dot="var(--warn)"
                     count={owed.length}
                     label="re-stamps they owe others"
                     id="people:owed"
                  >
                     <FoldRows list={owed} opts={opts} id="people:owed" />
                  </Fold>
               )}
            </RestGroup>
         )}
      </>
   );
}
