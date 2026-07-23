import { useState } from 'react';
import type { DerivedPull } from '../../model/status';
import { displayName, useNames } from '../../model/names';
import type { Scope } from '../../prefs';
import { toggleHiddenPerson, toggleTeammate, useSettings } from '../../settings';
import { usePulldasher } from '../../store';
import { Avatar, QuietButton, StarMark } from '../bits';
import { Popover } from '../Popover';
import {
   ClearRow,
   ExceptButton,
   FilterRow,
   FilterSearch,
   FilterTrigger,
   OnlyButton,
} from './shared';

/**
 * The people filter: a searchable author list where scope (on my board),
 * except (everyone but them), star (floats to the front of my queues), and
 * hide (off my board, period) live side by side on each row — the same
 * scope/hide-together layout RepoFilter uses for repos. Whole-team narrowing
 * lives in the pinned saved searches, not here: every roster already derives
 * one, so this panel stays a per-person surface.
 */
export function PeopleFilter({
   pulls,
   scope,
   setScope,
}: {
   pulls: DerivedPull[];
   scope: Scope;
   setScope: (next: Scope) => void;
}) {
   const { me } = usePulldasher();
   const settings = useSettings();
   // login -> human name (app.tsx prefetches everyone on the board), so the
   // list can read and search by the person, not just the handle
   const namesMap = useNames();
   const nameOf = (login: string) => displayName(namesMap, login);
   const matchesPerson = (login: string, q: string) =>
      login.toLowerCase().includes(q) || (nameOf(login) ?? '').toLowerCase().includes(q);
   const teamSet = new Set(settings.teams.flatMap(t => t.members));
   const hiddenSet = new Set(settings.hiddenPeople);
   const [peopleQuery, setPeopleQuery] = useState('');

   const authorCounts = new Map<string, number>();
   for (const p of pulls)
      authorCounts.set(p.data.user.login, (authorCounts.get(p.data.user.login) ?? 0) + 1);
   for (const name of scope.authors) if (!authorCounts.has(name)) authorCounts.set(name, 0);
   for (const name of settings.hiddenPeople) if (!authorCounts.has(name)) authorCounts.set(name, 0);
   const authors = [...authorCounts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
   );
   const shownAuthors = authors.filter(([login]) => !hiddenSet.has(login));
   const hiddenAuthors = authors.filter(([login]) => hiddenSet.has(login));

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
   // the "everyone except" lane: per-login, mutually exclusive with the
   // allow-list (excluding someone pulls them out of authors, and vice versa)
   const exclude = (login: string) =>
      setScope({
         ...scope,
         authors: scope.authors.filter(l => l !== login),
         notAuthors: [...new Set([...scope.notAuthors, login])],
      });
   const include = (login: string) =>
      setScope({ ...scope, notAuthors: scope.notAuthors.filter(l => l !== login) });

   // full words for the hover title / aria; the badge abbreviates to a count
   // (or a −count when the selection is an exclusion)
   const value =
      scope.authors.length === 0
         ? null
         : scope.authors.length === 1
           ? scope.authors[0]
           : `${scope.authors.length} people`;
   const excludingWords =
      scope.notAuthors.length === 0
         ? null
         : `excluding ${
              scope.notAuthors.length === 1
                 ? scope.notAuthors[0]
                 : `${scope.notAuthors.length} people`
           }`;
   const words =
      value && excludingWords ? `${value} · ${excludingWords}` : (value ?? excludingWords);
   const badge = scope.authors.length
      ? String(scope.authors.length)
      : scope.notAuthors.length
        ? `−${scope.notAuthors.length}`
        : null;

   const filteredShown = shownAuthors.filter(([login]) =>
      matchesPerson(login, peopleQuery.toLowerCase())
   );
   const filteredHidden = hiddenAuthors.filter(([login]) =>
      matchesPerson(login, peopleQuery.toLowerCase())
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
                  badge={badge}
                  title={words ? `People · ${words}` : undefined}
                  ariaLabel={`people filter: ${words ?? 'off'}`}
               />
            )}
         >
            <FilterSearch value={peopleQuery} onChange={setPeopleQuery} label="Filter people" />
            {filteredShown.map(([login, count]) => {
               const isTeammate = teamSet.has(login);
               const excluded = scope.notAuthors.includes(login);
               return (
                  <FilterRow key={login}>
                     <label className="flex min-w-0 flex-1 items-center gap-2">
                        <input
                           type="checkbox"
                           className="m-0"
                           checked={included(login) && !excluded}
                           onChange={() =>
                              excluded
                                 ? include(login)
                                 : toggleScope(
                                      login,
                                      authors.map(([l]) => l)
                                   )
                           }
                        />
                        <Avatar login={login} size={18} />
                        <span
                           title={login}
                           className={`min-w-0 flex-1 truncate text-[13px] ${
                              excluded ? 'text-ink-3 line-through' : ''
                           }`}
                        >
                           {nameOf(login) ?? login}
                        </span>
                        <span className="text-[11px] text-ink-3 tabular-nums">{count || ''}</span>
                     </label>
                     <OnlyButton
                        onClick={() => setScope({ ...scope, authors: [login], notAuthors: [] })}
                     />
                     <ExceptButton
                        on={excluded}
                        onClick={() => (excluded ? include(login) : exclude(login))}
                     />
                     <button
                        type="button"
                        // no .hit bleed / no -my: the star's own py clears the
                        // 24px floor; the bled box overlapped adjacent clicks
                        className={`pressable rounded-md px-1.5 py-1.5 text-sm leading-none ${
                           isTeammate
                              ? 'text-brand hover:text-brand/70'
                              : 'text-ink-3 hover:text-brand'
                        }`}
                        onClick={() => toggleTeammate(login, !isTeammate)}
                        aria-pressed={isTeammate}
                        aria-label={
                           isTeammate
                              ? `remove ${login} from your team`
                              : `add ${login} to your team`
                        }
                        title={
                           isTeammate
                              ? `${login} is on your team; their PRs lead your review queues`
                              : `add ${login} to your team: their PRs lead your review queues`
                        }
                     >
                        <StarMark on={isTeammate} />
                     </button>
                     {login !== me && (
                        <QuietButton onClick={() => toggleHiddenPerson(login, true)}>
                           Hide
                        </QuietButton>
                     )}
                  </FilterRow>
               );
            })}
            {filteredShown.length === 0 && (
               <div className="px-1.5 py-2 text-xs text-ink-3">No one matches.</div>
            )}
            {filteredHidden.length > 0 && (
               <details className="mt-1.5 border-t border-secondary pt-1.5">
                  <summary className="flex cursor-pointer items-center gap-2 px-1.5 py-1 text-xs font-semibold text-ink-3">
                     Hidden people ({filteredHidden.length})
                  </summary>
                  {filteredHidden.map(([login, count]) => (
                     <FilterRow key={login}>
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                           <Avatar login={login} size={18} />
                           <span
                              title={login}
                              className="min-w-0 flex-1 truncate text-[13px] text-ink-3"
                           >
                              {nameOf(login) ?? login}
                           </span>
                           <span className="text-[11px] text-ink-3 tabular-nums">
                              {count || ''}
                           </span>
                        </span>
                        <QuietButton onClick={() => toggleHiddenPerson(login, false)}>
                           Show
                        </QuietButton>
                     </FilterRow>
                  ))}
               </details>
            )}
            <ClearRow
               active={scope.authors.length > 0 || scope.notAuthors.length > 0}
               onClear={() => setScope({ ...scope, authors: [], notAuthors: [] })}
            />
         </Popover>
      </div>
   );
}
