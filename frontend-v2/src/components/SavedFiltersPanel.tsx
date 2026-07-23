import {
   useEffect,
   useId,
   useRef,
   useState,
   type FocusEvent,
   type KeyboardEvent,
   type RefObject,
} from 'react';
import { Check, Search, X } from 'lucide-react';
import {
   applySavedFilter,
   deleteFilter,
   describeHash,
   findSavedName,
   saveFilter,
   useSavedFilters,
   type SavedFilter,
} from '../model/savedFilters';
import { QuietButton } from './bits';
import { FilterTrigger } from './filters/shared';
import { Icon } from './Icon';
import { Popover } from './Popover';

/**
 * One saved-filter row, shared by the query-box panel and the header "Saved"
 * menu — the two doors into the same list, so a row must read identically in
 * both: name + a muted one-line gloss of what it narrows, a quiet brand ✓
 * when it IS the view on screen, and a remove affordance that only shows on
 * row hover/focus. There is exactly one kind of row: the starters are
 * planted into the store on first load and are as removable as anything the
 * user saved.
 */
function SavedFilterRow({
   filter,
   id,
   active,
   current,
   onApply,
   onRemove,
}: {
   filter: SavedFilter;
   id?: string;
   /** keyboard-highlighted (query panel only) */
   active?: boolean;
   /** this row's hash IS the view on screen */
   current?: boolean;
   onApply: () => void;
   onRemove: () => void;
}) {
   // arm-then-confirm, same pattern as Settings' "Clear settings": a saved
   // filter can be a hand-tuned query, so a single misclick on the ✕ must not
   // erase it — first click arms for 4s, the second actually removes
   const [armed, setArmed] = useState(false);
   const disarm = useRef<ReturnType<typeof setTimeout> | null>(null);
   useEffect(
      () => () => {
         if (disarm.current) clearTimeout(disarm.current);
      },
      []
   );
   return (
      <div
         id={id}
         role="option"
         aria-selected={active}
         className={`group flex items-center gap-1 rounded-md px-1.5 py-[5px] transition-[background-color] duration-150 ease-out hover:bg-muted motion-reduce:transition-none ${
            active ? 'bg-muted' : ''
         }`}
      >
         <button
            type="button"
            onClick={onApply}
            className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
         >
            <span className="flex min-w-0 items-center gap-1.5">
               <span className="truncate text-[13px] font-medium text-ink">{filter.name}</span>
               {current && (
                  <span className="flex-none text-brand" title="the view you’re on right now">
                     <Icon icon={Check} size={12} />
                  </span>
               )}
            </span>
            <span className="truncate text-xs text-ink-3">{describeHash(filter.hash)}</span>
         </button>
         <span
            className={`flex-none transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none ${
               armed ? 'opacity-100' : 'opacity-0'
            }`}
         >
            <QuietButton
               onClick={e => {
                  e.stopPropagation();
                  if (!armed) {
                     setArmed(true);
                     disarm.current = setTimeout(() => setArmed(false), 4000);
                     return;
                  }
                  if (disarm.current) clearTimeout(disarm.current);
                  onRemove();
               }}
               aria-label={
                  armed
                     ? `confirm removing saved filter ${filter.name}`
                     : `remove saved filter ${filter.name}`
               }
               title={armed ? 'click again to remove' : 'remove this saved filter'}
            >
               {armed ? (
                  <span className="font-medium whitespace-nowrap text-bad">sure?</span>
               ) : (
                  <Icon icon={X} size={12} />
               )}
            </QuietButton>
         </span>
      </div>
   );
}

/**
 * The save affordance, identical in both doors and honest about state:
 * nothing narrowing → a quiet hint; an unsaved view on screen → "Save this
 * view…" opening an inline name field; a view that IS saved → its name, so
 * the button never offers to duplicate what already exists.
 */
function SaveCurrentView({
   currentHash,
   sessionActive,
   savedAs,
   onSaved,
}: {
   currentHash: string;
   sessionActive: boolean;
   /** the name this view is already saved under, if any */
   savedAs: string | null;
   /** close the containing panel after a successful save */
   onSaved?: () => void;
}) {
   const [name, setName] = useState<string | null>(null);
   const nameRef = useRef<HTMLInputElement>(null);
   useEffect(() => {
      if (name != null) nameRef.current?.focus();
   }, [name != null]);

   if (!sessionActive) {
      return (
         <div className="px-1.5 py-1 text-xs text-ink-3">
            Set up filters, then save the view here.
         </div>
      );
   }
   if (savedAs) {
      return (
         <div className="flex items-center gap-1.5 px-1.5 py-1 text-xs text-ink-3">
            <span className="text-brand">
               <Icon icon={Check} size={12} />
            </span>
            This view is saved as “{savedAs}”.
         </div>
      );
   }
   if (name == null) {
      return (
         <button
            type="button"
            onClick={() => setName('')}
            className="hit px-1.5 py-1 text-xs font-medium text-brand hover:underline"
         >
            Save this view…
         </button>
      );
   }
   const save = () => {
      const trimmed = name.trim();
      if (!trimmed) return;
      saveFilter(trimmed, currentHash);
      setName(null);
      onSaved?.();
   };
   return (
      <div className="flex items-center gap-1.5 px-0.5">
         <input
            ref={nameRef}
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
               if (e.key === 'Enter') {
                  e.preventDefault();
                  save();
               } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setName(null);
               }
            }}
            placeholder="Name this view"
            aria-label="Name this view"
            className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-[13px]"
         />
         <QuietButton tone="brand" disabled={!name.trim()} onClick={save}>
            Save
         </QuietButton>
      </div>
   );
}

/**
 * The query box's own door into saved filters: focus the EMPTY filter input
 * and the list drops under it — arrow keys highlight a row, Enter applies
 * it, Escape closes without losing focus. Typing anything closes it and the
 * input goes back to being a plain filter box. Same rows, same save
 * affordance as the header's Saved menu: one feature, two doors.
 *
 * Hand-rolled rather than built on the house Popover: Popover's usePopover
 * pins/unpins on trigger *clicks* and returns focus to a trigger *button* on
 * Escape, both wrong for a text input that needs to open on focus, stay open
 * while typing a save-name in its own footer field, and never steal focus
 * from itself. It reuses Popover's visual vocabulary (the `popover`
 * animation class, the same border/shadow/radius) so it still reads as the
 * same kind of panel.
 */
export function SavedFiltersInput({
   query,
   setQuery,
   inputRef,
   currentHash,
   sessionActive,
   inputProps,
}: {
   query: string;
   setQuery: (next: string) => void;
   inputRef: RefObject<HTMLInputElement>;
   /** the hash a save right now would capture (buildHash of the live state) */
   currentHash: string;
   /** whether the current session has anything worth bookmarking (mirrors
    * FilterChips' hasActiveFilters) — gates the "Save this view…" row */
   sessionActive: boolean;
   /** the search input's existing aria-label/placeholder/title/className, so
    * this wrapper doesn't have to restate app.tsx's exact copy */
   inputProps: {
      'aria-label': string;
      placeholder: string;
      title: string;
      className: string;
   };
}) {
   const saved = useSavedFilters();
   const savedAs = sessionActive ? findSavedName(saved, currentHash) : null;

   const [open, setOpen] = useState(false);
   const [activeIndex, setActiveIndex] = useState(-1);
   const listboxId = useId();

   useEffect(() => {
      if (!open) setActiveIndex(-1);
   }, [open]);

   const apply = (hash: string) => {
      applySavedFilter(hash);
      setOpen(false);
   };

   // one blur handler on the wrapper covers the input, every row button, and
   // the save-name field: focus moving anywhere still inside the wrapper
   // (e.g. into the save-name input) keeps the panel open, and only a focus
   // that lands truly outside closes it. This is the "focus/blur with a
   // click-away" the panel needs in place of Popover's click-toggle model.
   const onWrapperBlur = (e: FocusEvent<HTMLSpanElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
   };

   const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (!open) return;
      if (e.key === 'ArrowDown') {
         e.preventDefault();
         setActiveIndex(i => Math.min(i + 1, saved.length - 1));
      } else if (e.key === 'ArrowUp') {
         e.preventDefault();
         setActiveIndex(i => Math.max(i - 1, -1));
      } else if (e.key === 'Enter') {
         if (activeIndex >= 0 && saved[activeIndex]) {
            e.preventDefault();
            apply(saved[activeIndex].hash);
         }
      } else if (e.key === 'Escape') {
         e.preventDefault();
         setOpen(false);
      }
   };

   const activeId = activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined;
   // an empty list with nothing to save would open an empty box — stay shut
   const canOpen = saved.length > 0 || sessionActive;

   return (
      <span
         className="relative ml-auto inline-flex max-w-full grow items-center sm:grow-0"
         onBlur={onWrapperBlur}
      >
         <Icon icon={Search} className="pointer-events-none absolute left-2.5 text-ink-3" />
         <input
            ref={inputRef}
            type="search"
            aria-label={inputProps['aria-label']}
            placeholder={inputProps.placeholder}
            title={inputProps.title}
            value={query}
            onChange={e => {
               const next = e.target.value;
               setQuery(next);
               if (next) setOpen(false);
            }}
            onFocus={() => {
               if (!query && canOpen) setOpen(true);
            }}
            onKeyDown={onInputKeyDown}
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={activeId}
            aria-autocomplete="none"
            className={inputProps.className}
         />
         {open && (
            <div
               id={listboxId}
               role="listbox"
               aria-label="Saved filters"
               className="popover popover-right absolute top-full right-0 z-50 mt-1 w-[300px] max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-2 text-[13px] shadow-md outline-none"
            >
               {saved.map((f, i) => (
                  <SavedFilterRow
                     key={f.name}
                     id={`${listboxId}-${i}`}
                     filter={f}
                     active={i === activeIndex}
                     current={f.name === savedAs}
                     onApply={() => apply(f.hash)}
                     onRemove={() => deleteFilter(f.name)}
                  />
               ))}
               {sessionActive && (
                  <div className={saved.length ? 'mt-1.5 border-t border-secondary pt-1.5' : ''}>
                     <SaveCurrentView
                        currentHash={currentHash}
                        sessionActive={sessionActive}
                        savedAs={savedAs}
                        onSaved={() => setOpen(false)}
                     />
                  </div>
               )}
            </div>
         )}
      </span>
   );
}

/**
 * The header's "Saved ▾" trigger — the feature's permanent home, always in
 * the bar: the full list plus the save affordance, honest about whether the
 * view on screen is already saved. Wears the same quiet FilterTrigger the
 * four dimension triggers wear, so the bar reads as one family.
 */
export function SavedFiltersMenu({
   currentHash,
   sessionActive,
}: {
   currentHash: string;
   sessionActive: boolean;
}) {
   const saved = useSavedFilters();
   const savedAs = sessionActive ? findSavedName(saved, currentHash) : null;

   return (
      <div>
         <Popover
            label="Saved filters"
            width="w-[300px]"
            panelClass="max-h-[400px] overflow-auto p-2"
            rootClass="relative inline-flex items-center"
            trigger={t => (
               <FilterTrigger
                  t={t}
                  label="Saved"
                  ariaLabel={`saved filters: ${saved.length} saved`}
               />
            )}
         >
            {saved.map(f => (
               <SavedFilterRow
                  key={f.name}
                  filter={f}
                  current={f.name === savedAs}
                  onApply={() => applySavedFilter(f.hash)}
                  onRemove={() => deleteFilter(f.name)}
               />
            ))}
            {saved.length === 0 && (
               <div className="px-1.5 py-1 text-xs text-ink-3">Nothing saved yet.</div>
            )}
            <div className="mt-1.5 border-t border-secondary pt-1.5">
               <SaveCurrentView
                  currentHash={currentHash}
                  sessionActive={sessionActive}
                  savedAs={savedAs}
               />
            </div>
         </Popover>
      </div>
   );
}
