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
                  <span className="tabular-nums">
                     CR 1/2 <b style={{ color: 'var(--ok)' }}>✓</b>
                  </span>,
                  'sign-offs given / required; ✓ done, – not required. Click for who signed'
               )}
               {item(
                  <span className="tabular-nums" style={{ color: 'var(--warn)' }}>
                     1/2<b className="font-semibold">⊘</b>
                  </span>,
                  'a push invalidated a stamp: someone owes a re-stamp'
               )}
               {item(
                  <span className="underline decoration-dotted underline-offset-2">1/2</span>,
                  'the dotted underline marks a slot you stamped'
               )}
               {item(
                  <span className="tabular-nums">
                     <b style={{ color: 'var(--warn)' }}>9d</b>/
                     <b style={{ color: 'var(--bad)' }}>15d</b>
                  </span>,
                  'age heats up: amber past a week, red past two. Hover for both clocks'
               )}
               {item(
                  <span className="chip-w chip-w-M">M</span>,
                  'estimated review effort (XS to XL), from diff size'
               )}
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
                  'since your last look: solid = new PR, ring = updated. Opening one clears it'
               )}
               {item(<span>❄</span>, 'Cryogenic Storage PRs and quiet repos, hidden by default')}
            </span>
         )}
      </span>
   );
}
