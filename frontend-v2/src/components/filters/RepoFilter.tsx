import { useState } from 'react';
import { repoState } from '../../model/visibility';
import { shortRepo } from '../../format';
import type { Scope } from '../../prefs';
import { setRepoPref, useSettings } from '../../settings';
import { Popover } from '../Popover';
import { ClearRow, EyeButton, FilterSearch, FilterTrigger, OnlyButton } from './shared';

/**
 * The repos filter: opens straight into the repo list (no tabs — the old
 * 3-tab Filters popover split repos/people/drafts behind a Segmented click
 * you had to make before you could even search). Scope (which repos are on
 * your board right now) and hide (which repos are off your board, period)
 * live side by side on each row. (Parked PRs and drafts used to ride along
 * here as session toggles; they're board-level hiding, so they live in the
 * filter bar's hidden-PR ledger now — see HiddenPanel.)
 */
export function RepoFilter({
   repos,
   orgHidden,
   reveal,
   toggleReveal,
   showAll,
   setShowAll,
   scope,
   setScope,
}: {
   /** all repos with open-PR counts (org-hidden and user-hidden included) */
   repos: { name: string; count: number }[];
   orgHidden: ReadonlySet<string>;
   reveal: string[];
   toggleReveal: (key: string) => void;
   showAll: boolean;
   setShowAll: (next: boolean) => void;
   scope: Scope;
   setScope: (next: Scope) => void;
}) {
   const settings = useSettings();
   const prefs = settings.repoPrefs;
   const [repoQuery, setRepoQuery] = useState('');

   const shownRepos = repos.filter(r => repoState(r.name, orgHidden, prefs) === 'shown');
   const hiddenRepos = repos.filter(r => repoState(r.name, orgHidden, prefs) !== 'shown');

   const commit = (next: string[], all: string[]) =>
      setScope({ ...scope, repos: all.length && next.length === all.length ? [] : next });
   const toggleScope = (name: string, all: string[]) => {
      const cur = scope.repos.length ? [...scope.repos] : [...all];
      const i = cur.indexOf(name);
      if (i >= 0) cur.splice(i, 1);
      else cur.push(name);
      commit(cur, all);
   };
   const included = (name: string) => !scope.repos.length || scope.repos.includes(name);

   // the trigger names only what narrows the board: a lone repo by name, more
   // as a count. Hidden counts are durable state — they read in the hidden-PR
   // ledger, not here, so the trigger stays quiet when nothing is filtered.
   const value =
      scope.repos.length === 0
         ? null
         : scope.repos.length === 1
           ? shortRepo(scope.repos[0])
           : `${scope.repos.length} repos`;

   const shownRow = (name: string, count: number) => (
      <div
         key={name}
         className="group flex items-center gap-2 rounded-md px-1.5 py-[5px] transition-[background-color] duration-150 ease-out hover:bg-muted motion-reduce:transition-none"
      >
         <label className="flex min-w-0 flex-1 items-center gap-2">
            <input
               type="checkbox"
               className="m-0"
               checked={included(name)}
               onChange={() =>
                  toggleScope(
                     name,
                     shownRepos.map(r => r.name)
                  )
               }
               aria-label={`scope to ${shortRepo(name)}`}
            />
            <span title={name} className="min-w-0 flex-1 truncate text-[13px]">
               {shortRepo(name)}
            </span>
            <span className="text-[11px] text-ink-3 tabular-nums">{count || ''}</span>
         </label>
         <OnlyButton onClick={() => setScope({ ...scope, repos: [name] })} />
         <EyeButton
            hidden={false}
            subject={shortRepo(name)}
            onClick={() => setRepoPref(name, 'hide')}
         />
      </div>
   );

   const hiddenRow = (name: string, count: number, state: 'hidden' | 'org-hidden') => (
      <div
         key={name}
         className="flex items-center gap-2 rounded-md px-1.5 py-[5px] transition-[background-color] duration-150 ease-out hover:bg-muted motion-reduce:transition-none"
      >
         <label className="flex min-w-0 flex-1 items-center gap-2">
            <input
               type="checkbox"
               className="m-0 disabled:opacity-40"
               checked={showAll || reveal.includes(name)}
               disabled={showAll}
               onChange={() => toggleReveal(name)}
               aria-label={`reveal ${shortRepo(name)} for now`}
            />
            <span title={name} className="min-w-0 flex-1 truncate text-[13px] text-ink-3">
               {shortRepo(name)}
               {state === 'org-hidden' && <span className="ml-1 text-[11px] text-ink-3">org</span>}
            </span>
            <span className="text-[11px] text-ink-3 tabular-nums">{count || ''}</span>
         </label>
         {state === 'hidden' ? (
            <EyeButton hidden subject={shortRepo(name)} onClick={() => setRepoPref(name, null)} />
         ) : (
            <EyeButton
               hidden
               subject={shortRepo(name)}
               tone="brand"
               onClick={() => setRepoPref(name, 'show')}
            />
         )}
      </div>
   );

   const filteredShown = shownRepos.filter(r =>
      shortRepo(r.name).toLowerCase().includes(repoQuery.toLowerCase())
   );
   const filteredHidden = hiddenRepos.filter(r =>
      shortRepo(r.name).toLowerCase().includes(repoQuery.toLowerCase())
   );

   return (
      <div>
         <Popover
            label="Repos filter"
            width="w-[300px]"
            panelClass="max-h-[460px] overflow-auto p-2"
            rootClass="relative inline-flex items-center"
            trigger={t => (
               <FilterTrigger
                  t={t}
                  label="Repos"
                  badge={scope.repos.length ? String(scope.repos.length) : null}
                  title={value ? `Repos · ${value}` : undefined}
                  ariaLabel={`repos filter: ${value ?? 'off'}`}
               />
            )}
         >
            <FilterSearch value={repoQuery} onChange={setRepoQuery} label="Filter repos" />
            {/* hidden repos ride at the top, collapsed, so the one-click
                reveal is the first thing you reach — matching the Settings
                repo manager's hidden→shown order */}
            {filteredHidden.length > 0 && (
               <details className="mb-1.5 border-b border-secondary pb-1.5">
                  <summary className="flex cursor-pointer items-center gap-2 px-1.5 py-1 text-xs font-semibold text-ink-3">
                     Hidden by you &amp; org-hidden ({filteredHidden.length})
                     <button
                        type="button"
                        onClick={e => {
                           e.preventDefault();
                           setShowAll(!showAll);
                        }}
                        className="hit ml-auto font-medium text-brand hover:underline"
                     >
                        {showAll ? 'stop showing all' : 'show all'}
                     </button>
                  </summary>
                  {filteredHidden.map(r =>
                     hiddenRow(
                        r.name,
                        r.count,
                        repoState(r.name, orgHidden, prefs) as 'hidden' | 'org-hidden'
                     )
                  )}
               </details>
            )}
            {filteredShown.map(r => shownRow(r.name, r.count))}
            {filteredShown.length === 0 && (
               <div className="px-1.5 py-2 text-xs text-ink-3">No repos match.</div>
            )}
            <ClearRow
               active={scope.repos.length > 0}
               onClear={() => setScope({ ...scope, repos: [] })}
            />
         </Popover>
      </div>
   );
}
