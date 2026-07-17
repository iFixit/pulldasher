import { shortRepo } from '../format';
import { usePopover } from './usePopover';

/** Open eye = revealing, slashed eye = hidden. */
function Eye({ off }: { off?: boolean }) {
   return (
      <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4 flex-none fill-current">
         <path d="M8 3.5C4.4 3.5 1.7 5.8.6 8c1.1 2.2 3.8 4.5 7.4 4.5s6.3-2.3 7.4-4.5C14.3 5.8 11.6 3.5 8 3.5Zm0 7.5a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm0-1.6a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z" />
         {off && (
            <path
               d="M2.4 2.1l11.5 11.5"
               stroke="currentColor"
               strokeWidth="1.4"
               strokeLinecap="round"
               fill="none"
            />
         )}
      </svg>
   );
}

/** the sentinel key for the Cryogenic-Storage group in the reveal set */
export const CRYO_KEY = 'cryo';

/**
 * The visibility control: which off-by-default PRs to show. Two kinds hide by
 * default — Cryogenic-Storage PRs (deliberately parked) and hide-by-default
 * repos (low-traffic noise) — and this is where you reveal them, all at once
 * or one group at a time, instead of the old all-or-nothing snowflake toggle.
 */
export function HiddenSelector({
   count,
   cryo,
   repos,
   showAll,
   reveal,
   onShowAll,
   onToggle,
}: {
   /** how many PRs are hidden right now, given the current reveal state */
   count: number;
   /** total Cryogenic-Storage PRs (0 hides the row) */
   cryo: number;
   /** hide-by-default repos with their open-PR counts */
   repos: [string, number][];
   /** master: reveal everything hidden */
   showAll: boolean;
   /** individually revealed keys (repo names and CRYO_KEY) */
   reveal: string[];
   onShowAll: (next: boolean) => void;
   onToggle: (key: string) => void;
}) {
   const pop = usePopover<HTMLSpanElement, HTMLButtonElement>();
   const revealing = showAll || reveal.length > 0;

   const row = (key: string, label: string, n: number) => (
      <label
         key={key}
         className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-[5px] text-[13px] hover:bg-muted"
      >
         <input
            type="checkbox"
            className="m-0"
            checked={showAll || reveal.includes(key)}
            disabled={showAll}
            onChange={() => onToggle(key)}
         />
         <span>{label}</span>
         <span className="ml-auto text-[11px] text-ink-3 tabular-nums">
            {n === 0 ? 'none open' : n}
         </span>
      </label>
   );

   return (
      <span className="relative inline-flex" ref={pop.rootRef}>
         <button
            ref={pop.triggerRef}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={pop.open}
            title="show or hide off-by-default PRs (Cryogenic Storage, quiet repos)"
            onClick={() => pop.setOpen(o => !o)}
            className={`pressable inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium ${
               revealing
                  ? 'border-brand bg-brand-50 text-brand-700'
                  : 'border-line bg-surface text-ink-3 hover:text-brand'
            }`}
         >
            <Eye off={!revealing} />
            {revealing ? 'showing hidden' : `${count} hidden`}
         </button>
         {pop.open && (
            <span
               ref={pop.panelRef}
               tabIndex={-1}
               role="dialog"
               aria-label="Hidden PRs"
               className="popover absolute top-full right-0 z-50 mt-1 block max-h-[420px] w-[260px] overflow-auto rounded-lg border border-line bg-surface p-2 text-xs shadow-md outline-none"
            >
               <span className="block px-1.5 pt-0.5 pb-1 text-ink-3">
                  Off-by-default PRs. Reveal what you want to see.
               </span>
               <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-[5px] text-[13px] font-medium hover:bg-muted">
                  <input
                     type="checkbox"
                     className="m-0"
                     checked={showAll}
                     onChange={() => onShowAll(!showAll)}
                  />
                  <span>Show everything hidden</span>
               </label>
               {cryo > 0 && (
                  <>
                     <span className="block px-1.5 pt-2 pb-1 font-semibold text-ink-3">
                        Cryogenic Storage
                     </span>
                     {row(CRYO_KEY, 'parked PRs', cryo)}
                  </>
               )}
               {repos.length > 0 && (
                  <>
                     <span className="block px-1.5 pt-2 pb-1 font-semibold text-ink-3">
                        Quiet repos
                     </span>
                     {repos.map(([name, n]) => row(name, shortRepo(name), n))}
                  </>
               )}
            </span>
         )}
      </span>
   );
}
