import type { DerivedPull } from '../../../../shared/model/status';
import { weightFilterKey } from '../../../../shared/model/status';
import { ChecklistFilter } from './shared';

/** Weight filter option order: lightest to heaviest — mirrors the rail's
 * own weight-letter read (XS through XL). */
const WEIGHT_OPTIONS: { key: string; label: string }[] = [
   { key: 'xs', label: 'XS · very light' },
   { key: 's', label: 'S · light' },
   { key: 'm', label: 'M · medium' },
   { key: 'l', label: 'L · heavy' },
   { key: 'xl', label: 'XL · very heavy' },
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
   const value = weightSel.length ? weightSel.map(k => k.toUpperCase()).join(', ') : null;

   return (
      <ChecklistFilter
         popoverLabel="Weight filter"
         triggerLabel="Weight"
         // a lone weight is short enough to BE the badge; more collapse to
         // their count ('unknown' can only arrive via a weight: query token
         // — the panel doesn't offer it)
         badge={
            weightSel.length === 0
               ? null
               : weightSel.length === 1
                 ? weightSel[0] === 'unknown'
                    ? '?'
                    : weightSel[0].toUpperCase()
                 : String(weightSel.length)
         }
         triggerTitle={value ? `Weight · ${value}` : undefined}
         ariaLabel={`weight filter: ${value ?? 'off'}`}
         options={WEIGHT_OPTIONS}
         counts={counts}
         selected={weightSel}
         onToggle={toggle}
         onOnly={key => setWeightSel([key])}
         onClear={() => setWeightSel([])}
      />
   );
}
