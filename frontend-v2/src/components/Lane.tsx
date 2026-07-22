import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import { pullKey } from '../format';
import type { DerivedPull } from '../model/status';
import { groupIntoTree } from '../model/stack';
import { createPersistentStore } from '../storage';
import { Icon } from './Icon';
import { Popover } from './Popover';
import { Row, type RowOptions } from './Row';

/**
 * Explicitly-chosen fold open/closed state, one entry per fold `id`. A fold
 * with no entry here falls back to its `defaultOpen` — this only remembers a
 * choice the user actually made, so a later `defaultOpen` change (e.g. the
 * lonely-board auto-open) still applies to folds nobody has touched yet.
 */
const foldOpenStore = createPersistentStore<Record<string, boolean>>('pd2.folds', {});

/** The DOM id a fold with this store `id` renders under — colons aren't
 * valid in a CSS selector, so callers that need to query the element (a
 * banner jumping to "recently shipped") go through this instead of
 * reconstructing the prefix by hand. */
export function foldDomId(id: string): string {
   return `fold-${id.replace(/:/g, '-')}`;
}

/** Open a fold from outside Lane.tsx — e.g. the "N merged since your last
 * look" banner jumping straight to the shipped fold — by writing the same
 * store its own toggle reads. A no-op if it's already open. */
export function openFold(id: string): void {
   const cur = foldOpenStore.get();
   if (cur[id] !== true) foldOpenStore.set({ ...cur, [id]: true });
}

/**
 * A lane sub-line that is itself the door to the full story: the one-sentence
 * ordering statement stays in the header (dotted underline, zero chrome at
 * rest), and hovering it opens what lands in the lane and how it's ranked.
 * This is the house pattern for every curated lane — if a user has to ask
 * why a card is here, the lane's own sub-line should have answered it.
 */
export function SubDoor({
   label,
   text,
   children,
}: {
   /** the popover's accessible name, e.g. "How the queue is ranked" */
   label: string;
   /** the visible sub-line sentence */
   text: string;
   children: ReactNode;
}) {
   return (
      <Popover
         label={label}
         side="right"
         hover
         rootClass="relative inline-flex"
         width="w-[300px]"
         panelClass="p-3 text-xs"
         trigger={t => (
            <button
               {...t}
               type="button"
               className="hit rounded border-0 bg-transparent p-0 text-left text-xs text-ink-3 underline decoration-dotted underline-offset-2 hover:text-ink-2"
            >
               {text}
            </button>
         )}
      >
         <div className="flex flex-col gap-1.5 px-1 text-ink-2">{children}</div>
      </Popover>
   );
}

export function Rows({ children }: { children: ReactNode }) {
   return (
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">{children}</div>
   );
}

/** The shared lane/group header: title, optional subtitle, optional
 * right-aligned count and/or an extra control. Exported so one-off sections
 * use the one header system instead of hand-rolling a lookalike. */
export function GroupHeader({
   title,
   sub,
   count,
   compact,
   headerExtra,
}: {
   title: string;
   /** plain string for most lanes; a ReactNode when the sub-line itself is
    * the door to more detail (Review's queue wraps its ranking one-liner in
    * a popover — existing text becomes interactive, zero new chrome) */
   sub?: ReactNode;
   count?: number;
   compact?: boolean;
   headerExtra?: ReactNode;
}) {
   return (
      // sticky just under the app header (top from the measured --header-h),
      // opaque over the canvas so long lanes keep their context while rows
      // scroll beneath; the old margin-below became padding so the spacing
      // itself is part of the opaque surface
      <div
         className={`sticky top-[var(--header-h,0px)] z-[5] flex items-baseline gap-2.5 bg-[var(--canvas)] ${
            compact ? 'pb-1' : 'pb-2'
         }`}
      >
         <h2 className={`m-0 font-semibold leading-snug ${compact ? 'text-sm' : 'text-base'}`}>
            {title}
         </h2>
         {sub && <span className="text-xs text-ink-3">{sub}</span>}
         {/* an empty section earns a title, never a "0" — the count only
             appears once there's something to count; headerExtra alone can
             still earn the right-aligned slot on an otherwise count-less lane */}
         {(!!count || headerExtra) && (
            <>
               <span className="flex-1" />
               {!!count && <span className="text-xs text-ink-3 tabular-nums">{count}</span>}
               {headerExtra}
            </>
         )}
      </div>
   );
}

/**
 * Rows a lane shows before folding into "+N more": the user's lane-length
 * setting (0 = no cap) over the lane's default, with compact density packing
 * ~50% more rows per fold. The one cap convention — any lane that can't use
 * <Lane pulls> (custom children) must still cap through this.
 */
export function laneShown(defaultCap: number, opts: RowOptions): number {
   const base = opts.laneCap ?? defaultCap;
   return base === 0 ? Number.POSITIVE_INFINITY : opts.compact ? Math.ceil(base * 1.5) : base;
}

export function Lane({
   title,
   sub,
   pulls,
   count,
   cap = 10,
   opts,
   children,
   headerExtra,
}: {
   title: string;
   sub?: ReactNode;
   pulls: DerivedPull[];
   /** header count when rows come in via children instead of pulls */
   count?: number;
   cap?: number;
   opts: RowOptions;
   /** extra rows rendered inside the container, before the more-line */
   children?: ReactNode;
   /** an extra control right-aligned in the header */
   headerExtra?: ReactNode;
}) {
   if (!pulls.length && !children) return null;
   const shown = laneShown(cap, opts);
   const tree = groupIntoTree(pulls);
   return (
      <section className={opts.compact ? 'mb-4' : 'mb-7'}>
         <GroupHeader
            title={title}
            sub={sub}
            count={count ?? pulls.length}
            compact={opts.compact}
            headerExtra={headerExtra}
         />
         <Rows>
            {children}
            <Truncated cap={shown} id={`lane:${title}`}>
               {tree.map(({ pull: p, depth }) => (
                  <Row key={pullKey(p.data)} pull={p} opts={opts} depth={depth} />
               ))}
            </Truncated>
         </Rows>
      </section>
   );
}

/** The standard fold body: capped, expandable rows for a list of pulls. */
export function FoldRows({
   list,
   opts,
   id,
}: {
   list: DerivedPull[];
   opts: RowOptions;
   /** stable identity: remembers "+N more" expansion across unmounts this session */
   id?: string;
}) {
   const tree = groupIntoTree(list);
   return (
      <Truncated cap={laneShown(30, opts)} id={id}>
         {tree.map(({ pull: p, depth }) => (
            <Row key={pullKey(p.data)} pull={p} opts={opts} depth={depth} />
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
   // don't stagger a fold that was already open on mount (a lens revisit this
   // session): the reveal animation is earned only on the click that opens it
   const [justExpanded, setJustExpanded] = useState(false);
   const expand = () => {
      setExpanded(true);
      setJustExpanded(true);
      if (id) expandedIds.add(id);
   };
   const base = children.slice(0, cap);
   const extra = expanded ? children.slice(cap) : [];
   const more = children.length - base.length - extra.length;
   return (
      <>
         {base}
         {extra.length > 0 &&
            (justExpanded ? (
               // display:contents keeps the rows in the container's flow while
               // the wrapper only carries the stagger
               <div className="reveal-stagger" style={{ display: 'contents' }}>
                  {extra}
               </div>
            ) : (
               extra
            ))}
         {more > 0 && (
            <button
               type="button"
               onClick={expand}
               className="pressable block w-full border-t border-secondary bg-muted/50 px-3.5 py-[9px] text-left text-xs font-medium text-ink-2 hover:text-brand"
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
   id,
   defaultOpen = false,
   children,
}: {
   dot: string;
   count: number;
   label: string;
   hint?: string;
   /** stable identity: remembers this fold's open/closed choice across sessions */
   id?: string;
   /** initial state when nothing is stored yet — e.g. auto-open the one fold
    * that's the only content on an otherwise-quiet board */
   defaultOpen?: boolean;
   children: ReactNode;
}) {
   if (!count) return null;
   const stored = foldOpenStore.useValue();
   const explicit = id ? stored[id] : undefined;
   const open = explicit ?? defaultOpen;
   // native <details> owns its own open/closed state on click; we only need to
   // hear about it so the store matches, not to drive every toggle ourselves —
   // writing back only on an actual change keeps stored-value re-renders from
   // re-triggering this handler
   const onToggle = (e: SyntheticEvent<HTMLDetailsElement>) => {
      if (!id) return;
      const next = e.currentTarget.open;
      if (foldOpenStore.get()[id] !== next)
         foldOpenStore.set({ ...foldOpenStore.get(), [id]: next });
   };
   return (
      <details
         id={id ? foldDomId(id) : undefined}
         className="group border-t border-secondary first:border-t-0"
         open={id ? open : undefined}
         onToggle={id ? onToggle : undefined}
      >
         <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3.5 py-[9px] text-[13px] text-ink-2 transition-[background-color] duration-150 ease-out hover:bg-muted motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
            <Icon
               icon={ChevronRight}
               className="text-ink-3 transition-[rotate] duration-150 ease-out group-open:rotate-90 motion-reduce:transition-none"
            />
            <span className="h-2 w-2 flex-none rounded-[3px]" style={{ background: dot }} />
            <span className="tabular-nums">{count}</span> {label}
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
