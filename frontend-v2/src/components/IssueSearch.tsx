import { Search } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { issueKey, issueQuery, type IssueHit } from '../../../shared/model/work';
import { searchIssues } from '../model/projectWork';
import { StatePill, sinceWords } from './GitHubRef';
import { Icon } from './Icon';
import { Avatar } from './identity';

/** how long typing rests before a search */
const WAIT_MS = 300;

/**
 * Find an issue on GitHub as you type and pick it: words from its title or
 * body, "#123" (in any tracked repo), "owner/repo#123", or its link. Each
 * result reads like the issue's card: state, repo and number, age, title,
 * author. Arrow keys move, Enter picks, Escape closes the list (and only
 * the list). The list is drawn over the page, so a clipped box can't cut
 * it off.
 */
export function IssueSearch({
   onPick,
   label,
   placeholder = 'Find an issue: words from its title, #123, or its link',
   taken,
   takenWords = 'added already',
   autoFocus = false,
}: {
   onPick: (hit: IssueHit) => void;
   /** the input's accessible name */
   label: string;
   placeholder?: string;
   /** issues that can't be picked again, by issueKey */
   taken?: ReadonlySet<string>;
   /** what a taken result says about itself */
   takenWords?: string;
   autoFocus?: boolean;
}) {
   const [text, setText] = useState('');
   const [found, setFound] = useState<{ text: string; hits: IssueHit[] | null; error?: string }>();
   const [open, setOpen] = useState(false);
   const [active, setActive] = useState(0);
   const [box, setBox] = useState<{ top: number; left: number; width: number }>();
   const inputRef = useRef<HTMLInputElement>(null);
   const listRef = useRef<HTMLDivElement>(null);
   const listId = useId();
   const asked = issueQuery(text) != null;
   useEffect(() => {
      if (!issueQuery(text)) return;
      let live = true;
      const wait = setTimeout(() => {
         void searchIssues(text).then(got => {
            if (!live) return;
            setFound(
               Array.isArray(got) ? { text, hits: got } : { text, hits: null, error: got.error }
            );
            setActive(0);
         });
      }, WAIT_MS);
      return () => {
         live = false;
         clearTimeout(wait);
      };
   }, [text]);
   const current = found?.text === text ? found : undefined;
   const hits = current?.hits ?? [];
   const shown = open && asked;
   // the list hangs under the input wherever the page scrolls
   useLayoutEffect(() => {
      if (!shown) return;
      const place = () => {
         const r = inputRef.current?.getBoundingClientRect();
         if (r) setBox({ top: r.bottom + 4, left: r.left, width: r.width });
      };
      place();
      window.addEventListener('scroll', place, true);
      window.addEventListener('resize', place);
      return () => {
         window.removeEventListener('scroll', place, true);
         window.removeEventListener('resize', place);
      };
   }, [shown]);
   useEffect(() => {
      listRef.current
         ?.querySelector(`[data-index="${active}"]`)
         ?.scrollIntoView({ block: 'nearest' });
   }, [active]);
   const isTaken = (hit: IssueHit) => !!taken?.has(issueKey(hit));
   const pick = (hit: IssueHit | undefined) => {
      if (!hit || isTaken(hit)) return;
      onPick(hit);
      setText('');
      setFound(undefined);
      setOpen(false);
   };
   const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown' && hits.length) {
         e.preventDefault();
         setOpen(true);
         setActive(i => Math.min(i + 1, hits.length - 1));
      } else if (e.key === 'ArrowUp' && hits.length) {
         e.preventDefault();
         setActive(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
         // never submit a form this sits in; pick only what's on screen
         e.preventDefault();
         if (shown) pick(hits[active]);
      } else if (e.key === 'Escape' && shown) {
         // close the list, not whatever holds this box
         e.preventDefault();
         e.stopPropagation();
         setOpen(false);
      }
   };
   const optionId = (i: number) => `${listId}-${i}`;
   let status = '';
   if (asked && !current) status = 'Searching GitHub…';
   else if (current?.error) status = current.error;
   else if (current && !hits.length) status = `No issue matches “${text.trim()}”.`;
   else if (current) status = `${hits.length} found`;
   return (
      <span className="relative block w-full max-w-[560px]">
         <Icon
            icon={Search}
            className="pointer-events-none absolute left-2.5 top-[9px] text-ink-3"
         />
         <input
            ref={inputRef}
            type="search"
            value={text}
            onChange={e => {
               setText(e.target.value);
               setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label={label}
            autoFocus={autoFocus}
            role="combobox"
            aria-expanded={shown}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={shown && hits.length ? optionId(active) : undefined}
            className="w-full rounded-lg border border-line bg-surface py-1.5 pl-8 pr-2.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
         />
         <span role="status" aria-live="polite" className="sr-only">
            {status}
         </span>
         {shown &&
            box &&
            createPortal(
               <div
                  ref={listRef}
                  // keep the input's focus, so a click or a scrollbar drag lands
                  onMouseDown={e => e.preventDefault()}
                  style={{ position: 'fixed', top: box.top, left: box.left, width: box.width }}
                  className="popover z-50 max-h-[min(60vh,440px)] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-md"
               >
                  {(!current || current.error || !hits.length) && (
                     <p className="m-0 px-2 py-1.5 text-xs text-ink-3">{status}</p>
                  )}
                  <div id={listId} role="listbox" aria-label="Issues found">
                     {hits.map((hit, i) => {
                        const off = isTaken(hit);
                        return (
                           <div
                              key={issueKey(hit)}
                              id={optionId(i)}
                              data-index={i}
                              role="option"
                              aria-selected={i === active}
                              aria-disabled={off}
                              onMouseEnter={() => setActive(i)}
                              onClick={() => pick(hit)}
                              className={`rounded-md px-2 py-1.5 ${
                                 i === active ? 'bg-muted' : ''
                              } ${off ? 'cursor-default opacity-60' : 'cursor-pointer'}`}
                           >
                              <span className="flex items-center gap-2 text-xs text-ink-3">
                                 <StatePill data={{ kind: 'issue', ...hit }} />
                                 <span className="min-w-0 truncate">
                                    {hit.repo} #{hit.number}
                                 </span>
                                 {off && <span className="flex-none">{takenWords}</span>}
                                 {hit.createdAt != null && (
                                    <span className="ml-auto flex-none">
                                       {sinceWords(hit.createdAt)}
                                    </span>
                                 )}
                              </span>
                              <span className="mt-1 block text-[13px] font-semibold leading-snug text-ink">
                                 {hit.title}
                              </span>
                              {hit.author && (
                                 <span className="mt-1 flex items-center gap-1.5 text-xs text-ink-3">
                                    <Avatar login={hit.author} size={16} />
                                    {hit.author}
                                 </span>
                              )}
                           </div>
                        );
                     })}
                  </div>
               </div>,
               document.body
            )}
      </span>
   );
}
