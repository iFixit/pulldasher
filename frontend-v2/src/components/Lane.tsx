import { useState, type ReactNode } from 'react';
import { pullKey } from '../format';
import type { DerivedPull } from '../model/status';
import { Row, type RowOptions } from './Row';

export function Rows({ children }: { children: ReactNode }) {
   return (
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">{children}</div>
   );
}

/** The shared lane/group header: title, optional subtitle, optional right-aligned count. */
function GroupHeader({
   title,
   sub,
   count,
   compact,
}: {
   title: string;
   sub?: string;
   count?: number;
   compact?: boolean;
}) {
   return (
      <div className={`flex items-baseline gap-2.5 ${compact ? 'mb-1' : 'mb-2'}`}>
         <h2 className={`m-0 font-semibold leading-snug ${compact ? 'text-sm' : 'text-base'}`}>
            {title}
         </h2>
         {sub && <span className="text-xs text-ink-3">{sub}</span>}
         {count != null && (
            <>
               <span className="flex-1" />
               <span className="text-xs text-ink-3 tabular-nums">{count}</span>
            </>
         )}
      </div>
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
   sub?: string;
   pulls: DerivedPull[];
   /** header count when rows come in via children instead of pulls */
   count?: number;
   cap?: number;
   opts: RowOptions;
   /** extra rows rendered inside the container, before the more-line */
   children?: ReactNode;
}) {
   if (!pulls.length && !children) return null;
   // the user's lane-length setting (0 = no cap) overrides the lane's default;
   // compact packs ~50% more rows per screen, so show more before folding
   const base = opts.laneCap ?? cap;
   const shown =
      base === 0 ? Number.POSITIVE_INFINITY : opts.compact ? Math.ceil(base * 1.5) : base;
   return (
      <section className={opts.compact ? 'mb-4' : 'mb-7'}>
         <GroupHeader
            title={title}
            sub={sub}
            count={count ?? pulls.length}
            compact={opts.compact}
         />
         <Rows>
            {children}
            <Truncated cap={shown} id={`lane:${title}`}>
               {pulls.map(p => (
                  <Row key={pullKey(p.data)} pull={p} opts={opts} />
               ))}
            </Truncated>
         </Rows>
      </section>
   );
}

/** The standard fold body: capped, expandable rows for a list of pulls. */
export function FoldRows({ list, opts }: { list: DerivedPull[]; opts: RowOptions }) {
   return (
      <Truncated>
         {list.map(p => (
            <Row key={pullKey(p.data)} pull={p} opts={opts} />
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
   hint?: string;
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
            {hint && <span className="ml-auto text-xs text-ink-3">{hint}</span>}
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
         {title && <GroupHeader title={title} sub={sub} />}
         <Rows>{children}</Rows>
      </div>
   );
}
