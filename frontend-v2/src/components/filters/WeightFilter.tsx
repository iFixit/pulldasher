import type { DerivedPull } from '../../model/status';
import { weightFilterKey } from '../../model/status';
import { Popover } from '../Popover';
import { FilterRow, FilterTrigger, OnlyButton } from './shared';

/** Weight filter option order: lightest to heaviest, then the unknown-size
 * catch-all — mirrors the rail's own weight-letter read (XS through XL). */
const WEIGHT_OPTIONS: { key: string; label: string }[] = [
   { key: 'xs', label: 'XS · very light' },
   { key: 's', label: 'S · light' },
   { key: 'm', label: 'M · medium' },
   { key: 'l', label: 'L · heavy' },
   { key: 'xl', label: 'XL · very heavy' },
   { key: 'unknown', label: 'Size unknown' },
];

/**
 * The point-and-click twin of the `weight:` query token: narrow the board to
 * one or more review-effort classes. `pulls` is the pre-weight-filtered
 * pool (app.tsx's scoped list before this filter's own pass applies) so a
 * selection never makes the *other* options' counts vanish — the same
 * precedent PeopleFilter's authorCounts sets for its own pool.
 */
export function WeightFilter({
   pulls,
   weightSel,
   setWeightSel,
}: {
   pulls: DerivedPull[];
   weightSel: string[];
   setWeightSel: (next: string[]) => void;
}) {
   const counts = new Map<string, number>();
   for (const p of pulls) {
      const key = weightFilterKey(p);
      counts.set(key, (counts.get(key) ?? 0) + 1);
   }

   const toggle = (key: string) => {
      const next = weightSel.includes(key) ? weightSel.filter(k => k !== key) : [...weightSel, key];
      setWeightSel(next);
   };

   // the rail spells weights as letters (XS…XL); the trigger matches it
   const value = weightSel.length
      ? weightSel.map(k => (k === 'unknown' ? 'unknown' : k.toUpperCase())).join(', ')
      : null;

   return (
      <div>
         <Popover
            label="Weight filter"
            width="w-[220px]"
            panelClass="p-2"
            rootClass="relative inline-flex items-center"
            trigger={t => (
               <FilterTrigger
                  t={t}
                  label="Weight"
                  value={value}
                  onClear={() => setWeightSel([])}
                  ariaLabel={`weight filter: ${value ?? 'off'}`}
               />
            )}
         >
            {WEIGHT_OPTIONS.map(({ key, label }) => (
               <FilterRow key={key}>
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                     <input
                        type="checkbox"
                        className="m-0"
                        checked={weightSel.includes(key)}
                        onChange={() => toggle(key)}
                     />
                     <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
                     <span className="text-[11px] text-ink-3 tabular-nums">
                        {counts.get(key) || ''}
                     </span>
                  </label>
                  <OnlyButton onClick={() => setWeightSel([key])} />
               </FilterRow>
            ))}
         </Popover>
      </div>
   );
}
