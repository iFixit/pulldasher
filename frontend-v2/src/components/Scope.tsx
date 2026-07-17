import type { DerivedPull } from '../model/status';
import type { Team } from '../types';
import { shortRepo } from '../format';
import { useScope, type Scope } from '../prefs';
import { usePopover } from './usePopover';

/**
 * The one filter control: a popover with team presets, people, and repos.
 * A full selection commits as empty ("everything") so new repos and new
 * teammates never get silently excluded by a stale saved list.
 */
export function ScopeControl({ pulls, teams }: { pulls: DerivedPull[]; teams: Team[] }) {
   const [scope, setScope] = useScope();
   const {
      open,
      setOpen,
      rootRef: ref,
      panelRef,
      triggerRef,
   } = usePopover<HTMLSpanElement, HTMLButtonElement>();

   const repoCounts = new Map<string, number>();
   const authorCounts = new Map<string, number>();
   for (const p of pulls) {
      repoCounts.set(p.data.repo, (repoCounts.get(p.data.repo) ?? 0) + 1);
      authorCounts.set(p.data.user.login, (authorCounts.get(p.data.user.login) ?? 0) + 1);
   }
   // A saved scope can name people or repos with no open PRs today. They
   // still filter, so they must stay visible (and uncheckable) or the scope
   // becomes impossible to undo except by clearing everything.
   for (const name of scope.authors) {
      if (!authorCounts.has(name)) authorCounts.set(name, 0);
   }
   for (const name of scope.repos) {
      if (!repoCounts.has(name)) repoCounts.set(name, 0);
   }
   const repos = [...repoCounts.entries()].sort((a, b) => b[1] - a[1]);
   const authors = [...authorCounts.entries()].sort((a, b) => b[1] - a[1]);

   const scopedCount = scope.repos.length + scope.authors.length;
   const label = scopedCount
      ? `Scope: ${[
           scope.repos.length &&
              `${scope.repos.length} ${scope.repos.length === 1 ? 'repo' : 'repos'}`,
           scope.authors.length &&
              `${scope.authors.length} ${scope.authors.length === 1 ? 'person' : 'people'}`,
        ]
           .filter(Boolean)
           .join(' · ')}`
      : 'Scope: everything';

   const commit = (key: keyof Scope, next: string[], all: string[]) =>
      setScope({ ...scope, [key]: all.length && next.length === all.length ? [] : next });

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
            className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-[5px] text-[13px] hover:bg-muted [&:hover>.only]:opacity-100"
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
            <span className={count === 0 ? 'text-ink-3' : ''}>
               {strip ? shortRepo(name) : name}
            </span>
            <button
               type="button"
               className="only border-0 bg-transparent p-0 text-[11px] text-brand opacity-0 focus-visible:opacity-100"
               onClick={e => {
                  e.preventDefault();
                  commit(key, [name], []);
               }}
            >
               only
            </button>
            <span className="ml-auto text-[11px] text-ink-3 tabular-nums">
               {count === 0 ? 'no open PRs' : count}
            </span>
         </label>
      ));

   return (
      <span className="relative inline-flex items-center" ref={ref}>
         <button
            ref={triggerRef}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(o => !o)}
            className={`pressable inline-flex h-8 items-center gap-1.5 border px-2.5 text-[13px] font-medium ${
               scopedCount
                  ? 'border-brand bg-brand-50 text-brand-700'
                  : 'border-line bg-surface text-ink-2 hover:text-brand'
            } ${scopedCount ? 'rounded-l-lg border-r-0' : 'rounded-lg'}`}
         >
            {label} ▾
         </button>
         {scopedCount > 0 && (
            <button
               type="button"
               aria-label="clear scope"
               title="clear scope"
               onClick={() => setScope({ repos: [], authors: [] })}
               className="pressable inline-flex h-8 items-center rounded-r-lg border border-brand bg-brand-50 px-2 text-[13px] font-medium text-brand-700"
            >
               ✕
            </button>
         )}
         {open && (
            <span
               ref={panelRef}
               tabIndex={-1}
               role="dialog"
               aria-label="Scope filter"
               className="popover absolute top-full left-0 z-50 mt-1 block max-h-[420px] w-[296px] overflow-auto rounded-lg border border-line bg-surface p-2 shadow-md outline-none"
            >
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
                                 // the full roster, not just members with open
                                 // PRs today: a preset that snapshots current
                                 // authors silently drops quiet teammates
                                 setScope({ ...scope, authors: [...t.members] })
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
