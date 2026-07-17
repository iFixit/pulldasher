import { useState, type ReactNode } from 'react';
import type { DerivedPull } from '../model/status';
import { Row, type RowOptions } from './Row';

export function Rows({ children }: { children: ReactNode }) {
   return (
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">{children}</div>
   );
}

export function Lane({
   title,
   sub,
   pulls,
   cap = 10,
   opts,
   children,
}: {
   title: string;
   sub: string;
   pulls: DerivedPull[];
   cap?: number;
   opts: RowOptions;
   /** extra rows rendered inside the container, before the more-line */
   children?: ReactNode;
}) {
   const [expanded, setExpanded] = useState(false);
   if (!pulls.length && !children) return null;
   const shown = expanded ? pulls : pulls.slice(0, cap);
   const more = pulls.length - shown.length;
   return (
      <section className="mb-7">
         <div className="mb-2 flex items-baseline gap-2.5">
            <span className="text-base leading-snug font-semibold">{title}</span>
            <span className="text-xs text-ink-3">{sub}</span>
            <span className="flex-1" />
            <span className="text-xs text-ink-3 tabular-nums">{pulls.length}</span>
         </div>
         <Rows>
            {children}
            {shown.map(p => (
               <Row key={`${p.data.repo}#${p.data.number}`} pull={p} opts={opts} />
            ))}
            {more > 0 && (
               <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="block w-full border-t border-secondary bg-muted/50 px-3.5 py-[7px] text-left text-xs font-medium text-ink-2 hover:text-brand"
               >
                  + {more} more
               </button>
            )}
         </Rows>
      </section>
   );
}

export function DividerLine({ label }: { label: string }) {
   return (
      <div className="border-t border-secondary bg-muted/50 px-3.5 py-[5px] text-[11px] font-medium text-ink-3">
         {label}
      </div>
   );
}

/**
 * The one truncation behavior: show `cap` items and a working "+ N more"
 * button. Every capped list in the app goes through this or Lane's own
 * more-line — a count the user can see but not open is a lie.
 */
export function Truncated({
   children,
   cap = 30,
   label = 'more',
}: {
   children: ReactNode[];
   cap?: number;
   label?: string;
}) {
   const [expanded, setExpanded] = useState(false);
   const shown = expanded ? children : children.slice(0, cap);
   const more = children.length - shown.length;
   return (
      <>
         {shown}
         {more > 0 && (
            <button
               type="button"
               onClick={() => setExpanded(true)}
               className="block w-full border-t border-secondary bg-muted/50 px-3.5 py-[7px] text-left text-xs font-medium text-ink-2 hover:text-brand"
            >
               + {more} {label}
            </button>
         )}
      </>
   );
}

/** One folded line in "the rest of the board": count + hint, rows on demand. */
export function Fold({
   dot,
   count,
   label,
   hint,
   children,
}: {
   dot: string;
   count: number;
   label: string;
   hint: string;
   children: ReactNode;
}) {
   if (!count) return null;
   return (
      <details className="group border-t border-secondary first:border-t-0">
         <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3.5 py-[9px] text-[13px] text-ink-2 hover:bg-muted [&::-webkit-details-marker]:hidden">
            <span className="text-ink-3 transition-[rotate] duration-150 group-open:rotate-90 motion-reduce:transition-none">
               ▸
            </span>
            <span className="h-2 w-2 flex-none rounded-[3px]" style={{ background: dot }} />
            <b className="font-semibold text-ink tabular-nums">{count}</b> {label}
            <span className="ml-auto text-xs text-ink-3">{hint}</span>
         </summary>
         <div className="fold-body border-t border-secondary">{children}</div>
      </details>
   );
}

export function RestGroup({
   title,
   sub,
   children,
}: {
   title?: string;
   sub?: string;
   children: ReactNode;
}) {
   return (
      <div className="mb-7">
         {title && (
            <div className="mb-2 flex items-baseline gap-2.5">
               <span className="text-base leading-snug font-semibold">{title}</span>
               <span className="text-xs text-ink-3">{sub}</span>
            </div>
         )}
         <div className="overflow-hidden rounded-2xl border border-line bg-surface">{children}</div>
      </div>
   );
}
