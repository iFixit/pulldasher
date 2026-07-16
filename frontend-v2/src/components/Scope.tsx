import { useEffect, useRef, useState } from 'react';
import type { DerivedPull } from '../model/status';
import type { Team } from '../types';
import { shortRepo } from '../format';
import { useScope, type Scope } from '../prefs';

/**
 * The one filter control: a popover with team presets, people, and repos.
 * A full selection commits as empty ("everything") so new repos and new
 * teammates never get silently excluded by a stale saved list.
 */
export function ScopeControl({ pulls, teams }: { pulls: DerivedPull[]; teams: Team[] }) {
   const [scope, setScope] = useScope();
   const [open, setOpen] = useState(false);
   const ref = useRef<HTMLSpanElement>(null);

   useEffect(() => {
      if (!open) return;
      const close = (e: MouseEvent) => {
         if (!ref.current?.contains(e.target as Node)) setOpen(false);
      };
      document.addEventListener('click', close);
      return () => document.removeEventListener('click', close);
   }, [open]);

   const repoCounts = new Map<string, number>();
   const authorCounts = new Map<string, number>();
   for (const p of pulls) {
      repoCounts.set(p.data.repo, (repoCounts.get(p.data.repo) ?? 0) + 1);
      authorCounts.set(p.data.user.login, (authorCounts.get(p.data.user.login) ?? 0) + 1);
   }
   const repos = [...repoCounts.entries()].sort((a, b) => b[1] - a[1]);
   const authors = [...authorCounts.entries()].sort((a, b) => b[1] - a[1]);

   const scopedCount = scope.repos.length + scope.authors.length;
   const label = scopedCount
      ? `Scope: ${[
           scope.repos.length && `${scope.repos.length} repos`,
           scope.authors.length && `${scope.authors.length} people`,
        ]
           .filter(Boolean)
           .join(' · ')}`
      : 'Scope: everything';

   const commit = (key: keyof Scope, next: string[], all: string[]) =>
      setScope({ ...scope, [key]: next.length === all.length ? [] : next });

   const toggle = (key: keyof Scope, name: string, all: string[]) => {
      const cur = scope[key].length ? [...scope[key]] : [...all];
      const i = cur.indexOf(name);
      if (i >= 0) cur.splice(i, 1);
      else cur.push(name);
      commit(key, cur, all);
   };

   const section = (key: keyof Scope, list: [string, number][], strip: boolean) =>
      list.map(([name, count]) => (
         <label
            key={name}
            className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-[5px] text-[13px] hover:bg-muted [&:hover>.only]:visible"
         >
            <input
               type="checkbox"
               className="m-0"
               checked={!scope[key].length || scope[key].includes(name)}
               onChange={() =>
                  toggle(
                     key,
                     name,
                     list.map(([n]) => n)
                  )
               }
            />
            <span>{strip ? shortRepo(name) : name}</span>
            <button
               type="button"
               className="only invisible border-0 bg-transparent p-0 text-[11px] text-brand"
               onClick={e => {
                  e.preventDefault();
                  commit(key, [name], []);
               }}
            >
               only
            </button>
            <span className="ml-auto text-[11px] text-ink-3 tabular-nums">{count}</span>
         </label>
      ));

   return (
      <span className="relative inline-block" ref={ref}>
         <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className={`pressable inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium ${
               scopedCount
                  ? 'border-brand bg-brand-50 text-brand-700'
                  : 'border-line bg-surface text-ink-2 hover:text-brand'
            }`}
         >
            {label} ▾
            {scopedCount > 0 && (
               <span
                  role="button"
                  tabIndex={0}
                  title="clear scope"
                  className="pl-0.5"
                  onClick={e => {
                     e.stopPropagation();
                     setScope({ repos: [], authors: [] });
                  }}
                  onKeyDown={e => {
                     if (e.key === 'Enter') setScope({ repos: [], authors: [] });
                  }}
               >
                  ✕
               </span>
            )}
         </button>
         {open && (
            <span className="popover absolute top-full left-0 z-50 mt-1 block max-h-[420px] w-[296px] overflow-auto rounded-lg border border-line bg-surface p-2 shadow-md">
               <span className="flex gap-3 px-1.5 pt-0.5 pb-1">
                  <button
                     type="button"
                     className="border-0 bg-transparent p-0 text-xs font-medium text-brand hover:underline"
                     onClick={() => setScope({ repos: [], authors: [] })}
                  >
                     everything
                  </button>
               </span>
               {teams.length > 0 && (
                  <>
                     <span className="block px-1.5 pt-2.5 pb-1.5 text-xs font-semibold text-ink-3">
                        Teams
                     </span>
                     <span className="flex flex-wrap gap-1 px-1.5 pb-1.5">
                        {teams.map(t => (
                           <button
                              key={t.team}
                              type="button"
                              className="rounded-lg border border-line bg-surface px-2 py-[3px] text-xs font-medium text-ink-2 hover:border-brand hover:text-brand"
                              onClick={() =>
                                 commit(
                                    'authors',
                                    authors.map(([n]) => n).filter(n => t.members.includes(n)),
                                    []
                                 )
                              }
                           >
                              {t.team}
                           </button>
                        ))}
                     </span>
                  </>
               )}
               <span className="block px-1.5 pt-2.5 pb-1.5 text-xs font-semibold text-ink-3">
                  People
               </span>
               {section('authors', authors, false)}
               <span className="block px-1.5 pt-2.5 pb-1.5 text-xs font-semibold text-ink-3">
                  Repos
               </span>
               {section('repos', repos, true)}
            </span>
         )}
      </span>
   );
}
