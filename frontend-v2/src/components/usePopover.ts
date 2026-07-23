import { useEffect, useRef, useState } from 'react';
import { getSettings } from '../settings';

/**
 * The house popover discipline, shared by Legend, Scope, and the signature
 * ledger: click-away closes, Escape closes and returns focus to the trigger,
 * and opening moves focus to the panel so keyboard users land inside the
 * dialog they just opened.
 *
 * Pass `{ hover: true }` for the informational popovers (the sign-off ledger):
 * the panel then previews on hover (after a short intent delay) and pins on
 * click. A hover-open never steals focus — only a click (or keyboard) does — so
 * brushing past a row's pips can't yank the page around.
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
   const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

   const clearClose = () => {
      if (closeTimer.current) {
         clearTimeout(closeTimer.current);
         closeTimer.current = null;
      }
   };
   const clearOpen = () => {
      if (openTimer.current) {
         clearTimeout(openTimer.current);
         openTimer.current = null;
      }
   };

   // click/keyboard: pin an unpinned-open panel, otherwise toggle. A click
   // beats any pending hover-open — no delay when you commit.
   const toggle = () => {
      clearOpen();
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
      // a short intent delay (a user setting): brushing the cursor across a row
      // of triggers shouldn't flash their panels open one after another. Read
      // non-reactively at hover time so a popover doesn't re-subscribe to
      // settings; 0 keeps the old open-instantly behavior.
      clearOpen();
      const delay = getSettings().hoverDelayMs;
      if (delay <= 0) setOpen(true);
      else openTimer.current = setTimeout(() => setOpen(true), delay);
   };
   const onMouseLeave = () => {
      if (!opts?.hover) return;
      clearOpen();
      if (pinned.current) return;
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
         // composedPath, NOT contains(e.target): React 18 flushes state in a
         // microtask BETWEEN the button's listener and this document-level
         // one, so a panel button that swaps itself out on click (e.g. "+ New
         // team" becoming a name input) is already detached by the time we
         // run — contains() then reads an inside click as outside and slams
         // the panel shut. The path is captured at dispatch and survives the
         // unmount. (Only a real pointer reproduces this: synthetic .click()
         // dispatch never yields to microtasks between listeners.)
         const path = e.composedPath();
         if (
            (rootRef.current && path.includes(rootRef.current)) ||
            (panelRef.current && path.includes(panelRef.current))
         )
            return;
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

   useEffect(
      () => () => {
         clearClose();
         clearOpen();
      },
      []
   );

   const hoverProps = opts?.hover ? { onMouseEnter, onMouseLeave } : {};
   return { open, toggle, rootRef, panelRef, triggerRef, hoverProps };
}
