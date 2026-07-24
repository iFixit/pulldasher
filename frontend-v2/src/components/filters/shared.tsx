import type { ChangeEvent, ComponentPropsWithoutRef, ReactNode } from 'react';
import { ChevronDown, Eye, EyeClosed } from 'lucide-react';
import { Icon } from '../Icon';
import { Popover, type PopoverTriggerProps } from '../Popover';
import { CornerBadge, QuietButton, textInputClass } from '../bits';

/**
 * The one filter-bar trigger: a quiet text-level control whose geometry NEVER
 * changes. The dimension name is the whole trigger; the active state rides as
 * a small corner badge of 1–3 characters — a count, or the value itself when
 * it fits (a lone weight's "S"), or a −count for an excluding selection — so
 * narrowing the board can't reflow the bar. Full words live in the hover
 * title and aria-label; the panel behind the click is the detail view, and
 * clearing lives in the panel too (ClearRow), not as an appearing ×.
 */
export function FilterTrigger({
   t,
   label,
   badge,
   badgeTone = 'brand',
   active = false,
   title,
   ariaLabel,
}: {
   t: PopoverTriggerProps;
   /** the dimension name, always visible: Repos, People, Weight… */
   label: string;
   /** 1–3 character summary of the active state; null/empty = no badge */
   badge?: string | null;
   /** 'brand' = a narrowing you chose; 'quiet' = standing info (the hidden
    * ledger's count) */
   badgeTone?: 'brand' | 'quiet';
   /** a standing non-badge state (e.g. "showing hidden") — carried by color
    * only, so the trigger still never moves */
   active?: boolean;
   /** full-words active state for the hover title (the badge abbreviates) */
   title?: string;
   ariaLabel: string;
}) {
   return (
      <button
         {...t}
         type="button"
         title={title ?? label}
         aria-label={ariaLabel}
         className={`hit pressable relative inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[13px] ${
            active ? 'font-medium text-brand' : 'text-ink-3 hover:text-ink'
         }`}
      >
         {label}
         <Icon icon={ChevronDown} size={12} className="flex-none" />
         {!!badge && <CornerBadge text={badge} tone={badgeTone} />}
      </button>
   );
}

/**
 * The panel-footer clear for one dimension — the home the bar's per-trigger ×
 * moved into when triggers went geometry-constant. Renders nothing while the
 * dimension is inactive, so panels only offer what would do something.
 */
export function ClearRow({ active, onClear }: { active: boolean; onClear: () => void }) {
   if (!active) return null;
   return (
      <div className="mt-1.5 border-t border-secondary pt-1.5">
         <QuietButton onClick={onClear}>Clear</QuietButton>
      </div>
   );
}

/**
 * Whether any TRANSIENT session filter is narrowing (or revealing) the board
 * right now — what the bar's "Reset" resets, and what the saved-filters
 * panel reads to decide whether there's anything worth bookmarking. One
 * definition so the two surfaces can't disagree about what counts as
 * "active". Durable state (hidden, defaults) is deliberately not here.
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
         className={`mb-2 w-full px-2.5 ${textInputClass} ${className}`}
      />
   );
}

/**
 * The hover-highlighted row shell every checkbox/candidate list on the board
 * wraps its rows in (RepoFilter, PeopleFilter, WeightFilter, StateFilter):
 * one definition so the row geometry (padding, radius, hover tint) can't
 * drift between lists. Also the shared substring behind SavedFilterRow's and
 * TeamPicker's CandidateRow's hand-copies of the same recipe (see
 * `hoverRowClass`) — those rows differ just enough (no `group`, a different
 * gap, an extra text-size class) that they compose it themselves rather than
 * rendering through this component.
 */
export const hoverRowClass =
   'flex items-center rounded-md px-1.5 py-[5px] transition-[background-color] duration-150 ease-out hover:bg-muted motion-reduce:transition-none';

export function FilterRow({
   children,
   ...rest
}: { children: ReactNode } & ComponentPropsWithoutRef<'div'>) {
   return (
      <div {...rest} className={`group ${hoverRowClass} gap-2`}>
         {children}
      </div>
   );
}

/**
 * The labelled-checkbox inner block every checkbox row on the board shares
 * (WeightFilter, StateFilter, RepoFilter, HiddenPanel, PeopleFilter,
 * TeamPicker's CandidateRow): a native checkbox, an optional leading slot
 * (an avatar), the option's text, and an optional trailing count — one
 * definition so the five copy-pasted versions of this can't drift. The row
 * wrapper (FilterRow or a caller's own div) and any sibling OnlyButton/
 * EyeButton stay at the call site — this only ever renders the `<label>`.
 *
 * `className`/`textClassName` default to the recipe most callers share, but
 * a couple of rows (HiddenPanel's wider text column, TeamPicker's row that
 * already carries `text-[13px]` on the label itself) need their own — both
 * are fully overridable rather than assumed.
 *
 * Accessibility fix folded into every adopter: a clean `aria-label` (the
 * option name only, no count) instead of relying on the label's full text
 * content — which used to read out as e.g. "django 12" to a screen reader,
 * the count leaking into the accessible name. The count span itself is
 * `aria-hidden` so it never re-enters the name once the checkbox already
 * carries it correctly.
 */
export function CheckboxField({
   checked,
   onChange,
   children,
   count,
   leading,
   ariaLabel,
   disabled,
   title,
   checkboxTitle,
   className = 'flex min-w-0 flex-1 items-center gap-2',
   textClassName = 'min-w-0 flex-1 truncate text-[13px]',
}: {
   checked: boolean;
   onChange: (e: ChangeEvent<HTMLInputElement>) => void;
   /** the option's visible text/content */
   children: ReactNode;
   /** trailing count, rendered aria-hidden; omit to render no count span at
    * all (matches call sites where the count lives outside this label) */
   count?: ReactNode;
   /** rendered between the checkbox and the text — TeamPicker/PeopleFilter's
    * avatar slot */
   leading?: ReactNode;
   /** the checkbox's accessible name — the option name only, never the count */
   ariaLabel: string;
   disabled?: boolean;
   /** native title attribute on the text span (Repo/People rows show the
    * full name on hover) */
   title?: string;
   /** native title attribute on the checkbox itself (PeopleFilter's
    * shift-click hint) */
   checkboxTitle?: string;
   /** override the label wrapper's classes */
   className?: string;
   /** override the text span's classes */
   textClassName?: string;
}) {
   return (
      <label className={className}>
         <input
            type="checkbox"
            className={disabled !== undefined ? 'm-0 disabled:opacity-40' : 'm-0'}
            checked={checked}
            disabled={disabled}
            title={checkboxTitle}
            onChange={onChange}
            aria-label={ariaLabel}
         />
         {leading}
         <span title={title} className={textClassName}>
            {children}
         </span>
         {count != null && (
            <span aria-hidden className="text-[11px] text-ink-3 tabular-nums">
               {count}
            </span>
         )}
      </label>
   );
}

/**
 * The "only" quick-action: narrows a filter-picker's selection to exactly
 * this one row's item, deselecting everything else. Hidden until the row is
 * hovered or the button itself is keyboard-focused, so it never crowds the
 * row's existing checkbox/hide buttons while still being reachable without a
 * mouse. Mirrors v1's filter "only" feature.
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

/**
 * The row-level visibility toggle both filter lists share, replacing the
 * worded Hide/Show pair: an open eye on a visible row (click hides), a
 * closed eye on a hidden one (click shows). Icon-only on purpose — even
 * hover-hidden words reserve layout width, and on a 300px panel the worded
 * buttons were what crushed the name column. Full words live in title/aria.
 * `tone="brand"` marks the show that overrides an org-level hide.
 */
export function EyeButton({
   hidden,
   subject,
   onClick,
   tone = 'quiet',
}: {
   /** the row's current state: hidden rows wear the closed eye */
   hidden: boolean;
   /** what the title/aria name — a repo short name or a login */
   subject: string;
   onClick: () => void;
   tone?: 'quiet' | 'brand';
}) {
   const words = hidden ? `show ${subject} again` : `hide ${subject} from the board`;
   return (
      <button
         type="button"
         title={words}
         aria-label={words}
         className={`pressable rounded-md px-1.5 py-1.5 leading-none ${
            tone === 'brand' ? 'text-brand hover:text-brand/70' : 'text-ink-3 hover:text-brand'
         }`}
         onClick={e => {
            e.stopPropagation();
            onClick();
         }}
      >
         <Icon icon={hidden ? EyeClosed : Eye} size={14} />
      </button>
   );
}

/**
 * The generic shape WeightFilter and StateFilter both build by hand: a count
 * per option over the pre-filtered pool, a toggle over a selection array, a
 * FilterTrigger with a length-derived badge, a FilterRow list of
 * CheckboxField + OnlyButton, and a trailing ClearRow. The badge/title
 * wording differs per filter (a lone weight collapses to its letter; state
 * collapses to "first +N"), so those stay the caller's own derivation —
 * this only owns the popover/list/clear plumbing they'd otherwise repeat.
 */
export function ChecklistFilter<K extends string>({
   popoverLabel,
   triggerLabel,
   badge,
   triggerTitle,
   ariaLabel,
   options,
   counts,
   selected,
   onToggle,
   onOnly,
   onClear,
}: {
   /** the Popover panel's own aria-label, e.g. "Weight filter" */
   popoverLabel: string;
   /** the trigger's always-visible dimension name, e.g. "Weight" */
   triggerLabel: string;
   /** 1–3 character corner-badge text; null/empty renders no badge */
   badge: string | null;
   /** hover title on the trigger when active */
   triggerTitle?: string;
   /** the trigger's accessible name */
   ariaLabel: string;
   options: { key: K; label: string }[];
   /** option key -> open-PR count in the caller's pre-filtered pool */
   counts: Map<K, number>;
   selected: K[];
   onToggle: (key: K) => void;
   onOnly: (key: K) => void;
   onClear: () => void;
}) {
   return (
      <div>
         <Popover
            label={popoverLabel}
            width="w-[220px]"
            panelClass="p-2"
            rootClass="relative inline-flex items-center"
            trigger={t => (
               <FilterTrigger
                  t={t}
                  label={triggerLabel}
                  badge={badge}
                  title={triggerTitle}
                  ariaLabel={ariaLabel}
               />
            )}
         >
            {options.map(({ key, label }) => (
               <FilterRow key={key}>
                  <CheckboxField
                     checked={selected.includes(key)}
                     onChange={() => onToggle(key)}
                     ariaLabel={label}
                     count={counts.get(key) || ''}
                  >
                     {label}
                  </CheckboxField>
                  <OnlyButton onClick={() => onOnly(key)} />
               </FilterRow>
            ))}
            <ClearRow active={selected.length > 0} onClear={onClear} />
         </Popover>
      </div>
   );
}
