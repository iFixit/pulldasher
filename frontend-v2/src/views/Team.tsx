import { useMemo, useState, type MouseEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { authorOwnsIt, parked } from '../model/actions';
import { displayName, useNames } from '../model/names';
import type { DerivedPull } from '../model/status';
import { matchesRegion } from '../model/regions';
import { crSort } from '../model/sort';
import { teamBuckets } from '../model/team';
import { addTeam, DEFAULT_TEAM_NAME, myPeople, removeTeam, useSettings } from '../settings';
import type { BoardTeam } from '../types';
import { Avatar, EmptyState, QuietButton } from '../components/bits';
import { Icon } from '../components/Icon';
import { Fold, FoldRows, Lane, laneShown, RestGroup, SubDoor } from '../components/Lane';
import { Popover } from '../components/Popover';
import type { RowOptions } from '../components/Row';
import { TeamPicker } from '../components/TeamPicker';
import { WordGroupRows } from '../components/WordGroups';

/**
 * The people tab (named Team): every board keyed by who wrote the work,
 * starting with yours. Your rosters are the pinned first row; behind them
 * sits the whole directory — config.json teams and every author on the
 * board — so any avatar click anywhere lands here on that person's page.
 *
 * Selection here IS the authors filter: clicking a person or a team chip
 * writes the same scope the filter bar's People picker edits, so what you
 * pick is visible (and clearable) in the bar and narrows every lens the
 * same way. Plain click focuses one person or roster; shift-click keeps
 * the rest of the selection and toggles just them.
 */
export function Team({
   pulls,
   allPulls,
   teams,
   selected,
   onSelect,
   opts,
   extraBots,
}: {
   /** scoped pool (what the lanes show) */
   pulls: DerivedPull[];
   /** unscoped pool (for chip counts and owed re-stamps — filters must not
    * make the directory lie about someone's real load) */
   allPulls: DerivedPull[];
   teams: BoardTeam[];
   /** the authors scope (app.tsx) — this lens's selection is that filter */
   selected: string[];
   onSelect: (logins: string[]) => void;
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
   const { teams: personalTeams, codeRegions, hiddenPeople } = useSettings();
   const yourPeople = myPeople(personalTeams);
   const yourSet = new Set(yourPeople);
   // login -> human name for the directory chips (app.tsx prefetches the board)
   const namesMap = useNames();
   const nameOf = (login: string) => displayName(namesMap, login);
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

   // ---- selection: this lens reads and writes the authors scope ----
   const sameSet = (a: string[], b: string[]) =>
      a.length === b.length && b.every(m => a.includes(m));
   // a selection that is exactly some team's roster earns that team's name
   const selTeam = selected.length ? teams.find(t => sameSet(selected, t.members)) : undefined;
   const explicitTeam = selTeam?.team ?? null;
   const selectedPerson = !selTeam && selected.length === 1 ? selected[0] : null;
   // home = nothing selected: your rosters' aggregate board, unfiltered
   const home = selected.length === 0;
   const members = home ? yourPeople : selected;
   const isSubject = (p: DerivedPull) => members.includes(p.data.user.login);
   const theirs = pulls.filter(isSubject);
   const theirsUnscoped = allPulls.filter(isSubject);
   const scopeHides = theirsUnscoped.length - theirs.length;

   // plain click focuses one person (clicking them again unfocuses);
   // shift-click keeps the rest of the selection and toggles just them
   const toggleIn = (login: string) =>
      selected.includes(login) ? selected.filter(l => l !== login) : [...selected, login];
   const pickPerson = (login: string, e: MouseEvent) =>
      onSelect(e.shiftKey ? toggleIn(login) : sameSet(selected, [login]) ? [] : [login]);
   // team chips work the same way at roster scale: click focuses the whole
   // roster, shift-click merges it into (or carves it out of) the selection
   const pickGroup = (group: string[], e: MouseEvent) => {
      if (e.shiftKey) {
         const allIn = group.every(m => selected.includes(m));
         onSelect(
            allIn ? selected.filter(l => !group.includes(l)) : [...new Set([...selected, ...group])]
         );
      } else {
         onSelect(sameSet(selected, group) ? [] : [...group]);
      }
   };

   const { reviewable, stamped, rest } = useMemo(
      () => teamBuckets(pulls, members, me),
      // members is rebuilt per render; its join is the stable identity
      [pulls, members.join(','), me]
   );
   const regionMatches = home ? crSort(reviewable.filter(p => matchesRegion(p, codeRegions))) : [];
   const owed = selectedPerson ? (owes.get(selectedPerson) ?? []) : [];
   const memberTeam = selectedPerson
      ? teams.find(t => !t.personal && t.members.includes(selectedPerson))?.team
      : null;
   const shipping = theirs.filter(p => ['ready', 'needs_qa'].includes(p.status)).length;

   // the directory: busiest authors lead, hidden ones drop out unless the
   // current selection already includes them; your rosters' members are
   // pinned in their own row above, so they don't repeat here
   const logins = [...new Set([...counts.keys(), ...owes.keys()])]
      .filter(l => (!hiddenSet.has(l) || selected.includes(l)) && !yourSet.has(l))
      .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
   const shownLogins = allPeople ? logins : logins.slice(0, 24);

   // the door opens itself when it must: no team yet (the directory is the
   // only content), or the current pick lives outside your team (hiding the
   // chip that explains the board would orphan it)
   const personalNames = new Set(personalTeams.map(t => t.name));
   const outsidePick = selected.some(l => !yourSet.has(l));
   const directoryShown = personalTeams.length === 0 || (directoryChoice ?? outsidePick);

   const chip = (
      key: string,
      label: React.ReactNode,
      active: boolean,
      onPick: (e: MouseEvent) => void,
      title?: string
   ) => (
      <button
         key={key}
         type="button"
         onClick={onPick}
         aria-pressed={active}
         title={title}
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
   const personChip = (login: string) =>
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
         selected.includes(login),
         e => pickPerson(login, e),
         `${nameOf(login) ?? login}’s board — shift-click to add or remove them from the selection`
      );

   return (
      <>
         {/* yours, pinned: one quiet cluster per roster — its name chip, its
             members, and its own add door — so who belongs where reads as
             geometry, not memory. Creating a roster is inline on the lens
             (nothing modal to lose); an emptied roster grows a remove ×. */}
         {personalTeams.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
               {personalTeams.length > 1 &&
                  chip(
                     'your-people',
                     <>
                        <b className="pl-1 font-semibold text-ink">Everyone yours</b>
                        <span className="text-[11px] text-ink-3 tabular-nums">
                           {allPulls.filter(p => yourSet.has(p.data.user.login)).length}
                        </span>
                     </>,
                     sameSet(selected, yourPeople),
                     e => pickGroup(yourPeople, e),
                     'everyone across your rosters — click to narrow the board to them'
                  )}
               {personalTeams.map(t => (
                  <span
                     key={t.name}
                     className="inline-flex flex-wrap items-center gap-1 rounded-xl bg-muted/60 p-1"
                  >
                     {chip(
                        `mine:${t.name}`,
                        <>
                           <b className="pl-1 font-semibold text-ink">{t.name}</b>
                           <span className="text-[11px] text-ink-3 tabular-nums">
                              {allPulls.filter(p => t.members.includes(p.data.user.login)).length}
                           </span>
                        </>,
                        sameSet(selected, t.members),
                        e => pickGroup(t.members, e),
                        `narrow the board to ${t.name} — shift-click to add or remove the whole roster`
                     )}
                     {t.members.map(login => personChip(login))}
                     <Popover
                        label={`Add to ${t.name}`}
                        side="right"
                        width="w-[280px]"
                        panelClass="p-3 max-h-[60vh] overflow-auto"
                        trigger={tr => (
                           <button
                              {...tr}
                              type="button"
                              aria-label={`add someone to ${t.name}`}
                              title={`add someone to ${t.name}`}
                              className="pressable inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:text-brand"
                           >
                              <Icon icon={Plus} size={14} />
                           </button>
                        )}
                     >
                        <TeamPicker teamName={t.name} extraBots={extraBots} />
                     </Popover>
                     {t.members.length === 0 && (
                        <button
                           type="button"
                           onClick={() => removeTeam(t.name)}
                           aria-label={`delete the ${t.name} team`}
                           title={`delete the ${t.name} team`}
                           className="pressable inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:text-bad"
                        >
                           <Icon icon={Trash2} size={12} />
                        </button>
                     )}
                  </span>
               ))}
               <NewTeamChip />
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
                  .filter(t => !t.personal)
                  .map(t =>
                     chip(
                        `team:${t.team}`,
                        <>
                           <b className="pl-1 font-semibold text-ink">{t.team}</b>
                           <span className="text-[11px] text-ink-3 tabular-nums">
                              {allPulls.filter(p => t.members.includes(p.data.user.login)).length}
                           </span>
                        </>,
                        sameSet(selected, t.members),
                        e => pickGroup(t.members, e),
                        `narrow the board to ${t.team} — shift-click to add or remove the whole team`
                     )
                  )}
               {shownLogins.map(login => personChip(login))}
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

         {home && personalTeams.length === 0 && (
            <div className="mx-auto flex max-w-[440px] flex-col items-center gap-3 py-12 text-center">
               <h2 className="m-0 text-lg font-semibold text-ink">Build your team</h2>
               <p className="m-0 text-[13px] text-ink-3">
                  Pick the people whose work you review — your review circle, not the org chart.
                  Their combined board becomes this tab’s home, and their PRs lead your review
                  queues. Or click anyone above to see just their work.
               </p>
               <div className="w-full rounded-2xl border border-line bg-surface p-3 text-left">
                  <TeamPicker teamName={DEFAULT_TEAM_NAME} extraBots={extraBots} />
               </div>
            </div>
         )}

         {/* an explicit pick earns the summary card; the home board's summary
             is the member strip itself (counts and owed pips per person) */}
         {selected.length > 0 && (
            <div className="mb-4 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4">
               {selectedPerson ? (
                  <Avatar login={selectedPerson} size={38} />
               ) : (
                  <span className="flex -space-x-1.5">
                     {members.slice(0, 6).map(m => (
                        <Avatar key={m} login={m} onClick={l => onSelect([l])} />
                     ))}
                  </span>
               )}
               <span>
                  <span className="text-base leading-snug font-semibold">
                     {selectedPerson
                        ? (nameOf(selectedPerson) ?? selectedPerson)
                        : (explicitTeam ?? `${selected.length} people`)}
                  </span>
                  <br />
                  <span className="text-xs text-ink-3">
                     {memberTeam ? `${memberTeam} · ` : ''}
                     {/* the member count only earns its place under a team
                         NAME — a nameless selection's title already counts it */}
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

         {(home || (explicitTeam && personalNames.has(explicitTeam))) && scopeHides > 0 && (
            <div className="mb-3 text-xs text-warn">filters hide {scopeHides} more</div>
         )}
         {(home || (explicitTeam && personalNames.has(explicitTeam))) &&
            personalTeams.length > 0 &&
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

/**
 * The inline "start another roster" affordance: a dashed ghost chip that
 * swaps into a name field IN the lens flow — no popover involved, so there
 * is nothing to accidentally close. Enter creates the (empty) roster, which
 * appears as its own cluster with an add door ready.
 */
function NewTeamChip() {
   const [name, setName] = useState<string | null>(null);
   if (name == null) {
      return (
         <button
            type="button"
            onClick={() => setName('')}
            className="pressable inline-flex items-center gap-1 rounded-lg border border-dashed border-line bg-transparent px-2.5 py-[5px] text-[13px] font-medium text-ink-3 hover:border-brand hover:text-brand"
         >
            <Icon icon={Plus} size={12} />
            New team
         </button>
      );
   }
   const create = () => {
      const trimmed = name.trim();
      if (!trimmed) return;
      addTeam(trimmed);
      setName(null);
   };
   return (
      <span className="inline-flex items-center gap-1">
         <input
            // the field only exists because the user just asked for it;
            // focus is the point
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
               if (e.key === 'Enter') {
                  e.preventDefault();
                  create();
               } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setName(null);
               }
            }}
            placeholder="Name the team"
            aria-label="name the new team"
            className="h-8 w-[150px] rounded-lg border border-line bg-surface px-2 text-[13px]"
         />
         <QuietButton size="sm" tone="brand" disabled={!name.trim()} onClick={create}>
            Add
         </QuietButton>
      </span>
   );
}
