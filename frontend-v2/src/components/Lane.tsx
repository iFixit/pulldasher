import { useState, type ReactNode } from 'react';
import { pullKey } from '../format';
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
   count,
   cap = 10,
   opts,
   children,
}: {
   title: string;
   sub: string;
   pulls: DerivedPull[];
   /** header count when rows come in via children instead of pulls */
   count?: number;
   cap?: number;
   opts: RowOptions;
   /** extra rows rendered inside the container, before the more-line */
   children?: ReactNode;
}) {
   if (!pulls.length && !children) return null;
   return (
      <section className="mb-7">
         <div className="mb-2 flex items-baseline gap-2.5">
            <h2 className="m-0 text-base leading-snug font-semibold">{title}</h2>
            <span className="text-xs text-ink-3">{sub}</span>
            <span className="flex-1" />
            <span className="text-xs text-ink-3 tabular-nums">{count ?? pulls.length}</span>
         </div>
         <Rows>
            {children}
            <Truncated cap={cap} id={`lane:${title}`}>
               {pulls.map(p => (
                  <Row key={pullKey(p.data)} pull={p} opts={opts} />
               ))}
            </Truncated>
         </Rows>
      </section>
   );
}

/**
 * A row with the lane's explanation column beside it: the action verb on
 * the left ("Merge it", "Re-stamp"), or the who-to-nudge note on the right.
 * The row itself drops its cue — the annotation carries it.
 */
export function AnnotatedRow({
   pull,
   opts,
   side,
   children,
}: {
   pull: DerivedPull;
   opts: RowOptions;
   side: 'left' | 'right';
   children: ReactNode;
}) {
   const row = (
      <span className="min-w-0 flex-1">
         <Row pull={pull} opts={{ ...opts, cue: false }} />
      </span>
   );
   return (
      <div
         className={`flex border-t border-secondary first:border-t-0 ${
            side === 'left' ? 'items-stretch' : 'items-center'
         }`}
      >
         {side === 'left' ? (
            <>
               <span className="flex w-[130px] flex-none items-center pl-3.5 text-xs font-semibold text-brand-700">
                  {children}
               </span>
               {row}
            </>
         ) : (
            <>
               {row}
               <span className="w-[280px] flex-none truncate pr-3.5 pl-2 text-right text-xs text-ink-2">
                  {children}
               </span>
            </>
         )}
      </div>
   );
}

/** The standard fold body: capped, expandable rows for a list of pulls. */
export function FoldRows({
   list,
   opts,
   extra,
}: {
   list: DerivedPull[];
   opts: RowOptions;
   extra?: Partial<RowOptions>;
}) {
   return (
      <Truncated>
         {list.map(p => (
            <Row key={pullKey(p.data)} pull={p} opts={extra ? { ...opts, ...extra } : opts} />
         ))}
      </Truncated>
   );
}

// Expansion survives lens switches: re-expanding the same "+N more" on every
// tab visit, hundreds of times a day, is pure friction. Session-local on
// purpose — a fresh visit starts folded again.
const expandedIds = new Set<string>();

/**
 * The one truncation behavior: show `cap` items and a working "+ N more"
 * button. Every capped list in the app goes through this — a count the user
 * can see but not open is a lie.
 */
export function Truncated({
   children,
   cap = 30,
   label = 'more',
   id,
}: {
   children: ReactNode[];
   cap?: number;
   label?: string;
   /** stable identity: remembers expansion across unmounts this session */
   id?: string;
}) {
   const [expanded, setExpanded] = useState(id ? expandedIds.has(id) : false);
   const expand = () => {
      setExpanded(true);
      if (id) expandedIds.add(id);
   };
   const shown = expanded ? children : children.slice(0, cap);
   const more = children.length - shown.length;
   return (
      <>
         {shown}
         {more > 0 && (
            <button
               type="button"
               onClick={expand}
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
         <div className="border-t border-secondary">{children}</div>
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
               <h2 className="m-0 text-base leading-snug font-semibold">{title}</h2>
               <span className="text-xs text-ink-3">{sub}</span>
            </div>
         )}
         <div className="overflow-hidden rounded-2xl border border-line bg-surface">{children}</div>
      </div>
   );
}
