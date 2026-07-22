import { useState } from 'react';
import type { DerivedPull } from '../../model/status';
import { toggleMutedPerson, toggleStarredPerson, useSettings } from '../../settings';
import { usePulldasher } from '../../store';
import type { Team } from '../../types';
import { Avatar, QuietButton } from '../bits';
import { Popover } from '../Popover';
import { FilterRow, FilterSearch, OnlyButton } from './shared';

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

   const mutedCount = settings.mutedPeople.length;
   const bits: string[] = [];
   if (scope.authors.length)
      bits.push(`${scope.authors.length} ${scope.authors.length > 1 ? 'people' : 'person'}`);
   if (mutedCount) bits.push(`${mutedCount} muted`);
   const active = bits.length > 0;
   const summary = bits.length ? bits.join(' · ') : 'People';

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
               <button
                  {...t}
                  type="button"
                  className={`pressable inline-flex h-8 max-w-[220px] items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium ${
                     active
                        ? 'border-brand bg-brand-50 text-brand-700 hover:border-brand-700'
                        : 'border-line bg-surface text-ink-2 hover:text-brand'
                  }`}
                  title={summary}
                  aria-label={`people filter: ${summary}`}
               >
                  <svg
                     viewBox="0 0 16 16"
                     aria-hidden
                     className="h-3.5 w-3.5 flex-none fill-current"
                  >
                     <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 1.5c-2.7 0-6 1.35-6 3.9V14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-.6c0-2.55-3.3-3.9-6-3.9Z" />
                  </svg>
                  <span className="hidden truncate sm:inline">{summary}</span>
                  <span aria-hidden className="ml-auto text-ink-3">
                     ▾
                  </span>
               </button>
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
                              ? `${login} is starred — floats to the front of your queues`
                              : `star ${login} to float their pulls to the front of your queues`
                        }
                     >
                        {isStarred ? '★' : '☆'}
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
