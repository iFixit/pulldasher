import { useState } from 'react';
import { CRYO_KEY, repoState } from '../../model/visibility';
import { shortRepo } from '../../format';
import { setRepoPref, togglePrimaryRepo, useSettings } from '../../settings';
import { QuietButton, Segmented } from '../bits';
import { Popover } from '../Popover';
import { FilterSearch } from './shared';

/**
 * The repos filter: opens straight into the repo list (no tabs — the old
 * 3-tab Filters popover split repos/people/drafts behind a Segmented click
 * you had to make before you could even search). Scope (which repos are on
 * your board right now) and mute (which repos are off your board, period)
 * live side by side on each row, plus the ★ star that marks a repo you
 * actively review (drives the review queue's primary/other split). The two
 * session-only toggles that used to be their own "Drafts" tab — cryo and
 * drafts mode — ride along at the bottom under a "This session" label, so
 * they read as visibly less durable than the rows above them.
 */
export function RepoFilter({
   repos,
   orgHidden,
   reveal,
   toggleReveal,
   showAll,
   setShowAll,
   cryoCount,
   draftsMode,
   setDraftsMode,
   scope,
   setScope,
}: {
   /** exposes the trigger button to FilterChips' durable "muted repos" pill */
   /** all repos with open-PR counts (org-hidden and muted included) */
   repos: { name: string; count: number }[];
   orgHidden: ReadonlySet<string>;
   reveal: string[];
   toggleReveal: (key: string) => void;
   showAll: boolean;
   setShowAll: (next: boolean) => void;
   cryoCount: number;
   draftsMode: 'mine' | 'all';
   setDraftsMode: (m: 'mine' | 'all') => void;
   scope: { repos: string[]; authors: string[] };
   setScope: (next: { repos: string[]; authors: string[] }) => void;
}) {
   const settings = useSettings();
   const prefs = settings.repoPrefs;
   const primary = new Set(settings.primaryRepos);
   const [repoQuery, setRepoQuery] = useState('');

   const shownRepos = repos.filter(r => repoState(r.name, orgHidden, prefs) === 'shown');
   const hiddenRepos = repos.filter(r => repoState(r.name, orgHidden, prefs) !== 'shown');
   const mutedCount = repos.filter(r => repoState(r.name, orgHidden, prefs) === 'muted').length;

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

   // the trigger summary: repos you've narrowed to, plus how many you've
   // muted — drafts/hidden/cryo now live in FilterChips, not here
   const bits: string[] = [];
   if (scope.repos.length)
      bits.push(`${scope.repos.length} repo${scope.repos.length > 1 ? 's' : ''}`);
   if (mutedCount) bits.push(`${mutedCount} muted`);
   const active = bits.length > 0;
   const summary = bits.length ? bits.join(' · ') : 'Repos';

   const shownRow = (name: string, count: number) => {
      const isPrimary = primary.has(name);
      return (
         <div
            key={name}
            className="flex items-center gap-2 rounded-md px-1.5 py-[5px] transition-[background-color] duration-150 ease-out hover:bg-muted motion-reduce:transition-none"
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
            <button
               type="button"
               className={`hit pressable -my-1.5 rounded-md px-1 py-1.5 text-sm leading-none ${
                  isPrimary ? 'text-brand hover:text-brand/70' : 'text-ink-3 hover:text-brand'
               }`}
               onClick={() => togglePrimaryRepo(name, !isPrimary)}
               aria-pressed={isPrimary}
               aria-label={
                  isPrimary
                     ? `remove ${shortRepo(name)} from your primary repos`
                     : `mark ${shortRepo(name)} a primary repo`
               }
               title={isPrimary ? 'a repo you review' : 'mark a repo you review'}
            >
               {isPrimary ? '★' : '☆'}
            </button>
            <QuietButton onClick={() => setRepoPref(name, 'mute')}>Mute</QuietButton>
         </div>
      );
   };

   const hiddenRow = (name: string, count: number, state: 'muted' | 'org-hidden') => (
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
         {state === 'muted' ? (
            <QuietButton onClick={() => setRepoPref(name, null)}>Unmute</QuietButton>
         ) : (
            <QuietButton tone="brand" onClick={() => setRepoPref(name, 'show')}>
               Show
            </QuietButton>
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
               <button
                  {...t}
                  type="button"
                  className={`pressable inline-flex h-8 max-w-[220px] items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium ${
                     active
                        ? 'border-brand bg-brand-50 text-brand-700 hover:border-brand-700'
                        : 'border-line bg-surface text-ink-2 hover:text-brand'
                  }`}
                  title={summary}
                  aria-label={`repos filter: ${summary}`}
               >
                  <svg
                     viewBox="0 0 16 16"
                     aria-hidden
                     className="h-3.5 w-3.5 flex-none fill-current"
                  >
                     <path d="M1.5 3h13a.5.5 0 0 1 .4.8l-4.9 6v3.7a.5.5 0 0 1-.7.45l-2-1a.5.5 0 0 1-.3-.45V9.8l-4.9-6a.5.5 0 0 1 .4-.8Z" />
                  </svg>
                  <span className="hidden truncate sm:inline">{summary}</span>
                  <span aria-hidden className="ml-auto text-ink-3">
                     ▾
                  </span>
               </button>
            )}
         >
            <FilterSearch value={repoQuery} onChange={setRepoQuery} label="Filter repos" />
            {filteredShown.map(r => shownRow(r.name, r.count))}
            {filteredShown.length === 0 && (
               <div className="px-1.5 py-2 text-xs text-ink-3">No repos match.</div>
            )}
            {filteredHidden.length > 0 && (
               <details className="mt-1.5 border-t border-secondary pt-1.5">
                  <summary className="flex cursor-pointer items-center gap-2 px-1.5 py-1 text-xs font-semibold text-ink-3">
                     Muted &amp; org-hidden ({filteredHidden.length})
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
                        repoState(r.name, orgHidden, prefs) as 'muted' | 'org-hidden'
                     )
                  )}
               </details>
            )}

            <div className="mt-2 border-t border-secondary pt-2">
               <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                  This session
               </div>
               {cryoCount > 0 && (
                  <label className="flex items-center gap-2 px-1.5 pb-1.5 text-[13px]">
                     <input
                        type="checkbox"
                        className="m-0 disabled:opacity-40"
                        checked={settings.showCryo || reveal.includes(CRYO_KEY) || showAll}
                        disabled={settings.showCryo || showAll}
                        onChange={() => toggleReveal(CRYO_KEY)}
                     />
                     <span className="flex-1">Show parked (Cryogenic) PRs</span>
                     <span className="text-[11px] text-ink-3 tabular-nums">{cryoCount}</span>
                  </label>
               )}
               <div className="flex items-center gap-2 px-1.5">
                  <span className="text-[13px] text-ink-2">Drafts</span>
                  <Segmented
                     ariaLabel="which drafts to show"
                     value={draftsMode}
                     options={[
                        ['mine', 'Mine'],
                        ['all', 'All'],
                     ]}
                     onChange={setDraftsMode}
                  />
               </div>
            </div>
         </Popover>
      </div>
   );
}
