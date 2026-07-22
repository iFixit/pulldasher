import { ChevronDown, ClipboardList } from 'lucide-react';
import type { ActionStateKey } from '../../model/actions';
import { actionState } from '../../model/actions';
import type { DerivedPull } from '../../model/status';
import { usePulldasher } from '../../store';
import { Icon } from '../Icon';
import { Popover } from '../Popover';
import { FilterRow, OnlyButton } from './shared';

/**
 * State filter option order: what's waiting on you first (the thing you're
 * most likely to be hunting for), then the two reviewer verbs, then the
 * re-stamp lane, then the two states with no action of your own.
 */
export const STATE_OPTIONS: { key: ActionStateKey; label: string }[] = [
   { key: 'mine', label: 'Waiting on me' },
   { key: 'review', label: 'Review it' },
   { key: 'qa', label: 'QA it' },
   { key: 'restamp', label: 'Re-stamp owed' },
   { key: 'blocked', label: 'Blocked' },
   { key: 'waiting', label: 'Waiting' },
];

/**
 * The point-and-click twin of `has:action` / `is:restamp` / `is:blocked`:
 * narrow the board to one or more actionState buckets (model/actions.ts).
 * `pulls` is the pre-state-filtered pool (app.tsx's scoped list after the
 * Weight pass but before this filter's own pass) so a selection never makes
 * the *other* options' counts vanish — the same precedent PeopleFilter's
 * authorCounts sets for its own pool.
 */
export function StateFilter({
   pulls,
   stateSel,
   setStateSel,
}: {
   pulls: DerivedPull[];
   stateSel: ActionStateKey[];
   setStateSel: (next: ActionStateKey[]) => void;
}) {
   const { me } = usePulldasher();

   const counts = new Map<ActionStateKey, number>();
   for (const p of pulls) {
      const key = actionState(p, me);
      counts.set(key, (counts.get(key) ?? 0) + 1);
   }

   const toggle = (key: ActionStateKey) => {
      const next = stateSel.includes(key) ? stateSel.filter(k => k !== key) : [...stateSel, key];
      setStateSel(next);
   };

   const active = stateSel.length > 0;
   const summary =
      stateSel.length === 0
         ? 'State'
         : stateSel.length === 1
           ? `State · ${STATE_OPTIONS.find(o => o.key === stateSel[0])?.label ?? stateSel[0]}`
           : `State · ${stateSel.length} selected`;

   return (
      <div>
         <Popover
            label="State filter"
            width="w-[220px]"
            panelClass="p-2"
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
                  aria-label={`state filter: ${summary}`}
               >
                  <Icon icon={ClipboardList} />
                  <span className="hidden truncate sm:inline">{summary}</span>
                  <Icon icon={ChevronDown} className="ml-auto text-ink-3" />
               </button>
            )}
         >
            {STATE_OPTIONS.map(({ key, label }) => (
               <FilterRow key={key}>
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                     <input
                        type="checkbox"
                        className="m-0"
                        checked={stateSel.includes(key)}
                        onChange={() => toggle(key)}
                     />
                     <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
                     <span className="text-[11px] text-ink-3 tabular-nums">
                        {counts.get(key) || ''}
                     </span>
                  </label>
                  <OnlyButton onClick={() => setStateSel([key])} />
               </FilterRow>
            ))}
         </Popover>
      </div>
   );
}
