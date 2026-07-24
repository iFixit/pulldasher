import { useEffect, useMemo, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { displayName, useNames } from '../model/names';
import { isBotLogin } from '../../../shared/model/visibility';
import { removeTeam, renameTeam, toggleTeammate, useSettings } from '../settings';
import { usePulldasher } from '../store';
import { textInputClass } from './bits';
import { CheckboxField, FilterSearch, hoverRowClass } from './filters/shared';
import { Avatar } from './identity';
import { Icon } from './Icon';
import { useArmedConfirm } from './useArmedConfirm';
import { commitKeyHandler } from './useCommitOnEnter';

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
      <CheckboxField
         checked={checked}
         onChange={onToggle}
         ariaLabel={checked ? `remove ${login} from this team` : `add ${login} to this team`}
         leading={<Avatar login={login} size={18} />}
         title={login}
         className={`gap-2 text-[13px] ${hoverRowClass}`}
         textClassName="min-w-0 flex-1 truncate"
         count={count == null ? undefined : count || ''}
      >
         {name ?? login}
         {self && <span className="ml-1 text-[11px] text-ink-3">(you)</span>}
      </CheckboxField>
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
 * One roster's member picker: current members first (uncheck to remove),
 * then a searchable, capped list of everyone else on the board. Typing a
 * login with no match on the board still lets you add it — a teammate can
 * have nothing open right now. Creating, choosing, and removing rosters
 * happens on the Team lens itself; this panel only ever edits the one team
 * it was opened for. Standalone so the Team view's empty state can embed it
 * without any drawer chrome around it.
 */
export function TeamPicker({
   teamName,
   extraBots = EMPTY_BOTS,
}: {
   /** the roster this picker edits (created on first add if absent) */
   teamName: string;
   extraBots?: ReadonlySet<string>;
}) {
   const { teams } = useSettings();
   const { me } = usePulldasher();
   const candidates = useCandidates(extraBots);
   const [query, setQuery] = useState('');
   // the roster's name, editable in place — draft locally, commit on
   // Enter/blur; renameTeam no-ops on blank or collision so the field just
   // stays put on a bad name
   const [nameDraft, setNameDraft] = useState(teamName);
   useEffect(() => setNameDraft(teamName), [teamName]);
   const commitRename = () => renameTeam(teamName, nameDraft);
   const activeName = teamName;
   const exists = teams.some(t => t.name === teamName);
   const activeMembers = teams.find(t => t.name === teamName)?.members ?? [];
   // deleting a roster is arm-then-confirm, same as removing a saved filter:
   // one misclick must not erase a hand-built list of people
   const { armed, run } = useArmedConfirm();

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

   return (
      <div>
         <input
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={commitKeyHandler({
               onCommit: commitRename,
               onCancel: () => setNameDraft(teamName),
            })}
            aria-label="team name: edit to rename"
            title="the team’s name: edit it here to rename"
            className={`mb-1.5 w-full px-2 font-semibold ${textInputClass}`}
         />
         <p className="px-1.5 pb-1.5 text-[11px] leading-snug text-ink-3">
            Anyone whose work you review belongs on a roster: your review circle, not the org chart.
            Everyone on any roster leads your review queues.
         </p>
         {/* current members as removable face chips — horizontal and
             recognizable, not a column of checkbox rows. The ✕ removes; adding
             more happens in the search below. */}
         {activeMembers.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
               {activeMembers.map(login => (
                  <span
                     key={login}
                     className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-0.5 pr-1 pl-0.5 text-[12px]"
                  >
                     <Avatar login={login} size={18} you={login === me} />
                     <span className="max-w-[128px] truncate font-medium text-ink" title={login}>
                        {nameOf(login) ?? login}
                     </span>
                     <button
                        type="button"
                        onClick={() => toggleTeammate(login, false, activeName)}
                        aria-label={`remove ${nameOf(login) ?? login} from this team`}
                        title="remove from team"
                        className="hit flex h-4 w-4 flex-none items-center justify-center rounded-full text-ink-3 hover:bg-secondary hover:text-bad"
                     >
                        <Icon icon={X} size={11} />
                     </button>
                  </span>
               ))}
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

         {/* the roster's one management panel is also where it can end —
             not buried behind "empty it first, then a button appears" */}
         {exists && (
            <div className="mt-2 border-t border-secondary pt-1.5">
               <button
                  type="button"
                  onClick={() => run(() => removeTeam(teamName))}
                  aria-label={
                     armed ? `confirm deleting the ${teamName} team` : `delete the ${teamName} team`
                  }
                  title={
                     armed
                        ? 'click again to delete'
                        : 'delete this team: people on other rosters stay there'
                  }
                  className="hit pressable flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-ink-3 hover:text-bad"
               >
                  <Icon icon={Trash2} size={12} />
                  {armed ? (
                     <span className="font-medium whitespace-nowrap text-bad">sure?</span>
                  ) : (
                     'Delete team'
                  )}
               </button>
            </div>
         )}
      </div>
   );
}
