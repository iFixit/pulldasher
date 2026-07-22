import {
   useEffect,
   useId,
   useRef,
   useState,
   type FocusEvent,
   type KeyboardEvent,
   type RefObject,
} from 'react';
import { Bookmark, ChevronDown, Search, X } from 'lucide-react';
import {
   applySavedFilter,
   deleteFilter,
   describeHash,
   saveFilter,
   SUGGESTED_FILTERS,
   useSavedFilters,
   type SavedFilter,
} from '../model/savedFilters';
import { QuietButton } from './bits';
import { Icon } from './Icon';
import { Popover } from './Popover';

/**
 * One saved (or suggested) filter row, shared by the query-box panel and the
 * header "Saved" menu: name + a muted one-line gloss of what it narrows,
 * with a quiet remove affordance that only shows on row hover/focus (a
 * suggested row has no remove — there's nothing to remove).
 */
function SavedFilterRow({
   filter,
   id,
   active,
   suggested,
   onApply,
   onRemove,
}: {
   filter: SavedFilter;
   id?: string;
   /** keyboard-highlighted (query panel only) */
   active?: boolean;
   suggested?: boolean;
   onApply: () => void;
   onRemove?: () => void;
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
               {suggested && (
                  <span className="flex-none rounded bg-muted px-1 py-px text-[10px] font-medium tracking-wide text-ink-3 uppercase">
                     suggested
                  </span>
               )}
            </span>
            <span className="truncate text-xs text-ink-3">{describeHash(filter.hash)}</span>
         </button>
         {onRemove && (
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
         )}
      </div>
   );
}

/**
 * The query box's own panel: focus an EMPTY filter input and it drops a list
 * of saved filters (or, before you've saved any, two suggested starting
 * points) under the input — arrow keys highlight a row, Enter applies it,
 * Escape closes without losing focus. Typing anything closes it and the
 * input goes back to being a plain filter box.
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
    * FilterChips' hasActiveFilters) — gates the "Save current filter…" row */
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
   const suggested = saved.length === 0;
   const rows = suggested ? SUGGESTED_FILTERS : saved;

   const [open, setOpen] = useState(false);
   const [activeIndex, setActiveIndex] = useState(-1);
   const [showSaveForm, setShowSaveForm] = useState(false);
   const [saveName, setSaveName] = useState('');
   const listboxId = useId();
   const saveNameRef = useRef<HTMLInputElement>(null);

   useEffect(() => {
      if (open) return;
      setActiveIndex(-1);
      setShowSaveForm(false);
      setSaveName('');
   }, [open]);

   useEffect(() => {
      if (showSaveForm) saveNameRef.current?.focus();
   }, [showSaveForm]);

   const apply = (hash: string) => {
      applySavedFilter(hash);
      setOpen(false);
   };
   const save = () => {
      const name = saveName.trim();
      if (!name) return;
      saveFilter(name, currentHash);
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
         setActiveIndex(i => Math.min(i + 1, rows.length - 1));
      } else if (e.key === 'ArrowUp') {
         e.preventDefault();
         setActiveIndex(i => Math.max(i - 1, -1));
      } else if (e.key === 'Enter') {
         if (activeIndex >= 0 && rows[activeIndex]) {
            e.preventDefault();
            apply(rows[activeIndex].hash);
         }
      } else if (e.key === 'Escape') {
         e.preventDefault();
         setOpen(false);
      }
   };

   const activeId = activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined;

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
               if (!query) setOpen(true);
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
               className="popover popover-right absolute top-full right-0 z-30 mt-1 w-[300px] max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-2 text-[13px] shadow-md outline-none"
            >
               {suggested && (
                  <div className="px-1.5 pb-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                     Suggested
                  </div>
               )}
               {rows.map((f, i) => (
                  <SavedFilterRow
                     key={f.name}
                     id={`${listboxId}-${i}`}
                     filter={f}
                     active={i === activeIndex}
                     suggested={suggested}
                     onApply={() => apply(f.hash)}
                     onRemove={suggested ? undefined : () => deleteFilter(f.name)}
                  />
               ))}
               {sessionActive && (
                  <div className="mt-1.5 border-t border-secondary pt-1.5">
                     {showSaveForm ? (
                        <div className="flex items-center gap-1.5 px-0.5">
                           <input
                              ref={saveNameRef}
                              value={saveName}
                              onChange={e => setSaveName(e.target.value)}
                              onKeyDown={e => {
                                 if (e.key === 'Enter') {
                                    e.preventDefault();
                                    save();
                                 } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    setShowSaveForm(false);
                                 }
                              }}
                              placeholder="Name this filter"
                              aria-label="Name this filter"
                              className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-[13px]"
                           />
                           <QuietButton tone="brand" disabled={!saveName.trim()} onClick={save}>
                              Save
                           </QuietButton>
                        </div>
                     ) : (
                        <button
                           type="button"
                           onClick={() => setShowSaveForm(true)}
                           className="hit px-1.5 py-1 text-xs font-medium text-brand hover:underline"
                        >
                           Save current filter…
                        </button>
                     )}
                  </div>
               )}
            </div>
         )}
      </span>
   );
}

/**
 * The header's "Saved ▾" trigger: only rendered once there's at least one
 * real saved filter (suggestions live in the query panel, not here — this is
 * the durable list, and an empty durable list has nothing to open into).
 * Styled to match the other four filter triggers (RepoFilter, PeopleFilter,
 * WeightFilter, StateFilter): h-8 pill, label hidden below sm.
 */
export function SavedFiltersMenu({ sessionActive }: { sessionActive: boolean }) {
   const saved = useSavedFilters();
   if (saved.length === 0) return null;

   return (
      <div>
         <Popover
            label="Saved filters"
            width="w-[300px]"
            panelClass="max-h-[400px] overflow-auto p-2"
            rootClass="relative inline-flex items-center"
            trigger={t => (
               <button
                  {...t}
                  type="button"
                  className="pressable inline-flex h-8 max-w-[220px] items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[13px] font-medium text-ink-2 hover:text-brand"
                  title="saved filters"
                  aria-label={`saved filters: ${saved.length} saved`}
               >
                  <Icon icon={Bookmark} />
                  <span className="hidden truncate sm:inline">Saved</span>
                  <Icon icon={ChevronDown} className="ml-auto text-ink-3" />
               </button>
            )}
         >
            {saved.map(f => (
               <SavedFilterRow
                  key={f.name}
                  filter={f}
                  onApply={() => applySavedFilter(f.hash)}
                  onRemove={() => deleteFilter(f.name)}
               />
            ))}
            {sessionActive && (
               <div className="mt-1.5 border-t border-secondary px-1.5 pt-1.5 text-xs text-ink-3">
                  save the current view from the search box
               </div>
            )}
         </Popover>
      </div>
   );
}
