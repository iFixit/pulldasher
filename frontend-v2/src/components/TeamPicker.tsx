import { useMemo, useState } from 'react';
import { isBotLogin } from '../model/visibility';
import { toggleTeammate, useSettings } from '../settings';
import { usePulldasher } from '../store';
import { Avatar } from './bits';

const SUGGESTION_CAP = 12;
const EMPTY_BOTS: ReadonlySet<string> = new Set();

/** One row: checkbox + avatar + login (+ optional trailing count), the same
 * shape the Filters people tab uses so a teammate row reads identically
 * wherever it appears. */
function CandidateRow({
   login,
   count,
   checked,
   onToggle,
}: {
   login: string;
   count?: number;
   checked: boolean;
   onToggle: () => void;
}) {
   return (
      <label className="flex items-center gap-2 rounded-md px-1.5 py-[5px] text-[13px] transition-[background-color] duration-150 ease-out hover:bg-muted motion-reduce:transition-none">
         <input
            type="checkbox"
            className="m-0"
            checked={checked}
            onChange={onToggle}
            aria-label={checked ? `remove ${login} from your team` : `add ${login} to your team`}
         />
         <Avatar login={login} size={18} />
         <span title={login} className="min-w-0 flex-1 truncate">
            {login}
         </span>
         {count != null && (
            <span className="text-[11px] text-ink-3 tabular-nums">{count || ''}</span>
         )}
      </label>
   );
}

/** Every author and signer on the board — the login universe a teammate can
 * be picked from — with an open-PR count for sorting. Bots and yourself are
 * excluded: you're implicitly on your own team, and a dependency bot never
 * reviews anything. */
function useCandidates(extraBots: ReadonlySet<string>) {
   const { pulls, me } = usePulldasher();
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
         .filter(login => login !== me && !isBotLogin(login, extraBots))
         .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b))
         .map(login => ({ login, count: counts.get(login) ?? 0 }));
   }, [pulls, me, extraBots]);
}

/**
 * The team picker: current members first (uncheck to remove), then a
 * searchable, capped list of everyone else on the board. Typing a login with
 * no match on the board still lets you add it — a teammate can have nothing
 * open right now. Standalone so the Team view's empty state can embed it
 * without the Settings drawer's Group chrome (see TeamPickerGroup below).
 */
export function TeamPicker({ extraBots = EMPTY_BOTS }: { extraBots?: ReadonlySet<string> }) {
   const { myTeam } = useSettings();
   const candidates = useCandidates(extraBots);
   const [query, setQuery] = useState('');

   const members = new Set(myTeam);
   const trimmed = query.trim();
   const needle = trimmed.toLowerCase();
   const available = candidates.filter(c => !members.has(c.login));
   const filtered = needle
      ? available.filter(c => c.login.toLowerCase().includes(needle))
      : available.slice(0, SUGGESTION_CAP);

   const exactMatch =
      !!trimmed && (members.has(trimmed) || candidates.some(c => c.login.toLowerCase() === needle));

   return (
      <div>
         {myTeam.map(login => (
            <CandidateRow
               key={login}
               login={login}
               checked
               onToggle={() => toggleTeammate(login, false)}
            />
         ))}

         <input
            aria-label="Search or add a teammate"
            className="mt-1 mb-1 h-8 w-full rounded-lg border border-line bg-surface px-2.5 text-[13px]"
            onChange={e => setQuery(e.target.value)}
            placeholder="Search or add a login"
            type="text"
            value={query}
         />

         {filtered.map(c => (
            <CandidateRow
               key={c.login}
               login={c.login}
               count={c.count}
               checked={false}
               onToggle={() => toggleTeammate(c.login, true)}
            />
         ))}
         {filtered.length === 0 && !trimmed && (
            <div className="px-1.5 py-2 text-[13px] text-ink-3">No one else on the board yet.</div>
         )}

         {trimmed && !exactMatch && (
            <button
               type="button"
               onClick={() => {
                  toggleTeammate(trimmed, true);
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

/** The Settings-drawer wrapper: same Group chrome RepoManagerGroup uses. */
export function TeamPickerGroup({ extraBots }: { extraBots?: ReadonlySet<string> }) {
   return (
      <section className="border-t border-secondary px-4 py-3.5">
         <h3 className="m-0 mb-2.5 text-xs font-semibold tracking-wide text-ink-3 uppercase">
            Your team
         </h3>
         <div className="mb-2 text-[11px] text-ink-3">
            Teammates power the Team view and the “Your team” filter.
         </div>
         <TeamPicker extraBots={extraBots} />
      </section>
   );
}
