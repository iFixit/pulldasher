import { useState } from 'react';
import { ChevronRight, GripVertical } from 'lucide-react';
import { repoHidden } from '../../../../shared/model/visibility';
import { shortRepo } from '../../../../shared/format';
import { toggleScopeMember, type Scope } from '../../prefs';
import { setRepoPref, setSettings, useSettings } from '../../settings';
import { Icon } from '../Icon';
import { Popover } from '../Popover';
import {
   CheckboxField,
   ClearRow,
   EyeButton,
   FilterRow,
   FilterSearch,
   FilterTrigger,
   OnlyButton,
} from './shared';

/**
 * The repos filter: opens straight into the repo list (no tabs — the old
 * 3-tab Filters popover split repos/people/drafts behind a Segmented click
 * you had to make before you could even search). Scope (which repos are on
 * your board right now) and hide (which repos are off your board, period)
 * live side by side on each row. Hiding is per-user only: the server
 * config's v1-era org-level mute is ignored — each user hides a repo once,
 * their call.
 *
 * The list's ORDER is load-bearing: rows sort by settings.repoPriority — the
 * same order the review queue renders its repo blocks in — and the grip
 * handle reorders it (drag, or arrow keys on the focused grip). This panel
 * is the one place the order changes; Settings keeps only the per-repo cap.
 * (Parked PRs and drafts used to ride along here as session toggles; they're
 * board-level hiding, so they live in the filter bar's hidden-PR ledger now —
 * see HiddenPanel.)
 */
export function RepoFilter({
   repos,
   reveal,
   toggleReveal,
   showAll,
   setShowAll,
   scope,
   setScope,
}: {
   /** all repos with open-PR counts (user-hidden included) */
   repos: { name: string; count: number }[];
   reveal: string[];
   toggleReveal: (key: string) => void;
   showAll: boolean;
   setShowAll: (next: boolean) => void;
   scope: Scope;
   setScope: (next: Scope) => void;
}) {
   const settings = useSettings();
   const prefs = settings.repoPrefs;
   const priority = settings.repoPriority;
   const [repoQuery, setRepoQuery] = useState('');
   const [dragging, setDragging] = useState<string | null>(null);
   const [dropTarget, setDropTarget] = useState<string | null>(null);

   // the list shows YOUR order: priority-listed repos first, in that order
   // (stable sort keeps the incoming count order among the unlisted tail)
   const orderOf = (name: string) => {
      const i = priority.indexOf(name);
      return i === -1 ? Number.POSITIVE_INFINITY : i;
   };
   const shownRepos = repos
      .filter(r => !repoHidden(r.name, prefs))
      .sort((a, b) => orderOf(a.name) - orderOf(b.name));
   const hiddenRepos = repos.filter(r => repoHidden(r.name, prefs));

   // any reorder writes the full shown order as the priority — after the
   // first drag every visible repo is explicitly placed, which is exactly
   // what the user just expressed
   const reorder = (name: string, target: string) => {
      if (name === target) return;
      const order = shownRepos.map(r => r.name);
      order.splice(order.indexOf(name), 1);
      // inserting at the target's post-removal index lands before it when
      // dragging up and after it when dragging down — the intuitive drop
      order.splice(order.indexOf(target), 0, name);
      setSettings({ repoPriority: order });
   };
   const nudge = (name: string, key: string) => {
      const order = shownRepos.map(r => r.name);
      const i = order.indexOf(name);
      const j = key === 'ArrowUp' ? i - 1 : i + 1;
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      setSettings({ repoPriority: order });
   };

   const toggleScope = (name: string, all: string[]) =>
      setScope(toggleScopeMember(scope, 'repos', name, all));
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
      <FilterRow
         key={name}
         onDragOver={e => {
            if (!dragging) return;
            e.preventDefault();
            setDropTarget(name);
         }}
         onDrop={e => {
            e.preventDefault();
            if (dragging) reorder(dragging, name);
            setDragging(null);
            setDropTarget(null);
         }}
         // an inset shadow, not a border: the drop indicator must not move
         // the rows it's pointing between
         style={
            dropTarget === name && dragging !== name
               ? { boxShadow: 'inset 0 2px 0 0 var(--brand)' }
               : undefined
         }
      >
         <span
            role="button"
            tabIndex={0}
            draggable
            aria-label={`reorder ${shortRepo(name)} — drag, or arrow keys; this order is your review queue's repo order`}
            title="drag to reorder — the queue shows repos in this order"
            className="cursor-grab touch-none text-ink-3 hover:text-ink focus-visible:text-brand active:cursor-grabbing"
            onDragStart={e => {
               setDragging(name);
               e.dataTransfer.effectAllowed = 'move';
               e.dataTransfer.setData('text/plain', name);
            }}
            onDragEnd={() => {
               setDragging(null);
               setDropTarget(null);
            }}
            onKeyDown={e => {
               if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
               e.preventDefault();
               nudge(name, e.key);
            }}
         >
            <Icon icon={GripVertical} size={13} />
         </span>
         <CheckboxField
            checked={included(name)}
            onChange={() =>
               toggleScope(
                  name,
                  shownRepos.map(r => r.name)
               )
            }
            ariaLabel={`scope to ${shortRepo(name)}`}
            title={name}
         >
            {shortRepo(name)}
         </CheckboxField>
         {/* "only" leads the right cluster: it fades in on hover, so it must
             not interject between the standing count and eye */}
         <OnlyButton onClick={() => setScope({ ...scope, repos: [name] })} />
         <span className="text-[11px] text-ink-3 tabular-nums">{count || ''}</span>
         <EyeButton
            hidden={false}
            subject={shortRepo(name)}
            onClick={() => setRepoPref(name, 'hide')}
         />
      </FilterRow>
   );

   const hiddenRow = (name: string, count: number) => (
      <FilterRow key={name}>
         <CheckboxField
            checked={showAll || reveal.includes(name)}
            disabled={showAll}
            onChange={() => toggleReveal(name)}
            ariaLabel={`reveal ${shortRepo(name)} for now`}
            title={name}
            textClassName="min-w-0 flex-1 truncate text-[13px] text-ink-3"
            count={count || ''}
         >
            {shortRepo(name)}
         </CheckboxField>
         <EyeButton hidden subject={shortRepo(name)} onClick={() => setRepoPref(name, null)} />
      </FilterRow>
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
               <details className="group mb-1.5 border-b border-secondary pb-1.5">
                  <summary className="flex cursor-pointer items-center gap-1 px-1.5 py-1 text-xs font-semibold text-ink-3">
                     {/* the caret is the fold affordance — without it this row
                         read as a label, not a door (owner report) */}
                     <Icon
                        icon={ChevronRight}
                        size={12}
                        className="flex-none transition-transform duration-150 ease-out group-open:rotate-90 motion-reduce:transition-none"
                     />
                     Hidden by you ({filteredHidden.length})
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
                  {filteredHidden.map(r => hiddenRow(r.name, r.count))}
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
