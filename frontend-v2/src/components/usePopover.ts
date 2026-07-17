import { useEffect, useRef, useState } from 'react';

/**
 * The house popover discipline, shared by Legend, Scope, and the signature
 * ledger: click-away closes, Escape closes and returns focus to the trigger,
 * and opening moves focus to the panel so keyboard users land inside the
 * dialog they just opened.
 */
export function usePopover<Panel extends HTMLElement, Trigger extends HTMLElement>() {
   const [open, setOpen] = useState(false);
   const rootRef = useRef<HTMLSpanElement>(null);
   const panelRef = useRef<Panel>(null);
   const triggerRef = useRef<Trigger>(null);

   useEffect(() => {
      if (!open) return;
      panelRef.current?.focus();
      const clickAway = (e: MouseEvent) => {
         if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
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

   return { open, setOpen, rootRef, panelRef, triggerRef };
}
