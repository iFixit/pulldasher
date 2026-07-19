import { useState } from 'react';
import { repoState } from '../model/visibility';
import { QuietButton } from './bits';

export function RepoManagerGroup({
   repos,
   orgHidden,
   prefs,
   onRepoPref,
   primaryRepos,
   onPrimary,
}: {
   /** every known repo with its open-PR count, sorted however the caller likes */
   repos: { name: string; count: number }[];
   /** repo names the org hides by default (read-only baseline) */
   orgHidden: ReadonlySet<string>;
   /** the user's per-repo overrides */
   prefs: Record<string, 'mute' | 'show'>;
   /** set or clear one repo's override; null follows the org default */
   onRepoPref: (repo: string, pref: 'mute' | 'show' | null) => void;
   /** the repos you actively review (lead your review queue); empty = inferred */
   primaryRepos: string[];
   /** add/remove a repo from your primary set */
   onPrimary: (repo: string, primary: boolean) => void;
}) {
   const primary = new Set(primaryRepos);
   const [query, setQuery] = useState('');

   const needle = query.trim().toLowerCase();
   const filtered =
      needle === '' ? repos : repos.filter(repo => repo.name.toLowerCase().includes(needle));

   const muted = filtered.filter(repo => repoState(repo.name, orgHidden, prefs) === 'muted');
   const orgHiddenRepos = filtered.filter(
      repo => repoState(repo.name, orgHidden, prefs) === 'org-hidden'
   );
   const shown = filtered.filter(repo => repoState(repo.name, orgHidden, prefs) === 'shown');

   const noMatches = filtered.length === 0;

   return (
      <section className="border-t border-secondary px-4 py-3.5">
         <h3 className="m-0 mb-2.5 text-xs font-semibold tracking-wide text-ink-3 uppercase">
            Repos
         </h3>
         <input
            aria-label="Filter repos"
            className="mb-2 h-8 w-full rounded-lg border border-line bg-surface px-2.5 text-[13px]"
            onChange={event => setQuery(event.target.value)}
            placeholder="Filter repos"
            type="text"
            value={query}
         />

         {noMatches && <div className="text-[13px] text-ink-3">No repos match.</div>}

         {muted.length > 0 && (
            <div>
               <div className="mt-0 mb-1 text-xs font-semibold text-ink-3">
                  Muted by you <span className="tabular-nums">({muted.length})</span>
               </div>
               {muted.map(repo => (
                  <div className="flex items-center gap-2 text-[13px]" key={repo.name}>
                     <span title={repo.name} className="min-w-0 flex-1 truncate">
                        {repo.name}
                     </span>
                     <span className="text-ink-3 tabular-nums">{repo.count}</span>
                     <QuietButton onClick={() => onRepoPref(repo.name, null)}>Unmute</QuietButton>
                  </div>
               ))}
            </div>
         )}

         {orgHiddenRepos.length > 0 && (
            <div>
               <div className="mt-2 mb-1 text-xs font-semibold text-ink-3">
                  Hidden by the org <span className="tabular-nums">({orgHiddenRepos.length})</span>
               </div>
               {orgHiddenRepos.map(repo => (
                  <div className="flex items-center gap-2 text-[13px]" key={repo.name}>
                     <span title={repo.name} className="min-w-0 flex-1 truncate">
                        {repo.name}
                     </span>
                     <span className="text-ink-3 tabular-nums">{repo.count}</span>
                     <QuietButton tone="brand" onClick={() => onRepoPref(repo.name, 'show')}>
                        Show for me
                     </QuietButton>
                  </div>
               ))}
            </div>
         )}

         {shown.length > 0 && (
            <div>
               <div className="mt-2 mb-1 text-xs font-semibold text-ink-3">
                  On your board <span className="tabular-nums">({shown.length})</span>
               </div>
               <div className="mb-1.5 text-[11px] text-ink-3">
                  {primary.size > 0
                     ? 'Starred repos lead your review queue; the rest fold into “other repos.”'
                     : 'Star the repos you review to lead your queue with them. Until you do, they’re inferred from where you’ve authored or stamped.'}
               </div>
               {shown.map(repo => {
                  const isUserRevealed = orgHidden.has(repo.name) && prefs[repo.name] === 'show';
                  const isPrimary = primary.has(repo.name);
                  return (
                     <div className="flex items-center gap-2 text-[13px]" key={repo.name}>
                        <button
                           className={`hit pressable -my-1.5 rounded-md px-1 py-1.5 text-sm leading-none ${
                              isPrimary
                                 ? 'text-brand hover:text-brand/70'
                                 : 'text-ink-3 hover:text-brand'
                           }`}
                           onClick={() => onPrimary(repo.name, !isPrimary)}
                           type="button"
                           aria-pressed={isPrimary}
                           aria-label={
                              isPrimary
                                 ? `remove ${repo.name} from your primary repos`
                                 : `mark ${repo.name} a primary repo`
                           }
                           title={isPrimary ? 'a repo you review' : 'mark a repo you review'}
                        >
                           {isPrimary ? '★' : '☆'}
                        </button>
                        <span title={repo.name} className="min-w-0 flex-1 truncate">
                           {repo.name}
                        </span>
                        {isUserRevealed && (
                           <span className="text-[11px] text-ink-3">org-hidden · showing</span>
                        )}
                        <span className="text-ink-3 tabular-nums">{repo.count}</span>
                        {isUserRevealed && (
                           <QuietButton onClick={() => onRepoPref(repo.name, null)}>
                              Reset
                           </QuietButton>
                        )}
                        <QuietButton onClick={() => onRepoPref(repo.name, 'mute')}>
                           Mute
                        </QuietButton>
                     </div>
                  );
               })}
            </div>
         )}
      </section>
   );
}
