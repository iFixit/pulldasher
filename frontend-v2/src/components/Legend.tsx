import { WeightMeter } from './bits';
import { usePopover } from './usePopover';

/**
 * The one-stop decoder for the board's invented vocabulary. New hires can't
 * learn "stamp" or the slashed pip from hover titles alone — this is the
 * visible answer the review pass found missing.
 */
export function Legend() {
   const pop = usePopover<HTMLSpanElement, HTMLButtonElement>();

   const item = (term: React.ReactNode, def: string) => (
      <div className="flex items-baseline gap-2 px-1 py-[3px]">
         <span className="flex w-[74px] flex-none items-center gap-1 text-right">{term}</span>
         <span className="text-ink-2">{def}</span>
      </div>
   );

   return (
      <span className="relative inline-block" ref={pop.rootRef}>
         <button
            ref={pop.triggerRef}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={pop.open}
            aria-label="what the symbols mean"
            title="what the symbols mean"
            onClick={() => pop.setOpen(o => !o)}
            className="pressable inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-[13px] font-semibold text-ink-3 hover:text-brand"
         >
            ?
         </button>
         {pop.open && (
            <span
               ref={pop.panelRef}
               tabIndex={-1}
               role="dialog"
               aria-label="Symbol legend"
               className="popover absolute top-full right-0 z-50 mt-1 block w-[360px] rounded-lg border border-line bg-surface p-2.5 text-xs shadow-md outline-none"
            >
               <span className="block px-1 pb-1.5 font-semibold text-ink">Reading the board</span>
               {item(
                  <b className="font-semibold">stamp</b>,
                  'a CR or QA sign-off, left as a comment on the PR'
               )}
               {item(
                  <span className="inline-flex items-center gap-1">
                     CR
                     <span className="pip pip-on" />
                     <span className="pip pip-off" />
                  </span>,
                  'CR / QA sign-offs: one pip per required stamp, filled = done, hollow = still needed. Click a row’s pips for who signed'
               )}
               {item(
                  <span className="inline-flex items-center gap-1">
                     <span className="pip pip-on" />
                     <span className="pip pip-stale" />
                  </span>,
                  'an amber pip means a push invalidated a stamp: a re-stamp is owed'
               )}
               {item(
                  <span className="pip-mine inline-flex items-center gap-1 pb-0.5">
                     <span className="pip pip-on" />
                  </span>,
                  'the dotted underline marks a slot you stamped'
               )}
               {item(
                  <span className="tabular-nums">
                     <b style={{ color: 'var(--warn)' }}>5d</b>/
                     <b style={{ color: 'var(--bad)' }}>12d</b>
                  </span>,
                  'age: hours under a day, amber past 4 days, red past 10. Hover for both clocks'
               )}
               {item(<WeightMeter weight="M" />, 'review effort, light to heavy, from diff size')}
               {item(
                  <span className="flag-qaing">QAing</span>,
                  'someone claimed QA by adding the QAing label on GitHub (◉ in columns)'
               )}
               {item(
                  <span className="flag-amber">iterating</span>,
                  'changed in the last 30 minutes, may still be moving'
               )}
               {item(
                  <span className="badge badge-blocked">Dev blocked</span>,
                  'a reviewer requested changes: the author’s move'
               )}
               {item(
                  <span className="badge badge-hold">Deploy hold</span>,
                  'done, deliberately held from shipping: ask the holder'
               )}
               {item(
                  <span className="badge badge-blocked">Can't merge</span>,
                  'signed off but conflicted or on an unmerged parent: author rebases'
               )}
               {item(
                  <span className="flex items-center gap-1.5">
                     <span className="dot-fresh" />
                     <span className="dot-updated" />
                  </span>,
                  'changed since your last visit: solid = new PR, ring = updated (tracked while you’re away). Opening one clears it'
               )}
               {item(
                  <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4 fill-ink-3">
                     <path d="M8 3.5C4.4 3.5 1.7 5.8.6 8c1.1 2.2 3.8 4.5 7.4 4.5s6.3-2.3 7.4-4.5C14.3 5.8 11.6 3.5 8 3.5Zm0 7.5a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm0-1.6a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z" />
                     <path
                        d="M2.4 2.1l11.5 11.5"
                        stroke="var(--ink-3)"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        fill="none"
                     />
                  </svg>,
                  'the eye selector reveals off-by-default PRs: Cryogenic Storage and quiet repos'
               )}
               {item(
                  <b className="font-semibold tabular-nums">/ j k c</b>,
                  'keys: / filter · j/k walk rows · Enter opens · c copies the branch'
               )}
            </span>
         )}
      </span>
   );
}
