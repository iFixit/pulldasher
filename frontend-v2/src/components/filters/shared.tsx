import type { ChangeEvent, ReactNode } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { Icon } from '../Icon';
import type { PopoverTriggerProps } from '../Popover';

/**
 * The one filter-bar trigger: a quiet text-level control, not a bordered
 * button. The bar's normal state is "a few filters always on", so an active
 * filter can't wear highlight chrome — the whole ladder is typographic:
 * inactive = muted word, active = the dimension's VALUE named in ink with a
 * small clear ×. The trigger is the chip; there is no second pill restating
 * it elsewhere. (No leading icons either: six pictograms said less than the
 * six words, and cost a row of decoding.)
 */
export function FilterTrigger({
   t,
   label,
   value,
   onClear,
   ariaLabel,
}: {
   t: PopoverTriggerProps;
   /** the dimension name, always visible: Repos, People, Weight… */
   label: string;
   /** the active selection, named ("XS, S"); null/empty = inactive */
   value?: string | null;
   /** clears just this dimension (renders the × beside the trigger) */
   onClear?: () => void;
   ariaLabel: string;
}) {
   return (
      <span className="inline-flex items-center">
         <button
            {...t}
            type="button"
            title={value ? `${label} · ${value}` : label}
            aria-label={ariaLabel}
            className="hit pressable inline-flex max-w-[240px] items-center gap-1 rounded-md px-1.5 py-1 text-[13px] text-ink-3 hover:text-ink"
         >
            {value ? (
               <>
                  <span className="flex-none">{label} ·</span>
                  <span className="truncate font-medium text-ink">{value}</span>
               </>
            ) : (
               label
            )}
            <Icon icon={ChevronDown} size={12} className="flex-none" />
         </button>
         {value && onClear && (
            <button
               type="button"
               onClick={onClear}
               aria-label={`clear ${label} filter`}
               className="hit pressable -ml-0.5 rounded px-0.5 text-ink-3 hover:text-brand"
            >
               <Icon icon={X} size={12} />
            </button>
         )}
      </span>
   );
}

/**
 * Whether any TRANSIENT session filter is narrowing (or revealing) the board
 * right now — what the bar's "Reset" resets, and what the saved-filters
 * panel reads to decide whether there's anything worth bookmarking. One
 * definition so the two surfaces can't disagree about what counts as
 * "active". Durable state (hidden, stars, defaults) is deliberately not here.
 */
export function hasActiveFilters({
   reveal,
   showAll,
   draftsMode,
   defaultDraftsMode,
   scope,
   weightSel,
   stateSel,
}: {
   reveal: string[];
   showAll: boolean;
   draftsMode: 'mine' | 'all';
   defaultDraftsMode: 'mine' | 'all';
   scope: { repos: string[]; authors: string[]; notAuthors: string[] };
   weightSel: string[];
   stateSel: string[];
}): boolean {
   return (
      scope.repos.length > 0 ||
      scope.authors.length > 0 ||
      scope.notAuthors.length > 0 ||
      weightSel.length > 0 ||
      stateSel.length > 0 ||
      reveal.length > 0 ||
      showAll ||
      draftsMode !== defaultDraftsMode
   );
}

/**
 * The one filter-panel search input, replacing the three copy-pasted
 * `h-8 w-full rounded-lg...` text inputs that used to live separately in
 * Filters' repo tab, its people tab, RepoManager, and TeamPicker.
 */
export function FilterSearch({
   value,
   onChange,
   label,
   className = '',
}: {
   value: string;
   onChange: (next: string) => void;
   label: string;
   className?: string;
}) {
   return (
      <input
         value={value}
         onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
         aria-label={label}
         placeholder={label}
         type="text"
         className={`mb-2 h-8 w-full rounded-lg border border-line bg-surface px-2.5 text-[13px] ${className}`}
      />
   );
}

/**
 * The hover-highlighted row shell RepoFilter and PeopleFilter both wrap their
 * checkbox rows in — one definition so the row geometry (padding, radius,
 * hover tint) can't drift between the two lists.
 */
export function FilterRow({ children }: { children: ReactNode }) {
   return (
      <div className="group flex items-center gap-2 rounded-md px-1.5 py-[5px] transition-[background-color] duration-150 ease-out hover:bg-muted motion-reduce:transition-none">
         {children}
      </div>
   );
}

/**
 * The "only" quick-action: narrows a filter-picker's selection to exactly
 * this one row's item, deselecting everything else. Hidden until the row is
 * hovered or the button itself is keyboard-focused, so it never crowds the
 * row's existing checkbox/star/hide buttons while still being reachable
 * without a mouse. Mirrors v1's filter "only" feature.
 */
export function OnlyButton({ onClick }: { onClick: () => void }) {
   return (
      <button
         type="button"
         className="hit pressable rounded px-1 text-xs leading-none text-ink-3 opacity-0 transition-opacity duration-150 hover:text-brand focus-visible:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
         onClick={e => {
            e.stopPropagation();
            onClick();
         }}
      >
         only
      </button>
   );
}
