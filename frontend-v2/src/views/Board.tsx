import { useState } from 'react';
import { pullKey } from '../format';
import type { DerivedPull, Status } from '../model/status';
import { crSort } from '../model/sort';
import { EmptyState, STATUS_DOT, STATUS_LABEL } from '../components/bits';
import { Fold, RestGroup } from '../components/Lane';
import { Row, type RowOptions } from '../components/Row';

/**
 * The classic v1 spatial model: every state as a column, scanned side by
 * side. One difference on purpose: a pull appears in exactly one column
 * (its highest-precedence status), so the counts are real and sum to the
 * total — v1's overlapping predicates showed the same pull in CR and QA.
 */

const COLUMNS: { status: Status; hint: string }[] = [
   { status: 'ready', hint: 'authors can merge' },
   { status: 'needs_recr', hint: 'reviewed, fix pushed' },
   { status: 'needs_cr', hint: 'the review pool' },
   { status: 'needs_qa', hint: 'CR done' },
   { status: 'ci_pending', hint: 'signed off, CI running' },
   { status: 'ci_red', hint: "usually the author's fix" },
   { status: 'blocked', hint: 'dev/deploy blocked, or signed off but unmergeable' },
   { status: 'draft', hint: 'not ready for review' },
];

function Column({
   status,
   hint,
   pulls,
   opts,
}: {
   status: Status;
   hint: string;
   pulls: DerivedPull[];
   opts: RowOptions;
}) {
   const [open, setOpen] = useState(true);
   if (!pulls.length) return null;
   const ordered = ['needs_cr', 'needs_recr'].includes(status) ? crSort(pulls) : pulls;
   return (
      <section className="min-w-0">
         <h2 className="m-0">
            <button
               type="button"
               aria-expanded={open}
               onClick={() => setOpen(o => !o)}
               className={`flex w-full items-center gap-2 border border-line bg-muted px-4 py-2.5 text-left text-sm font-semibold ${
                  open ? 'rounded-t-2xl' : 'rounded-2xl'
               }`}
               title={open ? 'collapse column' : 'expand column'}
            >
               <span
                  className="h-2 w-2 flex-none rounded-[3px]"
                  style={{ background: STATUS_DOT[status] }}
               />
               {STATUS_LABEL[status]}
               <span className="min-w-0 truncate text-xs font-normal text-ink-3">{hint}</span>
               <span className="flex-1" />
               <span className="text-xs font-normal text-ink-3 tabular-nums">{pulls.length}</span>
            </button>
         </h2>
         {open && (
            <div className="overflow-hidden rounded-b-2xl border border-t-0 border-line bg-surface">
               {ordered.map(p => (
                  <Row
                     key={pullKey(p.data)}
                     pull={p}
                     opts={{ ...opts, badge: false, compact: true }}
                  />
               ))}
            </div>
         )}
      </section>
   );
}

export function Board({
   pulls,
   bots,
   opts,
}: {
   pulls: DerivedPull[];
   bots: DerivedPull[];
   opts: RowOptions;
}) {
   if (!pulls.length && !bots.length) {
      return <EmptyState title="Workbench clear" sub="No open PRs in this scope." />;
   }
   const byStatus = new Map<Status, DerivedPull[]>();
   for (const p of pulls) byStatus.set(p.status, [...(byStatus.get(p.status) ?? []), p]);
   return (
      <>
         <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]">
            {COLUMNS.map(({ status, hint }) => (
               <Column
                  key={status}
                  status={status}
                  hint={hint}
                  pulls={byStatus.get(status) ?? []}
                  opts={opts}
               />
            ))}
         </div>
         {bots.length > 0 && (
            <RestGroup>
               <Fold dot="var(--ink-3)" count={bots.length} label="bot PRs" hint="dependency bumps">
                  {bots.map(p => (
                     <Row key={pullKey(p.data)} pull={p} opts={opts} />
                  ))}
               </Fold>
            </RestGroup>
         )}
      </>
   );
}
