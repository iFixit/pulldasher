import { useMemo, useState } from 'react';
import { authorOwnsIt, parked } from '../model/actions';
import { displayName, useNames } from '../model/names';
import type { DerivedPull } from '../model/status';
import { matchesRegion } from '../model/regions';
import { crSort } from '../model/sort';
import { teamBuckets } from '../model/team';
import { useSettings } from '../settings';
import type { Team as TeamGroup } from '../types';
import { Avatar, EmptyState } from '../components/bits';
import { Fold, FoldRows, Lane, laneShown, RestGroup, SubDoor } from '../components/Lane';
import { Popover } from '../components/Popover';
import type { RowOptions } from '../components/Row';
import { TeamPicker } from '../components/TeamPicker';
import { WordGroupRows } from '../components/WordGroups';

/**
 * The people tab (named Team): every board keyed by who wrote the work,
 * starting with yours. Your picked team is the pinned first row and its
 * aggregate board is the tab's home; behind it sits the whole directory —
 * config.json teams and every author on the board — so any avatar click
 * anywhere lands here on that person's page. One body serves all three
 * selections (your team / a person / a GitHub team) through the same
 * teamBuckets split, which is why the former separate People tab merged in:
 * it was this view with a different picker.
 */
export function Team({
   pulls,
   allPulls,
   teams,
   person,
   team,
   onPerson,
   onTeam,
   onHome,
   opts,
   extraBots,
}: {
   /** scoped pool (what the lanes show) */
   pulls: DerivedPull[];
   /** unscoped pool (for chip counts and owed re-stamps — filters must not
    * make the directory lie about someone's real load) */
   allPulls: DerivedPull[];
   teams: TeamGroup[];
   person: string | null;
   team: string | null;
   onPerson: (login: string) => void;
   onTeam: (team: string) => void;
   /** clear any selection: back to your team's aggregate board */
   onHome: () => void;
   opts: RowOptions;
   extraBots?: ReadonlySet<string>;
}) {
   const me = opts.me;
   const [allPeople, setAllPeople] = useState(false);
   // the directory rests behind a door: your team is the tab's home, and
   // thirty stranger-chips standing above it outweighed the content. null =
   // no explicit choice (the door follows the selection); true/false = the
   // user's own toggle for this visit
   const [directoryChoice, setDirectoryChoice] = useState<boolean | null>(null);
   const { myTeam, codeRegions, starredPeople, hiddenPeople } = useSettings();
   // login -> human name for the directory chips (app.tsx prefetches the board)
   const namesMap = useNames();
   const nameOf = (login: string) => displayName(namesMap, login);
   const starredSet = new Set(starredPeople);
   const hiddenSet = new Set(hiddenPeople);

   // authored/owed counts read the UNSCOPED pool: a narrowed scope shouldn't
   // change what a chip says about a person's real backlog
   const counts = useMemo(() => {
      const m = new Map<string, number>();
      for (const p of allPulls) m.set(p.data.user.login, (m.get(p.data.user.login) ?? 0) + 1);
      return m;
   }, [allPulls]);
   const owes = useMemo(() => {
      const m = new Map<string, DerivedPull[]>();
      for (const p of allPulls.filter(x => !parked(x) && !authorOwnsIt(x)))
         for (const u of p.recrBy) m.set(u, [...(m.get(u) ?? []), p]);
      return m;
   }, [allPulls]);

   // ---- selection: an explicit pick from the hash, else your team's board ----
   const explicitTeam = team && teams.some(t => t.team === team) ? team : null;
   const selectedPerson = explicitTeam ? null : person;
   // home = the tab with nothing picked; with a team configured that IS the
   // "Your team" board, without one it's the build-your-team invitation
   const home = !explicitTeam && !selectedPerson;
   const selectedTeam = explicitTeam ?? (home && myTeam.length > 0 ? 'Your team' : null);

   const members = selectedPerson
      ? [selectedPerson]
      : selectedTeam
        ? (teams.find(t => t.team === selectedTeam)?.members ?? [])
        : [];
   const isSubject = (p: DerivedPull) => members.includes(p.data.user.login);
   const theirs = pulls.filter(isSubject);
   const theirsUnscoped = allPulls.filter(isSubject);
   const scopeHides = theirsUnscoped.length - theirs.length;

   const { reviewable, stamped, rest } = useMemo(
      () => teamBuckets(pulls, members, me),
      // members is rebuilt per render; its join is the stable identity
      [pulls, members.join(','), me]
   );
   const regionMatches = home ? crSort(reviewable.filter(p => matchesRegion(p, codeRegions))) : [];
   const owed = selectedPerson ? (owes.get(selectedPerson) ?? []) : [];
   const memberTeam = selectedPerson
      ? teams.find(t => t.team !== 'Your team' && t.members.includes(selectedPerson))?.team
      : null;
   const shipping = theirs.filter(p => ['ready', 'needs_qa'].includes(p.status)).length;

   // the directory: starred people lead, hidden ones drop out unless an
   // explicit pick (a URL or a click) already landed on them; your team's
   // members are pinned in their own row above, so they don't repeat here
   const logins = [...new Set([...counts.keys(), ...owes.keys()])]
      .filter(l => (!hiddenSet.has(l) || l === selectedPerson) && !myTeam.includes(l))
      .sort(
         (a, b) =>
            Number(starredSet.has(b)) - Number(starredSet.has(a)) ||
            (counts.get(b) ?? 0) - (counts.get(a) ?? 0)
      );
   const shownLogins = allPeople ? logins : logins.slice(0, 24);

   // the door opens itself when it must: no team yet (the directory is the
   // only content), or the current pick lives outside your team (hiding the
   // chip that explains the board would orphan it)
   const outsidePick =
      !!explicitTeam || (!!selectedPerson && !myTeam.includes(selectedPerson));
   const directoryShown = myTeam.length === 0 || (directoryChoice ?? outsidePick);

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
   const owesMark = (login: string) =>
      (owes.get(login)?.length ?? 0) > 0 && (
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
      );
   const personChip = (login: string, active: boolean) =>
      chip(
         login,
         <>
            <Avatar login={login} />
            <b className="font-semibold text-ink" title={login}>
               {nameOf(login) ?? login}
            </b>
            <span className="text-[11px] text-ink-3 tabular-nums">{counts.get(login) ?? 0}</span>
            {owesMark(login)}
         </>,
         active,
         () => onPerson(login)
      );

   return (
      <>
         {/* yours, pinned: the aggregate board chip, each member, and the picker */}
         {myTeam.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
               {chip(
                  'your-team',
                  <>
                     <b className="pl-1 font-semibold text-ink">Your team</b>
                     <span className="text-[11px] text-ink-3 tabular-nums">
                        {allPulls.filter(p => myTeam.includes(p.data.user.login)).length}
                     </span>
                  </>,
                  selectedTeam === 'Your team',
                  onHome
               )}
               {myTeam.map(login => personChip(login, login === selectedPerson))}
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
               <button
                  type="button"
                  aria-expanded={directoryShown}
                  onClick={() => setDirectoryChoice(!directoryShown)}
                  className="pressable ml-auto inline-flex items-center rounded-lg border border-line bg-surface px-2.5 py-[5px] text-[13px] font-medium text-ink-3 hover:text-brand"
               >
                  Everyone
                  <span className="pl-1.5 text-[11px] tabular-nums">{logins.length}</span>
               </button>
            </div>
         )}
         {/* the rest of the directory: config teams, then everyone else —
             behind the Everyone door unless it must stand (see above) */}
         {directoryShown && (
         <div className="mb-4 flex flex-wrap gap-1.5">
            {teams
               .filter(t => t.team !== 'Your team')
               .map(t =>
                  chip(
                     `team:${t.team}`,
                     <>
                        <b className="pl-1 font-semibold text-ink">{t.team}</b>
                        <span className="text-[11px] text-ink-3 tabular-nums">
                           {allPulls.filter(p => t.members.includes(p.data.user.login)).length}
                        </span>
                     </>,
                     t.team === explicitTeam,
                     () => onTeam(t.team)
                  )
               )}
            {shownLogins.map(login => personChip(login, login === selectedPerson))}
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
         )}

         {home && myTeam.length === 0 && (
            <div className="mx-auto flex max-w-[440px] flex-col items-center gap-3 py-12 text-center">
               <h2 className="m-0 text-lg font-semibold text-ink">Build your team</h2>
               <p className="m-0 text-[13px] text-ink-3">
                  Pick the people whose work you review; their combined board becomes this tab’s
                  home. Or click anyone above to see just their work.
               </p>
               <div className="w-full rounded-2xl border border-line bg-surface p-3 text-left">
                  <TeamPicker extraBots={extraBots} />
               </div>
            </div>
         )}

         {/* an explicit pick earns the summary card; the home board's summary
             is the member strip itself (counts and owed pips per person) */}
         {(selectedPerson || explicitTeam) && (
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
                     {selectedPerson ?? explicitTeam}
                  </span>
                  <br />
                  <span className="text-xs text-ink-3">
                     {memberTeam ? `${memberTeam} · ` : ''}
                     {explicitTeam ? `${members.length} members · ` : ''}
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
         )}

         {selectedTeam === 'Your team' && scopeHides > 0 && (
            <div className="mb-3 text-xs text-warn">filters hide {scopeHides} more</div>
         )}
         {selectedTeam === 'Your team' &&
            reviewable.length === 0 &&
            stamped.length === 0 &&
            rest.length === 0 && (
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
            title="Review queue"
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
         {/* everything not in the queue, split by the same words the Review
             lens groups on — a live stamp of yours emerges as the "stamped"
             group instead of needing its own hand-made fold */}
         {(stamped.length > 0 || rest.length > 0 || owed.length > 0) && (
            <RestGroup title="The rest of their work">
               <WordGroupRows
                  pulls={[...stamped, ...rest]}
                  opts={opts}
                  id="team:rest"
                  cap={laneShown(30, opts)}
                  foldDefaultOpen={false}
               />
               {selectedPerson && (
                  <Fold
                     count={owed.length}
                     label="Re-stamps they owe"
                     gloss="Their earlier approval went stale after new commits; a fresh re-stamp from them is owed to the author."
                     id="team:owed"
                  >
                     <FoldRows list={owed} opts={opts} id="team:owed" />
                  </Fold>
               )}
            </RestGroup>
         )}
      </>
   );
}
