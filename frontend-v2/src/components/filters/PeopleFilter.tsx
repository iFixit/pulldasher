import { useState } from 'react';
import type { DerivedPull } from '../../model/status';
import { toggleMutedPerson, toggleStarredPerson, useSettings } from '../../settings';
import { usePulldasher } from '../../store';
import type { Team } from '../../types';
import { Avatar, QuietButton, StarMark } from '../bits';
import { Popover } from '../Popover';
import { FilterRow, FilterSearch, FilterTrigger, OnlyButton } from './shared';

/**
 * The people filter: team preset chips, then a searchable author list where
 * scope (on my board), star (floats to the front of my queues), and mute
 * (off my board, period) live side by side on each row — the same
 * scope/mute-together layout RepoFilter uses for repos. "Your team" (your
 * own per-browser roster, prepended to the org's teams in app.tsx) gets a
 * brand border instead of the ★ prefix: the star glyph already means
 * something specific elsewhere on this row (star a person), so reusing it as
 * decoration on the team chip would read as "this team is starred."
 */
export function PeopleFilter({
   pulls,
   teams,
   scope,
   setScope,
}: {
   pulls: DerivedPull[];
   teams: Team[];
   scope: { repos: string[]; authors: string[] };
   setScope: (next: { repos: string[]; authors: string[] }) => void;
}) {
   const { me } = usePulldasher();
   const settings = useSettings();
   const starredSet = new Set(settings.starredPeople);
   const mutedSet = new Set(settings.mutedPeople);
   const [peopleQuery, setPeopleQuery] = useState('');

   const authorCounts = new Map<string, number>();
   for (const p of pulls)
      authorCounts.set(p.data.user.login, (authorCounts.get(p.data.user.login) ?? 0) + 1);
   for (const name of scope.authors) if (!authorCounts.has(name)) authorCounts.set(name, 0);
   for (const name of settings.mutedPeople) if (!authorCounts.has(name)) authorCounts.set(name, 0);
   const authors = [...authorCounts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
   );
   const shownAuthors = authors.filter(([login]) => !mutedSet.has(login));
   const mutedAuthors = authors.filter(([login]) => mutedSet.has(login));

   const commit = (next: string[], all: string[]) =>
      setScope({ ...scope, authors: all.length && next.length === all.length ? [] : next });
   const toggleScope = (login: string, all: string[]) => {
      const cur = scope.authors.length ? [...scope.authors] : [...all];
      const i = cur.indexOf(login);
      if (i >= 0) cur.splice(i, 1);
      else cur.push(login);
      commit(cur, all);
   };
   const included = (login: string) => !scope.authors.length || scope.authors.includes(login);

   // the trigger names only what narrows the board: one person by login,
   // more as a count. Mute counts read in the hidden-PR ledger, not here.
   const value =
      scope.authors.length === 0
         ? null
         : scope.authors.length === 1
           ? scope.authors[0]
           : `${scope.authors.length} people`;

   const filteredShown = shownAuthors.filter(([login]) =>
      login.toLowerCase().includes(peopleQuery.toLowerCase())
   );
   const filteredMuted = mutedAuthors.filter(([login]) =>
      login.toLowerCase().includes(peopleQuery.toLowerCase())
   );

   return (
      <div>
         <Popover
            label="People filter"
            width="w-[300px]"
            panelClass="max-h-[460px] overflow-auto p-2"
            rootClass="relative inline-flex items-center"
            trigger={t => (
               <FilterTrigger
                  t={t}
                  label="People"
                  value={value}
                  onClear={() => setScope({ ...scope, authors: [] })}
                  ariaLabel={`people filter: ${value ?? 'off'}`}
               />
            )}
         >
            {teams.length > 0 && (
               <div className="mb-2 flex flex-wrap gap-1 px-0.5">
                  {teams.map(t => {
                     const isYours = t.team === 'Your team';
                     return (
                        <button
                           key={t.team}
                           type="button"
                           onClick={() => setScope({ ...scope, authors: [...t.members] })}
                           className={`pressable rounded-lg border px-2 py-[3px] text-xs font-medium ${
                              isYours
                                 ? 'border-brand bg-surface text-brand-700 hover:border-brand-700'
                                 : 'border-line bg-surface text-ink-2 hover:border-brand hover:text-brand'
                           }`}
                        >
                           {t.team}
                        </button>
                     );
                  })}
               </div>
            )}
            <FilterSearch value={peopleQuery} onChange={setPeopleQuery} label="Filter people" />
            {filteredShown.map(([login, count]) => {
               const isStarred = starredSet.has(login);
               return (
                  <FilterRow key={login}>
                     <label className="flex min-w-0 flex-1 items-center gap-2">
                        <input
                           type="checkbox"
                           className="m-0"
                           checked={included(login)}
                           onChange={() =>
                              toggleScope(
                                 login,
                                 authors.map(([l]) => l)
                              )
                           }
                        />
                        <Avatar login={login} size={18} />
                        <span title={login} className="min-w-0 flex-1 truncate text-[13px]">
                           {login}
                        </span>
                        <span className="text-[11px] text-ink-3 tabular-nums">{count || ''}</span>
                     </label>
                     <OnlyButton onClick={() => setScope({ ...scope, authors: [login] })} />
                     <button
                        type="button"
                        // no .hit bleed / no -my: the star's own py clears the
                        // 24px floor; the bled box overlapped adjacent clicks
                        className={`pressable rounded-md px-1.5 py-1.5 text-sm leading-none ${
                           isStarred
                              ? 'text-brand hover:text-brand/70'
                              : 'text-ink-3 hover:text-brand'
                        }`}
                        onClick={() => toggleStarredPerson(login, !isStarred)}
                        aria-pressed={isStarred}
                        aria-label={isStarred ? `unstar ${login}` : `star ${login}`}
                        title={
                           isStarred
                              ? `${login} is starred, floats to the front of your queues`
                              : `star ${login} to float their pulls to the front of your queues`
                        }
                     >
                        <StarMark on={isStarred} />
                     </button>
                     {login !== me && (
                        <QuietButton onClick={() => toggleMutedPerson(login, true)}>
                           Mute
                        </QuietButton>
                     )}
                  </FilterRow>
               );
            })}
            {filteredShown.length === 0 && (
               <div className="px-1.5 py-2 text-xs text-ink-3">No one matches.</div>
            )}
            {filteredMuted.length > 0 && (
               <details className="mt-1.5 border-t border-secondary pt-1.5">
                  <summary className="flex cursor-pointer items-center gap-2 px-1.5 py-1 text-xs font-semibold text-ink-3">
                     Muted people ({filteredMuted.length})
                  </summary>
                  {filteredMuted.map(([login, count]) => (
                     <FilterRow key={login}>
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                           <Avatar login={login} size={18} />
                           <span
                              title={login}
                              className="min-w-0 flex-1 truncate text-[13px] text-ink-3"
                           >
                              {login}
                           </span>
                           <span className="text-[11px] text-ink-3 tabular-nums">
                              {count || ''}
                           </span>
                        </span>
                        <QuietButton onClick={() => toggleMutedPerson(login, false)}>
                           Unmute
                        </QuietButton>
                     </FilterRow>
                  ))}
               </details>
            )}
         </Popover>
      </div>
   );
}
