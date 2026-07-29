import {
   type PointerEvent as ReactPointerEvent,
   useLayoutEffect,
   useState,
   type ReactNode,
   type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { usePopover } from './usePopover';

export interface PopoverTriggerProps {
   ref: Ref<HTMLButtonElement>;
   'aria-haspopup': 'dialog';
   'aria-expanded': boolean;
   onClick: () => void;
   /** present only with `hoverTriggerOnly`: the hover handlers move off the
    * root and onto the trigger element itself. Pointer events, not mouse, so
    * the hover-arm can be gated to a real mouse and skip touch taps. */
   onPointerEnter?: (e: ReactPointerEvent) => void;
   onPointerLeave?: (e: ReactPointerEvent) => void;
}

/**
 * Wraps a trigger's onClick so `fn` runs once, only on the transition from
 * closed to open — not on every toggle. NotificationPanel (mark notifications
 * seen) only cares about the open edge; the toggle itself stays the house
 * Popover's.
 */
export function onOpen(t: PopoverTriggerProps, fn: () => void): () => void {
   return () => {
      const wasOpen = t['aria-expanded'];
      t.onClick();
      if (!wasOpen) fn();
   };
}

/**
 * The house popover: a trigger button plus a role=dialog panel, sharing the
 * click-away / Escape / focus discipline in usePopover. NotificationPanel,
 * Legend, the sign-off ledger, and the filter components (StateFilter,
 * WeightFilter, RepoFilter, PeopleFilter, HiddenPanel) all render through
 * this, so the panel chrome and ARIA plumbing live in one place instead of
 * being hand-rolled per caller.
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
   hoverTriggerOnly = false,
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
   /** scope the hover to the trigger element instead of the whole root —
    * for triggers whose hit area is deliberately larger than their visible
    * text (the stretched row-covering title link) */
   hoverTriggerOnly?: boolean;
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
         // clamp into the viewport (8px gutters): a right-anchored panel wider
         // than the space left of its trigger would otherwise hang off-screen
         // — the phone kebab menu found this the hard way
         const panelW = pop.panelRef.current?.offsetWidth ?? 0;
         const max = window.innerWidth - panelW - 8;
         setPos(
            side === 'right'
               ? { top, right: Math.max(Math.min(window.innerWidth - r.right, max), 8) }
               : { top, left: Math.max(Math.min(r.left, max), 8) }
         );
      };
      place();
      // second pass once the panel exists: the first ran before it rendered,
      // so the clamp had no width to measure
      const t = setTimeout(place, 0);
      // capture-phase catches scrolls on any ancestor, not just window
      window.addEventListener('scroll', place, true);
      window.addEventListener('resize', place);
      return () => {
         clearTimeout(t);
         window.removeEventListener('scroll', place, true);
         window.removeEventListener('resize', place);
      };
   }, [pop.open, side]);

   return (
      <span className={rootClass} ref={pop.rootRef} {...(hoverTriggerOnly ? {} : pop.hoverProps)}>
         {trigger({
            ref: pop.triggerRef,
            'aria-haspopup': 'dialog',
            'aria-expanded': pop.open,
            onClick: pop.toggle,
            ...(hoverTriggerOnly ? pop.hoverProps : {}),
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
