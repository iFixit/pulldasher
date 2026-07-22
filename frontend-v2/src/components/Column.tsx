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
   children,
}: {
   header: ReactNode;
   count: number;
   defaultOpen?: boolean;
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
               className={`flex w-full items-center gap-2 border border-line bg-muted px-4 py-2.5 text-left text-sm font-semibold transition-[background-color] duration-150 ease-out hover:bg-secondary motion-reduce:transition-none ${
                  open ? 'rounded-t-2xl' : 'rounded-2xl'
               }`}
            >
               {/* the disclosure cue the header lacked: without it the only
                   hint this collapses was a native tooltip */}
               <span
                  aria-hidden
                  className={`text-xs text-ink-3 transition-[rotate] duration-150 ease-out motion-reduce:transition-none ${
                     open ? 'rotate-90' : ''
                  }`}
               >
                  ▸
               </span>
               {header}
               <span className="flex-1" />
               {/* an empty column still earns its header (muscle memory), but
                   not a "0" — the count only appears once there's something in it */}
               {count > 0 && (
                  <span className="text-xs font-normal text-ink-3 tabular-nums">{count}</span>
               )}
            </button>
         </h2>
         {open && (
            // min-h keeps the rounded-b corners from collapsing to square when
            // the body is empty (Classic keeps empty columns visible): a ~1px
            // box has no room to draw a 16px radius. Any populated column far
            // exceeds this, so it only shows on the empty case.
            <div className="min-h-6 overflow-hidden rounded-b-2xl border border-t-0 border-line bg-surface">
               {children}
            </div>
         )}
      </section>
   );
}
