import type { ChangeEvent, ReactNode } from 'react';

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
 * row's existing checkbox/star/mute buttons while still being reachable
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
