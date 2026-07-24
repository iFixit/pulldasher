import type { ChangeEvent, ReactNode } from 'react';
import { ChevronDown, Eye, EyeClosed } from 'lucide-react';
import { Icon } from '../Icon';
import type { PopoverTriggerProps } from '../Popover';
import { CornerBadge, QuietButton } from '../bits';

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
