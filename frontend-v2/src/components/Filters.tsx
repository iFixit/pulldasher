import { useState } from 'react';
import type { DerivedPull } from '../model/status';
import { CRYO_KEY, repoState } from '../model/visibility';
import { shortRepo } from '../format';
import { useScope, type Scope } from '../prefs';
import { setRepoPref, useSettings } from '../settings';
import type { Team } from '../types';
import { Avatar } from './bits';
import { Popover } from './Popover';

type Tab = 'repos' | 'people' | 'drafts';

/**
 * The one visibility surface: what's on my board and why. Its trigger is the
 * active-filter summary (the standing answer to "what's hidden right now"),
 * and its popover consolidates the old Scope popover and the eye/Hidden
 * selector into tabs. Include (scope) and exclude (mute) live side by side on
 * each repo row; reveal is just un-muting for this session.
 */
export function Filters({
   pulls,
   repos,
   teams,
   orgHidden,
   reveal,
   toggleReveal,
   showAll,
   setShowAll,
   cryoCount,
   draftsMode,
   setDraftsMode,
}: {
   pulls: DerivedPull[];
   /** all repos with open-PR counts (org-hidden and muted included) */
   repos: { name: string; count: number }[];
   teams: Team[];
   orgHidden: ReadonlySet<string>;
   reveal: string[];
   toggleReveal: (key: string) => void;
   showAll: boolean;
   setShowAll: (next: boolean) => void;
   cryoCount: number;
   draftsMode: 'mine' | 'all';
   setDraftsMode: (m: 'mine' | 'all') => void;
}) {
   const [scope, setScope] = useScope();
   const settings = useSettings();
   const prefs = settings.repoPrefs;
   const [tab, setTab] = useState<Tab>('repos');
   const [repoQuery, setRepoQuery] = useState('');
   const [peopleQuery, setPeopleQuery] = useState('');

   const authorCounts = new Map<string, number>();
   for (const p of pulls)
      authorCounts.set(p.data.user.login, (authorCounts.get(p.data.user.login) ?? 0) + 1);
   for (const name of scope.authors) if (!authorCounts.has(name)) authorCounts.set(name, 0);
   const authors = [...authorCounts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
   );

   const shownRepos = repos.filter(r => repoState(r.name, orgHidden, prefs) === 'shown');
   const hiddenRepos = repos.filter(r => repoState(r.name, orgHidden, prefs) !== 'shown');
   const mutedCount = repos.filter(r => repoState(r.name, orgHidden, prefs) === 'muted').length;

   const commit = (key: keyof Scope, next: string[], all: string[]) =>
      setScope({ ...scope, [key]: all.length && next.length === all.length ? [] : next });
   const toggle = (key: keyof Scope, name: string, all: string[]) => {
      const cur = scope[key].length ? [...scope[key]] : [...all];
      const i = cur.indexOf(name);
      if (i >= 0) cur.splice(i, 1);
      else cur.push(name);
      commit(key, cur, all);
   };
   const included = (key: keyof Scope, name: string) =>
      !scope[key].length || scope[key].includes(name);

   // the trigger summary: every active narrowing, or "All repos"
   const bits: string[] = [];
   if (scope.repos.length)
      bits.push(`${scope.repos.length} repo${scope.repos.length > 1 ? 's' : ''}`);
   if (scope.authors.length)
      bits.push(`${scope.authors.length} ${scope.authors.length > 1 ? 'people' : 'person'}`);
   if (mutedCount) bits.push(`${mutedCount} muted`);
   if (draftsMode === 'all') bits.push('all drafts');
   if (showAll) bits.push('all hidden shown');
   else if (reveal.length) bits.push(`${reveal.length} revealed`);
   const active = bits.length > 0;
   const summary = bits.length ? bits.join(' · ') : 'All repos';
   // what "Clear" would actually change — the transient filters, not your
   // durable mutes (those are your board; unmute them in the list or Settings)
   const clearable =
      scope.repos.length > 0 ||
      scope.authors.length > 0 ||
      reveal.length > 0 ||
      showAll ||
      draftsMode !== settings.draftsMode;

   const reset = () => {
      setScope({ repos: [], authors: [] });
      setShowAll(false);
      setDraftsMode(settings.draftsMode);
      for (const k of reveal) toggleReveal(k);
   };

   const tabBtn = (id: Tab, label: string) => (
      <button
         type="button"
         role="tab"
         aria-selected={tab === id}
         onClick={() => setTab(id)}
         className={`pressable rounded-md px-2.5 py-1 text-xs font-medium ${
            tab === id ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-brand'
         }`}
      >
         {label}
      </button>
   );

   const search = (value: string, set: (v: string) => void, label: string) => (
      <input
         value={value}
         onChange={e => set(e.target.value)}
         aria-label={label}
         placeholder={label}
         className="mb-2 h-8 w-full rounded-lg border border-line bg-surface px-2.5 text-[13px]"
      />
   );

   const repoRow = (name: string, count: number, state: ReturnType<typeof repoState>) => (
      <div key={name} className="flex items-center gap-2 rounded-md px-1.5 py-[5px] hover:bg-muted">
         {state === 'shown' ? (
            <input
               type="checkbox"
               className="m-0"
               checked={included('repos', name)}
               onChange={() =>
                  toggle(
                     'repos',
                     name,
                     shownRepos.map(r => r.name)
                  )
               }
               aria-label={`scope to ${shortRepo(name)}`}
            />
         ) : (
            <input
               type="checkbox"
               className="m-0"
               checked={showAll || reveal.includes(name)}
               disabled={showAll}
               onChange={() => toggleReveal(name)}
               aria-label={`reveal ${shortRepo(name)} for now`}
            />
         )}
         <span
            className={`min-w-0 flex-1 truncate text-[13px] ${state === 'shown' ? '' : 'text-ink-3'}`}
         >
            {shortRepo(name)}
            {state === 'org-hidden' && <span className="ml-1 text-[11px] text-ink-3">org</span>}
         </span>
         <span className="text-[11px] text-ink-3 tabular-nums">{count || ''}</span>
         {state === 'muted' ? (
            <button
               type="button"
               onClick={() => setRepoPref(name, null)}
               className="rounded border-0 bg-transparent px-1 text-[11px] text-ink-3 hover:text-brand"
            >
               unmute
            </button>
         ) : state === 'org-hidden' ? (
            <button
               type="button"
               onClick={() => setRepoPref(name, 'show')}
               className="rounded border-0 bg-transparent px-1 text-[11px] text-brand hover:underline"
            >
               show
            </button>
         ) : (
            <button
               type="button"
               onClick={() => setRepoPref(name, 'mute')}
               title={`mute ${shortRepo(name)} — hide it on your board`}
               className="rounded border-0 bg-transparent px-1 text-[11px] text-ink-3 hover:text-brand"
            >
               mute
            </button>
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
      <Popover
         label="Filters"
         width="w-[300px]"
         panelClass="max-h-[460px] overflow-auto p-2"
         rootClass="relative inline-flex items-center"
         trigger={t => (
            <button
               {...t}
               type="button"
               className={`pressable inline-flex h-8 max-w-[280px] items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium ${
                  active
                     ? 'border-brand bg-brand-50 text-brand-700'
                     : 'border-line bg-surface text-ink-2 hover:text-brand'
               }`}
               title="filter and hide repos, people, and drafts"
            >
               <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 flex-none fill-current">
                  <path d="M1.5 3h13a.5.5 0 0 1 .4.8l-4.9 6v3.7a.5.5 0 0 1-.7.45l-2-1a.5.5 0 0 1-.3-.45V9.8l-4.9-6a.5.5 0 0 1 .4-.8Z" />
               </svg>
               <span className="truncate">{summary}</span>
               <span aria-hidden className="ml-auto text-ink-3">
                  ▾
               </span>
            </button>
         )}
      >
         <div className="mb-2 inline-flex gap-0.5 rounded-lg border border-line bg-muted p-0.5">
            {tabBtn('repos', 'Repos')}
            {tabBtn('people', 'People')}
            {tabBtn('drafts', 'Drafts')}
         </div>

         {tab === 'repos' && (
            <>
               {search(repoQuery, setRepoQuery, 'Filter repos')}
               {filteredShown.map(r => repoRow(r.name, r.count, 'shown'))}
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
                           className="ml-auto font-medium text-brand hover:underline"
                        >
                           {showAll ? 'stop showing all' : 'show all'}
                        </button>
                     </summary>
                     {filteredHidden.map(r =>
                        repoRow(r.name, r.count, repoState(r.name, orgHidden, prefs))
                     )}
                  </details>
               )}
               {cryoCount > 0 && (
                  <label className="mt-1.5 flex items-center gap-2 border-t border-secondary px-1.5 pt-2 text-[13px]">
                     <input
                        type="checkbox"
                        className="m-0"
                        checked={settings.showCryo || reveal.includes(CRYO_KEY) || showAll}
                        disabled={settings.showCryo || showAll}
                        onChange={() => toggleReveal(CRYO_KEY)}
                     />
                     <span className="flex-1">Show parked (Cryogenic) PRs</span>
                     <span className="text-[11px] text-ink-3 tabular-nums">{cryoCount}</span>
                  </label>
               )}
            </>
         )}

         {tab === 'people' && (
            <>
               {teams.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1 px-0.5">
                     {teams.map(t => (
                        <button
                           key={t.team}
                           type="button"
                           onClick={() => setScope({ ...scope, authors: [...t.members] })}
                           className="rounded-lg border border-line bg-surface px-2 py-[3px] text-xs font-medium text-ink-2 hover:border-brand hover:text-brand"
                        >
                           {t.team}
                        </button>
                     ))}
                  </div>
               )}
               {search(peopleQuery, setPeopleQuery, 'Filter people')}
               {authors
                  .filter(([login]) => login.toLowerCase().includes(peopleQuery.toLowerCase()))
                  .map(([login, count]) => (
                     <label
                        key={login}
                        className="flex items-center gap-2 rounded-md px-1.5 py-[5px] text-[13px] hover:bg-muted"
                     >
                        <input
                           type="checkbox"
                           className="m-0"
                           checked={included('authors', login)}
                           onChange={() =>
                              toggle(
                                 'authors',
                                 login,
                                 authors.map(([l]) => l)
                              )
                           }
                        />
                        <Avatar login={login} size={18} />
                        <span className="min-w-0 flex-1 truncate">{login}</span>
                        <span className="text-[11px] text-ink-3 tabular-nums">{count || ''}</span>
                     </label>
                  ))}
            </>
         )}

         {tab === 'drafts' && (
            <div className="px-1 py-1">
               <div className="mb-2 inline-flex gap-0.5 rounded-lg border border-line bg-muted p-0.5">
                  <button
                     type="button"
                     aria-pressed={draftsMode === 'mine'}
                     onClick={() => setDraftsMode('mine')}
                     className={`pressable rounded-md px-2.5 py-1 text-xs font-medium ${
                        draftsMode === 'mine'
                           ? 'bg-surface text-ink shadow-sm'
                           : 'text-ink-2 hover:text-brand'
                     }`}
                  >
                     Mine
                  </button>
                  <button
                     type="button"
                     aria-pressed={draftsMode === 'all'}
                     onClick={() => setDraftsMode('all')}
                     className={`pressable rounded-md px-2.5 py-1 text-xs font-medium ${
                        draftsMode === 'all'
                           ? 'bg-surface text-ink shadow-sm'
                           : 'text-ink-2 hover:text-brand'
                     }`}
                  >
                     All
                  </button>
               </div>
               <p className="m-0 text-xs text-ink-3">
                  {draftsMode === 'mine'
                     ? 'Other people’s drafts are hidden. Your own drafts always show.'
                     : 'Everyone’s drafts show.'}
               </p>
            </div>
         )}

         {clearable && (
            <div className="mt-1.5 border-t border-secondary px-1 pt-1.5 text-right">
               <button
                  type="button"
                  onClick={reset}
                  className="text-xs font-medium text-brand hover:underline"
               >
                  Clear filters
               </button>
            </div>
         )}
      </Popover>
   );
}
