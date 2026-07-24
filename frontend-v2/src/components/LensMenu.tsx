import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Lens } from '../app';
import { Icon } from './Icon';
import { Popover } from './Popover';

interface LensOption {
   id: Lens;
   label: string;
   count?: number;
}

/**
 * The phone-width twin of app.tsx's lens tab strip: below `sm` the six tabs
 * no longer fit and silently horizontal-scroll (no-scrollbar hides the
 * scrollbar too, so the swipe is undiscoverable on a phone) — this renders
 * the same six choices as a single Popover dropdown instead, the same
 * trigger-plus-portal-panel composition StateFilter uses for its own
 * single-choice list.
 *
 * `pick` is keyed onto the Popover so every selection remounts it, forcing
 * its internal open state back to closed. Popover's `children` have no
 * exposed close callback (its other consumers are multi-select filters that
 * stay open across picks), and this reuses the component exactly as-is
 * rather than growing its API for one caller.
 */
export function LensMenu({
   lens,
   setLens,
   options,
   className = '',
}: {
   lens: Lens;
   setLens: (next: Lens) => void;
   options: LensOption[];
   className?: string;
}) {
   const [pick, setPick] = useState(0);
   const current = options.find(o => o.id === lens);

   return (
      <div className={className}>
         <Popover
            key={pick}
            label="Switch view"
            width="w-[200px]"
            panelClass="p-1"
            rootClass="relative inline-flex items-center"
            trigger={t => (
               <button
                  {...t}
                  type="button"
                  aria-label={`switch view, current: ${current?.label ?? lens}`}
                  className="pressable inline-flex shrink-0 items-center gap-1 rounded-lg border-0 bg-secondary px-3 py-2 text-sm font-medium whitespace-nowrap text-ink"
               >
                  {current?.label ?? lens}
                  <Icon icon={ChevronDown} size={12} className="flex-none" />
               </button>
            )}
         >
            {options.map(({ id, label, count }) => (
               <button
                  key={id}
                  type="button"
                  aria-current={lens === id ? 'page' : undefined}
                  onClick={() => {
                     setLens(id);
                     setPick(p => p + 1);
                  }}
                  className={`pressable flex w-full items-center justify-between gap-2 rounded-md border-0 px-2.5 py-1.5 text-left text-sm font-medium whitespace-nowrap ${
                     lens === id
                        ? 'bg-secondary text-ink'
                        : 'bg-transparent text-ink-2 hover:text-brand'
                  }`}
               >
                  {label}
                  {count != null && count > 0 && (
                     <span className="text-xs text-ink-3 tabular-nums">{count}</span>
                  )}
               </button>
            ))}
         </Popover>
      </div>
   );
}
