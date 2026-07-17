import { useLayoutEffect, useState, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { usePopover } from './usePopover';

export interface PopoverTriggerProps {
   ref: Ref<HTMLButtonElement>;
   'aria-haspopup': 'dialog';
   'aria-expanded': boolean;
   onClick: () => void;
}

/**
 * The house popover: a trigger button plus a role=dialog panel, sharing the
 * click-away / Escape / focus discipline in usePopover. Legend, the sign-off
 * ledger, and Filters all render through this, so the panel chrome and ARIA
 * plumbing live in one place instead of being hand-rolled three times.
 * (Settings is deliberately NOT one of these — it's a portal drawer with a
 * scrim, a different dismissal model.)
 *
 * The panel is portaled to document.body and positioned `fixed` off the
 * trigger's rect, so it can't be clipped by an ancestor's `overflow: hidden`
 * (the row list is a rounded, clipped surface) or trapped under a row's
 * stacking context. It follows the trigger on scroll/resize.
 *
 * The trigger is a render prop: spread the given props onto your own <button>
 * so each caller keeps its distinct trigger markup.
 */
export function Popover({
   label,
   trigger,
   children,
   side = 'left',
   hover = false,
   width = '',
   panelClass = '',
   rootClass = 'relative inline-block',
}: {
   /** aria-label for the dialog panel */
   label: string;
   trigger: (props: PopoverTriggerProps) => ReactNode;
   children: ReactNode;
   /** which edge the panel anchors to (and grows from) */
   side?: 'left' | 'right';
   /** preview on hover, pin on click (for informational panels) */
   hover?: boolean;
   /** tailwind width class for the panel, e.g. 'w-[360px]' */
   width?: string;
   /** extra panel classes: padding, overflow, max-height, text size */
   panelClass?: string;
   rootClass?: string;
}) {
   const pop = usePopover<HTMLSpanElement, HTMLButtonElement>(hover ? { hover: true } : undefined);
   const [pos, setPos] = useState<{ top: number; left?: number; right?: number }>();

   useLayoutEffect(() => {
      if (!pop.open) return;
      const place = () => {
         const el = pop.triggerRef.current;
         if (!el) return;
         const r = el.getBoundingClientRect();
         const top = r.bottom + 4;
         setPos(
            side === 'right' ? { top, right: window.innerWidth - r.right } : { top, left: r.left }
         );
      };
      place();
      // capture-phase catches scrolls on any ancestor, not just window
      window.addEventListener('scroll', place, true);
      window.addEventListener('resize', place);
      return () => {
         window.removeEventListener('scroll', place, true);
         window.removeEventListener('resize', place);
      };
   }, [pop.open, side]);

   return (
      <span className={rootClass} ref={pop.rootRef} {...pop.hoverProps}>
         {trigger({
            ref: pop.triggerRef,
            'aria-haspopup': 'dialog',
            'aria-expanded': pop.open,
            onClick: pop.toggle,
         })}
         {pop.open &&
            pos &&
            createPortal(
               <span
                  ref={pop.panelRef}
                  tabIndex={-1}
                  role="dialog"
                  aria-label={label}
                  {...pop.hoverProps}
                  style={{ position: 'fixed', top: pos.top, left: pos.left, right: pos.right }}
                  className={`popover z-50 block rounded-lg border border-line bg-surface shadow-md outline-none ${side === 'right' ? 'popover-right' : ''} ${width} ${panelClass}`}
               >
                  {children}
               </span>,
               document.body
            )}
      </span>
   );
}
