import { useMemo, useState, type MouseEvent } from 'react';
import { ChevronRight, Plus, Settings } from 'lucide-react';
import { authorOwnsIt, parked } from '../model/actions';
import { displayName, useNames } from '../model/names';
import type { DerivedPull } from '../model/status';
import { matchesRegion } from '../model/regions';
import { crSort } from '../model/sort';
import { teamBuckets } from '../model/team';
import { addTeam, DEFAULT_TEAM_NAME, myPeople, useSettings } from '../settings';
import { EmptyState, QuietButton } from '../components/bits';
import { Icon } from '../components/Icon';
import { Avatar } from '../components/identity';
import { Fold, FoldRows, Lane, laneShown, RestGroup, SubDoor } from '../components/Lane';
import { Popover } from '../components/Popover';
import type { RowOptions } from '../components/Row';
import { TeamPicker } from '../components/TeamPicker';
import { WordGroupRows } from '../components/WordGroups';

/** the directory fold's stable key in the open/closed set */
const DIR_KEY = '__directory__';

/**
 * The people tab (named Team): every board keyed by who wrote the work,
 * starting with yours. The header is ONE foldable roster list — a section
 * per roster (open by default, so each member's load and owed re-stamps read
 * at a glance), then the directory (every other author on the board) folded
 * beneath. No tab strip, no wrapping chip row: one column that looks the same
 * whether you have zero teams or six.
 *
 * Selection here IS the authors filter: clicking a person or a roster writes
 * the same scope the filter bar's People picker edits, so what you pick is
 * visible (and clearable) in the bar and narrows every lens the same way.
 * Plain click focuses one person or roster; shift-click keeps the rest of the
 * selection and toggles just them. A roster's gear opens its one management
 * panel — rename, members, delete — in place.
 */
export function Team({
   pulls,
   allPulls,
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
   /** the authors scope (app.tsx) — this lens's selection is that filter */
   selected: string[];
   onSelect: (logins: string[]) => void;
   opts: RowOptions;
   extraBots?: ReadonlySet<string>;
}) {
   const me = opts.me;
   const [allPeople, setAllPeople] = useState(false);
   // one foldable roster list: your teams open by default (their per-person
   // load + owed pips are the overview), the directory folded (the stranger
   // wall stays out of sight until asked). `collapsed` holds the closed keys.
   const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set([DIR_KEY]));
   const isOpen = (key: string) => !collapsed.has(key);
   const toggleOpen = (key: string) =>
      setCollapsed(s => {
         const n = new Set(s);
         if (n.has(key)) n.delete(key);
         else n.add(key);
         return n;
      });
   const { teams: personalTeams, codeRegions, hiddenPeople } = useSettings();
   const yourPeople = myPeople(personalTeams);
   const yourSet = new Set(yourPeople);
   // login -> human name for the roster rows (app.tsx prefetches the board)
   const namesMap = useNames();
   const nameOf = (login: string) => displayName(namesMap, login);
   const hiddenSet = new Set(hiddenPeople);

   // authored/owed counts read the UNSCOPED pool: a narrowed scope shouldn't
   // change what a row says about a person's real backlog
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
   // a selection that is exactly some roster earns that roster's name
   const selTeam = selected.length
      ? personalTeams.find(t => sameSet(selected, t.members))
      : undefined;
   const explicitTeam = selTeam?.name ?? null;
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
   // roster headers work the same way at roster scale: click focuses the whole
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
   const shipping = theirs.filter(p => ['ready', 'needs_qa'].includes(p.status)).length;

   // the directory: busiest authors lead, hidden ones drop out unless the
   // current selection already includes them; your rosters' members are their
   // own sections above, so they don't repeat here
   const logins = [...new Set([...counts.keys(), ...owes.keys()])]
      .filter(l => (!hiddenSet.has(l) || selected.includes(l)) && !yourSet.has(l))
      .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
   const shownLogins = allPeople ? logins : logins.slice(0, 24);
   // with no roster yet, the directory is the only content — open it
   const dirOpen = personalTeams.length === 0 ? true : isOpen(DIR_KEY);

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

   // one member row: avatar, name, open count, owed pip — the same person
   // treatment in a roster section and in the directory
   const memberRow = (login: string) => (
      <button
         key={login}
         type="button"
         onClick={e => pickPerson(login, e)}
         aria-pressed={selected.includes(login)}
         title={`${nameOf(login) ?? login}’s board — shift-click to add or remove them`}
         className={`flex w-full items-center gap-2 rounded-lg py-[5px] pr-2 pl-9 text-left text-[13px] transition-[background-color] duration-150 ease-out motion-reduce:transition-none ${
            selected.includes(login) ? 'bg-secondary' : 'hover:bg-muted'
         }`}
      >
         <Avatar login={login} />
         <span className="min-w-0 flex-1 truncate font-medium text-ink" title={login}>
            {nameOf(login) ?? login}
         </span>
         <span className="text-[11px] text-ink-3 tabular-nums">{counts.get(login) ?? 0}</span>
         {owesMark(login)}
      </button>
   );

   // the disclosure caret shared by every section header — a plain toggle,
   // never a scope gesture (the label beside it does the scoping)
   const caret = (open: boolean, onToggle: () => void, label: string) => (
      <button
         type="button"
         onClick={onToggle}
         aria-expanded={open}
         aria-label={label}
         className="pressable flex h-6 w-6 flex-none items-center justify-center rounded-md text-ink-3 hover:text-ink"
      >
         <Icon
            icon={ChevronRight}
            size={14}
            className={`transition-transform duration-150 ease-out motion-reduce:transition-none ${
               open ? 'rotate-90' : ''
            }`}
         />
      </button>
   );

   return (
      <>
         {/* the roster list: your teams (open — load + owed pips visible),
             then the directory (folded). One column, same shape at any team
             count. Every label writes the shared authors scope. */}
         <div className="mb-4 rounded-2xl border border-line bg-surface p-1.5">
            {/* no explicit "all my teams" row: the home board (nothing
                selected) already shows every roster combined, and clicking an
                active team again — or Reset in the bar — returns to it. */}
            {personalTeams.map(t => {
               const key = `team:${t.name}`;
               const open = isOpen(key);
               const active = sameSet(selected, t.members);
               const owedHere = t.members.some(m => (owes.get(m)?.length ?? 0) > 0);
               return (
                  <div key={t.name}>
                     <div className="group flex items-center gap-1">
                        {caret(
                           open,
                           () => toggleOpen(key),
                           open ? `collapse ${t.name}` : `expand ${t.name}`
                        )}
                        <button
                           type="button"
                           onClick={e => pickGroup(t.members, e)}
                           aria-pressed={active}
                           title={`narrow the board to ${t.name} — shift-click to add or remove the whole roster`}
                           className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
                              active ? 'bg-secondary' : 'hover:bg-muted'
                           }`}
                        >
                           <b className="font-semibold text-ink">{t.name}</b>
                           <span className="text-[11px] text-ink-3 tabular-nums">
                              {allPulls.filter(p => t.members.includes(p.data.user.login)).length}
                           </span>
                           {owedHere && (
                              <span
                                 aria-hidden
                                 className="h-1.5 w-1.5 flex-none rounded-full"
                                 style={{ background: 'var(--warn)' }}
                              />
                           )}
                        </button>
                        <Popover
                           label={`Manage ${t.name}`}
                           side="right"
                           width="w-[300px]"
                           panelClass="p-3 max-h-[70vh] overflow-auto"
                           trigger={tr => (
                              <button
                                 {...tr}
                                 type="button"
                                 aria-label={`manage the ${t.name} team`}
                                 title={`rename, add members, or delete ${t.name}`}
                                 className="pressable inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg text-ink-3 opacity-0 transition-opacity duration-150 hover:text-brand focus-visible:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
                              >
                                 <Icon icon={Settings} size={14} />
                              </button>
                           )}
                        >
                           <TeamPicker teamName={t.name} extraBots={extraBots} />
                        </Popover>
                     </div>
                     {open && (
                        <div className="pb-1">
                           {t.members.length === 0 ? (
                              <p className="py-1 pl-9 text-[12px] text-ink-3">
                                 No one yet — open the gear to add teammates.
                              </p>
                           ) : (
                              t.members.map(login => memberRow(login))
                           )}
                        </div>
                     )}
                  </div>
               );
            })}
            {logins.length > 0 && (
               <div>
                  <div className="flex items-center gap-1">
                     {caret(
                        dirOpen,
                        () => toggleOpen(DIR_KEY),
                        dirOpen ? 'collapse everyone else' : 'expand everyone else'
                     )}
                     <button
                        type="button"
                        onClick={() => toggleOpen(DIR_KEY)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
                     >
                        <span className="font-semibold text-ink-2">
                           {personalTeams.length ? 'Everyone else' : 'Everyone'}
                        </span>
                        <span className="text-[11px] text-ink-3 tabular-nums">{logins.length}</span>
                     </button>
                  </div>
                  {dirOpen && (
                     <div className="pb-1">
                        {shownLogins.map(login => memberRow(login))}
                        {!allPeople && logins.length > 24 && (
                           <button
                              type="button"
                              onClick={() => setAllPeople(true)}
                              className="pressable py-[5px] pl-9 text-[13px] font-medium text-ink-3 hover:text-brand"
                           >
                              + {logins.length - 24} more
                           </button>
                        )}
                     </div>
                  )}
               </div>
            )}
            {personalTeams.length > 0 && (
               <div className="px-1 pt-1">
                  <NewTeamChip />
               </div>
            )}
         </div>

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
             is the roster list itself (counts and owed pips per person) */}
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

         {(home || explicitTeam) && scopeHides > 0 && (
            <div className="mb-3 text-xs text-warn">filters hide {scopeHides} more</div>
         )}
         {(home || explicitTeam) &&
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
 * appears as its own section with a gear ready.
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
