import { useState } from 'react';
import { STATUS_ORDER, type DerivedPull } from '../model/status';
import type { Team } from '../types';
import { Avatar } from '../components/bits';
import { Fold, FoldRows, Lane, RestGroup } from '../components/Lane';
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
   const counts = new Map<string, number>();
   for (const p of allPulls)
      counts.set(p.data.user.login, (counts.get(p.data.user.login) ?? 0) + 1);
   const owes = new Map<string, DerivedPull[]>();
   for (const p of allPulls) for (const u of p.recrBy) owes.set(u, [...(owes.get(u) ?? []), p]);

   const logins = [...new Set([...counts.keys(), ...owes.keys()])].sort(
      (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0)
   );

   // an explicit pick always wins, even with zero open PRs — silently
   // showing someone else's board mid-conversation is worse than an empty one.
   // The default skips yourself: you can't review your own PRs.
   const defaultPerson = logins.find(l => l !== opts.me) ?? logins[0];
   const selectedTeam = team && teams.some(t => t.team === team) ? team : null;
   const selectedPerson = selectedTeam ? null : (person ?? defaultPerson);
   if (!selectedPerson && !selectedTeam) return null;

   const members = selectedTeam
      ? (teams.find(t => t.team === selectedTeam)?.members ?? [])
      : [selectedPerson as string];
   const isSubject = (p: DerivedPull) => members.includes(p.data.user.login);

   const theirs = pulls.filter(isSubject);
   const theirsUnscoped = allPulls.filter(isSubject);
   const owed = selectedPerson ? (owes.get(selectedPerson) ?? []) : [];
   const reviewable = crSort(
      theirs.filter(
         p =>
            ['needs_cr', 'needs_recr'].includes(p.status) &&
            p.data.user.login !== opts.me &&
            !p.crBy.includes(opts.me) &&
            !p.recrBy.includes(opts.me)
      )
   );
   const mine = theirs.filter(
      p =>
         ['needs_cr', 'needs_recr'].includes(p.status) &&
         p.data.user.login !== opts.me &&
         (p.crBy.includes(opts.me) || p.recrBy.includes(opts.me))
   );
   const rest = theirs
      .filter(p => !reviewable.includes(p) && !mine.includes(p))
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
            active ? 'border-brand shadow-[0_0_0_1px_var(--brand)]' : 'border-line hover:bg-muted'
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
                           className="text-[11px] font-semibold tabular-nums"
                           style={{ color: 'var(--warn)' }}
                           title={`owes ${owes.get(login)!.length} re-stamp${
                              owes.get(login)!.length === 1 ? '' : 's'
                           }`}
                        >
                           ⊘{owes.get(login)!.length}
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
                  {theirs.length} open {theirs.length === 1 ? 'PR' : 'PRs'}
                  {scopeHides > 0 && (
                     <span className="text-warn"> · scope hides {scopeHides} more</span>
                  )}
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
                  ready or in QA
               </span>
               {selectedPerson && (
                  <span>
                     <b className="block text-base font-semibold text-ink tabular-nums">
                        {owed.length}
                     </b>
                     {owed.length === 1 ? 're-stamp owed' : 're-stamps owed'}
                  </span>
               )}
            </span>
         </div>

         <Lane
            title="Review queue"
            sub="waiting on review, lightest first"
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
               >
                  <FoldRows list={mine} opts={opts} />
               </Fold>
               <Fold
                  dot="var(--ink-3)"
                  count={rest.length}
                  label={selectedTeam ? 'their other team PRs' : 'their other PRs'}
                  hint="their move or waiting"
               >
                  <FoldRows list={rest} opts={opts} />
               </Fold>
               {selectedPerson && (
                  <Fold
                     dot="var(--brand)"
                     count={owed.length}
                     label="re-stamps they owe others"
                     hint="worth a nudge"
                  >
                     <FoldRows list={owed} opts={opts} />
                  </Fold>
               )}
            </RestGroup>
         )}
      </>
   );
}
