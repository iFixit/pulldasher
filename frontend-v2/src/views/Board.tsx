import { useState } from 'react';
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
   { status: 'ready', hint: 'merge these' },
   { status: 'needs_recr', hint: 'reviewed, fix pushed' },
   { status: 'needs_cr', hint: 'the review pool' },
   { status: 'needs_qa', hint: 'CR done' },
   { status: 'ci_pending', hint: 'signed off, CI running' },
   { status: 'ci_red', hint: 'authors fix first' },
   { status: 'blocked', hint: 'dev/deploy blocks, conflicts' },
   { status: 'draft', hint: 'not ready for eyes' },
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
         <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="mb-2 flex w-full items-baseline gap-2 border-0 bg-transparent px-0 text-left"
            title={open ? 'collapse column' : 'expand column'}
         >
            <span
               className="h-2 w-2 flex-none self-center rounded-[3px]"
               style={{ background: STATUS_DOT[status] }}
            />
            <span className="text-base leading-snug font-semibold">{STATUS_LABEL[status]}</span>
            <span className="text-xs text-ink-3">{hint}</span>
            <span className="flex-1" />
            <span className="text-xs text-ink-3 tabular-nums">{pulls.length}</span>
         </button>
         {open && (
            <div className="overflow-hidden rounded-2xl border border-line bg-surface">
               {ordered.map(p => (
                  <Row
                     key={`${p.data.repo}#${p.data.number}`}
                     pull={p}
                     opts={{ ...opts, badge: false }}
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
                     <Row key={`${p.data.repo}#${p.data.number}`} pull={p} opts={opts} />
                  ))}
               </Fold>
            </RestGroup>
         )}
      </>
   );
}
