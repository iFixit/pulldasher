import { useMemo, useState } from 'react';
import { displayName, useNames } from '../model/names';
import { isBotLogin } from '../model/visibility';
import { addTeam, DEFAULT_TEAM_NAME, removeTeam, toggleTeammate, useSettings } from '../settings';
import { usePulldasher } from '../store';
import { Avatar, QuietButton } from './bits';
import { FilterSearch } from './filters/shared';

const SUGGESTION_CAP = 12;
const EMPTY_BOTS: ReadonlySet<string> = new Set();

/** One row: checkbox + avatar + name (+ optional trailing count), the same
 * shape the Filters people tab uses so a teammate row reads identically
 * wherever it appears. */
function CandidateRow({
   login,
   name,
   count,
   checked,
   self,
   onToggle,
}: {
   login: string;
   /** human display name, when known (model/names.ts) */
   name?: string | null;
   count?: number;
   checked: boolean;
   self?: boolean;
   onToggle: () => void;
}) {
   return (
      <label className="flex items-center gap-2 rounded-md px-1.5 py-[5px] text-[13px] transition-[background-color] duration-150 ease-out hover:bg-muted motion-reduce:transition-none">
         <input
            type="checkbox"
            className="m-0"
            checked={checked}
            onChange={onToggle}
            aria-label={checked ? `remove ${login} from this team` : `add ${login} to this team`}
         />
         <Avatar login={login} size={18} />
         <span title={login} className="min-w-0 flex-1 truncate">
            {name ?? login}
            {self && <span className="ml-1 text-[11px] text-ink-3">(you)</span>}
         </span>
         {count != null && (
            <span className="text-[11px] text-ink-3 tabular-nums">{count || ''}</span>
         )}
      </label>
   );
}

/** Every author and signer on the board — the login universe a teammate can
 * be picked from — with an open-PR count for sorting. Bots are excluded (a
 * dependency bot never reviews anything); you are not — some people want their
 * own PRs to ride along in the Team view, so you can tick yourself. */
function useCandidates(extraBots: ReadonlySet<string>) {
   const { pulls } = usePulldasher();
   return useMemo(() => {
      const counts = new Map<string, number>();
      const known = new Set<string>();
      for (const p of pulls) {
         const login = p.data.user.login;
         known.add(login);
         counts.set(login, (counts.get(login) ?? 0) + 1);
         for (const sig of [...p.data.status.allCR, ...p.data.status.allQA]) {
            known.add(sig.data.user.login);
         }
      }
      return [...known]
         .filter(login => !isBotLogin(login, extraBots))
         .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b))
         .map(login => ({ login, count: counts.get(login) ?? 0 }));
   }, [pulls, extraBots]);
}

/**
 * The roster editor: pick which roster you're editing (or start a new one),
 * current members first (uncheck to remove), then a searchable, capped list
 * of everyone else on the board. Typing a login with no match on the board
 * still lets you add it — a teammate can have nothing open right now.
 * Standalone so the Team view's empty state can embed it without any drawer
 * chrome around it.
 */
export function TeamPicker({ extraBots = EMPTY_BOTS }: { extraBots?: ReadonlySet<string> }) {
   const { teams } = useSettings();
   const { me } = usePulldasher();
   const candidates = useCandidates(extraBots);
   const [query, setQuery] = useState('');
   // which roster the checkboxes edit. Kept as a name, not an index, so a
   // removal elsewhere can't silently retarget the checkboxes; a stale pick
   // falls back to the first roster (or the default-to-be when none exists).
   const [picked, setPicked] = useState('');
   const [newName, setNewName] = useState<string | null>(null);
   const activeName = teams.some(t => t.name === picked)
      ? picked
      : (teams[0]?.name ?? DEFAULT_TEAM_NAME);
   const active = teams.find(t => t.name === activeName);
   const activeMembers = active?.members ?? [];

   // search by handle OR human name — "metz" should find djmetzle
   const namesMap = useNames();
   const nameOf = (login: string) => displayName(namesMap, login);

   const members = new Set(activeMembers);
   const trimmed = query.trim();
   const needle = trimmed.toLowerCase();
   const available = candidates.filter(c => !members.has(c.login));
   const filtered = needle
      ? available.filter(
           c =>
              c.login.toLowerCase().includes(needle) ||
              (nameOf(c.login) ?? '').toLowerCase().includes(needle)
        )
      : available.slice(0, SUGGESTION_CAP);

   const exactMatch =
      !!trimmed && (members.has(trimmed) || candidates.some(c => c.login.toLowerCase() === needle));

   const createTeam = () => {
      const name = (newName ?? '').trim();
      if (!name) return;
      addTeam(name);
      setPicked(name);
      setNewName(null);
   };

   return (
      <div>
         <p className="px-1.5 pb-1.5 text-[11px] leading-snug text-ink-3">
            Your review circles, not the org chart — anyone whose work you review belongs here.
            Everyone on any of your rosters leads your review queues; each roster is also its own
            board on this tab.
         </p>
         {teams.length > 1 && (
            <div className="mb-1.5 flex flex-wrap items-center gap-1 px-1">
               {teams.map(t => (
                  <button
                     key={t.name}
                     type="button"
                     aria-pressed={t.name === activeName}
                     onClick={() => setPicked(t.name)}
                     className={`pressable rounded-lg border px-2 py-[3px] text-xs font-medium ${
                        t.name === activeName
                           ? 'border-brand bg-surface text-brand-700'
                           : 'border-line bg-surface text-ink-2 hover:border-brand hover:text-brand'
                     }`}
                  >
                     {t.name}
                  </button>
               ))}
            </div>
         )}
         {newName != null ? (
            <div className="mb-1.5 flex items-center gap-1.5 px-1">
               <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => {
                     if (e.key === 'Enter') createTeam();
                     if (e.key === 'Escape') setNewName(null);
                  }}
                  placeholder="Name the new team"
                  aria-label="name the new team"
                  className="h-7 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-[13px]"
               />
               <QuietButton size="sm" tone="brand" onClick={createTeam} disabled={!newName.trim()}>
                  Add
               </QuietButton>
            </div>
         ) : (
            teams.length > 0 && (
               <div className="mb-1.5 px-1">
                  <button
                     type="button"
                     onClick={() => setNewName('')}
                     className="hit pressable rounded px-0.5 text-[11px] font-medium text-ink-3 hover:text-brand"
                  >
                     + New team — a second circle (say, a cross-team pairing)
                  </button>
               </div>
            )
         )}

         {activeMembers.map(login => (
            <CandidateRow
               key={login}
               login={login}
               name={nameOf(login)}
               checked
               self={login === me}
               onToggle={() => toggleTeammate(login, false, activeName)}
            />
         ))}
         {active && activeMembers.length === 0 && (
            <div className="flex items-center justify-between gap-2 px-1.5 py-1 text-[13px] text-ink-3">
               <span>“{active.name}” is empty.</span>
               <QuietButton size="sm" onClick={() => removeTeam(active.name)}>
                  Remove this team
               </QuietButton>
            </div>
         )}

         <FilterSearch
            value={query}
            onChange={setQuery}
            label="Search or add a login"
            className="mt-1"
         />

         {filtered.map(c => (
            <CandidateRow
               key={c.login}
               login={c.login}
               name={nameOf(c.login)}
               count={c.count}
               checked={false}
               self={c.login === me}
               onToggle={() => toggleTeammate(c.login, true, activeName)}
            />
         ))}
         {filtered.length === 0 && !trimmed && (
            <div className="px-1.5 py-2 text-[13px] text-ink-3">No one else on the board yet.</div>
         )}

         {trimmed && !exactMatch && (
            <button
               type="button"
               onClick={() => {
                  toggleTeammate(trimmed, true, activeName);
                  setQuery('');
               }}
               className="hit pressable flex w-full items-center gap-2 rounded-md px-1.5 py-[5px] text-left text-[13px] text-brand hover:bg-muted"
            >
               Add “{trimmed}”
            </button>
         )}
      </div>
   );
}
