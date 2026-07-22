import type { DerivedPull } from '../../model/status';
import { weightFilterKey } from '../../model/status';
import { Popover } from '../Popover';
import { FilterRow, OnlyButton } from './shared';

/** Weight filter option order: lightest to heaviest, then the unknown-size
 * catch-all — mirrors the WeightMeter's own light-to-heavy read. */
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

   const active = weightSel.length > 0;
   const summary = active ? `Weight · ${weightSel.join(', ')}` : 'Weight';

   return (
      <div>
         <Popover
            label="Weight filter"
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
                  aria-label={`weight filter: ${summary}`}
               >
                  <svg
                     viewBox="0 0 16 16"
                     aria-hidden
                     className="h-3.5 w-3.5 flex-none fill-current"
                  >
                     <path d="M2 12.5h12v1.5H2v-1.5Zm1-3h2.5V13H3V9.5Zm3.5-3H8V13H6.5V6.5Zm3.5-3h1.5V13H10V3.5Z" />
                  </svg>
                  <span className="hidden truncate sm:inline">{summary}</span>
                  <span aria-hidden className="ml-auto text-ink-3">
                     ▾
                  </span>
               </button>
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
