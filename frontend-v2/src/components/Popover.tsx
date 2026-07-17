import type { ReactNode, Ref } from 'react';
import { usePopover } from './usePopover';

export interface PopoverTriggerProps {
   ref: Ref<HTMLButtonElement>;
   'aria-haspopup': 'dialog';
   'aria-expanded': boolean;
   onClick: () => void;
}

/**
 * The house popover: a trigger button plus an absolutely-positioned
 * role=dialog panel, sharing the click-away / Escape / focus discipline in
 * usePopover. Legend, the sign-off ledger, and Filters all render through this,
 * so the panel chrome and ARIA plumbing live in one place instead of being
 * hand-rolled three times. (Settings is deliberately NOT one of these — it's a
 * portal drawer with a scrim, a different dismissal model.)
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
   return (
      <span className={rootClass} ref={pop.rootRef} {...pop.hoverProps}>
         {trigger({
            ref: pop.triggerRef,
            'aria-haspopup': 'dialog',
            'aria-expanded': pop.open,
            onClick: pop.toggle,
         })}
         {pop.open && (
            <span
               ref={pop.panelRef}
               tabIndex={-1}
               role="dialog"
               aria-label={label}
               className={`popover absolute top-full z-50 mt-1 block rounded-lg border border-line bg-surface shadow-md outline-none ${side === 'right' ? 'popover-right right-0' : 'left-0'} ${width} ${panelClass}`}
            >
               {children}
            </span>
         )}
      </span>
   );
}
