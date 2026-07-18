import { useEffect, useRef, useState } from 'react';

/**
 * The house popover discipline, shared by Legend, Scope, and the signature
 * ledger: click-away closes, Escape closes and returns focus to the trigger,
 * and opening moves focus to the panel so keyboard users land inside the
 * dialog they just opened.
 *
 * Pass `{ hover: true }` for the informational popovers (the sign-off ledger):
 * the panel then previews on hover and pins on click. A hover-open never steals
 * focus — only a click (or keyboard) does — so brushing past a row's pips can't
 * yank the page around.
 */
export function usePopover<Panel extends HTMLElement, Trigger extends HTMLElement>(opts?: {
   hover?: boolean;
}) {
   const [open, setOpen] = useState(false);
   const rootRef = useRef<HTMLSpanElement>(null);
   const panelRef = useRef<Panel>(null);
   const triggerRef = useRef<Trigger>(null);
   // a click (or keyboard) pins the panel open; a hover-open does not, so
   // moving the mouse away closes it while a pinned one stays.
   const pinned = useRef(false);
   const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

   const clearClose = () => {
      if (closeTimer.current) {
         clearTimeout(closeTimer.current);
         closeTimer.current = null;
      }
   };

   // click/keyboard: pin an unpinned-open panel, otherwise toggle
   const toggle = () => {
      clearClose();
      if (open && !pinned.current) {
         pinned.current = true;
         panelRef.current?.focus();
         return;
      }
      pinned.current = !open;
      setOpen(!open);
   };

   const onMouseEnter = () => {
      if (!opts?.hover) return;
      clearClose();
      setOpen(true);
   };
   const onMouseLeave = () => {
      if (!opts?.hover || pinned.current) return;
      clearClose();
      closeTimer.current = setTimeout(() => setOpen(false), 140);
   };

   useEffect(() => {
      if (!open) {
         pinned.current = false;
         return;
      }
      // only a pinned (clicked/keyboard) open moves focus into the panel
      if (pinned.current) panelRef.current?.focus();
      const clickAway = (e: MouseEvent) => {
         const t = e.target as Node;
         // the panel may be portaled outside the root, so check it explicitly
         if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
         setOpen(false);
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

   useEffect(() => clearClose, []);

   const hoverProps = opts?.hover ? { onMouseEnter, onMouseLeave } : {};
   return { open, toggle, rootRef, panelRef, triggerRef, hoverProps };
}
