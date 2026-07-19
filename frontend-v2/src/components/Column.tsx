import { useState, type ReactNode } from 'react';

/**
 * The board column shell shared by Board, Classic, and Recently Closed:
 * a header bar (attached when open, a closed pill when collapsed) with a
 * count on the right, over a rounded body. `header` carries whatever the
 * lens puts before the count — a plain title, or a status dot plus hint.
 */
export function BoardColumn({
   header,
   count,
   defaultOpen = true,
   empty,
   children,
}: {
   header: ReactNode;
   count: number;
   defaultOpen?: boolean;
   /** message shown in the body when the column is empty (omit to render nothing) */
   empty?: string;
   children: ReactNode;
}) {
   const [open, setOpen] = useState(defaultOpen);
   return (
      <section className="min-w-0">
         {/* sticks below the app header while its column scrolls; the canvas
             backing fills the gap outside the button's rounded corners */}
         <h2 className="sticky top-[var(--header-h,0px)] z-[5] m-0 bg-[var(--canvas)]">
            <button
               type="button"
               aria-expanded={open}
               onClick={() => setOpen(o => !o)}
               className={`flex w-full items-center gap-2 border border-line bg-muted px-4 py-2.5 text-left text-sm font-semibold ${
                  open ? 'rounded-t-2xl' : 'rounded-2xl'
               }`}
               title={open ? 'collapse column' : 'expand column'}
            >
               {header}
               <span className="flex-1" />
               <span className="text-xs font-normal text-ink-3 tabular-nums">{count}</span>
            </button>
         </h2>
         {open && (
            <div className="overflow-hidden rounded-b-2xl border border-t-0 border-line bg-surface">
               {children}
               {count === 0 && empty && (
                  <div className="px-4 py-3 text-[13px] text-ink-3">{empty}</div>
               )}
            </div>
         )}
      </section>
   );
}
