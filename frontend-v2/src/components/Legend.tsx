import { useEffect, useRef, useState } from 'react';

/**
 * The one-stop decoder for the board's invented vocabulary. New hires can't
 * learn "stamp" or the slashed pip from hover titles alone — this is the
 * visible answer the review pass found missing.
 */
export function Legend() {
   const [open, setOpen] = useState(false);
   const ref = useRef<HTMLSpanElement>(null);
   const triggerRef = useRef<HTMLButtonElement>(null);

   useEffect(() => {
      if (!open) return;
      const clickAway = (e: MouseEvent) => {
         if (!ref.current?.contains(e.target as Node)) setOpen(false);
      };
      const onKey = (e: KeyboardEvent) => {
         if (e.key !== 'Escape') return;
         setOpen(false);
         triggerRef.current?.focus();
      };
      document.addEventListener('click', clickAway);
      document.addEventListener('keydown', onKey);
      return () => {
         document.removeEventListener('click', clickAway);
         document.removeEventListener('keydown', onKey);
      };
   }, [open]);

   const item = (term: React.ReactNode, def: string) => (
      <div className="flex items-baseline gap-2 px-1 py-[3px]">
         <span className="flex w-[74px] flex-none items-center gap-1 text-right">{term}</span>
         <span className="text-ink-2">{def}</span>
      </div>
   );

   return (
      <span className="relative inline-block" ref={ref}>
         <button
            ref={triggerRef}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label="what the symbols mean"
            title="what the symbols mean"
            onClick={() => setOpen(o => !o)}
            className="pressable inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-[13px] font-semibold text-ink-3 hover:text-brand"
         >
            ?
         </button>
         {open && (
            <span
               role="dialog"
               aria-label="Symbol legend"
               className="popover absolute top-full right-0 z-50 mt-1 block w-[340px] rounded-lg border border-line bg-surface p-2.5 text-xs shadow-md"
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
                  'sign-offs given / required; a check means done'
               )}
               {item(
                  <b style={{ color: 'var(--warn)' }}>⊘</b>,
                  'a push invalidated the stamp: it needs re-CR'
               )}
               {item(
                  <span className="chip-w chip-w-M">M</span>,
                  'estimated review effort (XS to XL), from diff size'
               )}
               {item(
                  <span className="flag-qaing">QAing</span>,
                  'someone claimed QA by adding the QAing label on GitHub'
               )}
               {item(
                  <span className="flag-amber">iterating</span>,
                  'changed in the last 30 minutes, may still be moving'
               )}
               {item(
                  <span className="badge badge-blocked">Blocked</span>,
                  'a dev/deploy block signature: ask the holder to lift it'
               )}
               {item(<span className="dot-fresh" />, 'changed since your last look')}
               {item(<span>❄</span>, 'Cryogenic Storage PRs and quiet repos, hidden by default')}
            </span>
         )}
      </span>
   );
}
