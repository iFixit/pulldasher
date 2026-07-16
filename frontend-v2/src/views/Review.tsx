import { Fragment } from 'react';
import { weightRank, type DerivedPull } from '../model/status';
import { crSort } from '../model/sort';
import type { PullData } from '../types';
import { EmptyState, STATUS_DOT, STATUS_LABEL } from '../components/bits';
import { DividerLine, Fold, Lane, RestGroup } from '../components/Lane';
import { Row, type RowOptions } from '../components/Row';
import { ClosedRow } from '../components/ClosedRow';

/**
 * The reviewer's tab: other people's work only. Your own PRs live in
 * My work — the two jobs never share a lane.
 */
export function Review({
   pulls,
   bots,
   closed,
   opts,
}: {
   pulls: DerivedPull[];
   bots: DerivedPull[];
   closed: PullData[];
   opts: RowOptions;
}) {
   const me = opts.me;
   const others = pulls.filter(p => p.data.user.login !== me);

   // 1. Act now: re-stamps (yours first), then merge nudges. Minutes each.
   const actNow = [
      ...others.filter(p => p.status === 'needs_recr' && p.recrBy.includes(me)),
      ...others.filter(p => p.status === 'needs_recr' && !p.recrBy.includes(me)),
      ...others.filter(p => p.status === 'ready'),
   ];

   // 2. Review queue: lightest to heaviest.
   const crPool = others.filter(p => p.status === 'needs_cr' && !p.crBy.includes(me));
   const aged = crPool.filter(p => p.starved).sort((a, b) => b.starveScore - a.starveScore);
   const queue = crSort(crPool.filter(p => !p.starved));
   const firstHeavy = queue.findIndex(p => weightRank(p.weight) >= 2);

   // 3. Aging: its own visible lane — the fairness debt, not a footnote.
   const agingShown = aged.slice(0, 3);

   // 4. Needs QA: a real lane again (v1's QA column earned it); QAing-label
   //    rows sort last since someone is already on them.
   const needsQa = [...others.filter(p => p.status === 'needs_qa')].sort(
      (a, b) => Number(!!a.qaingBy) - Number(!!b.qaingBy)
   );

   const stamped = others.filter(p => p.status === 'needs_cr' && p.crBy.includes(me));
   const rowKey = (p: DerivedPull) => `${p.data.repo}#${p.data.number}`;
   const foldRows = (list: DerivedPull[], o: Partial<RowOptions> = {}) =>
      list
         .slice(0, 30)
         .map(p => <Row key={rowKey(p)} pull={p} opts={{ ...opts, noDim: true, ...o }} />);

   const empty = !actNow.length && !crPool.length && !needsQa.length && !others.length;
   if (empty) {
      return (
         <EmptyState
            title="Workbench clear"
            sub="Nothing to review in this scope. Widen it, or savor the moment."
         />
      );
   }

   return (
      <>
         <Lane
            title="Act now"
            sub="reviewed already or fully signed off, minutes each"
            pulls={actNow}
            cap={8}
            opts={{ ...opts, pips: 'cr' }}
         />
         {crPool.length > 0 && (
            <Lane title="Review queue" sub="lightest first" pulls={[]} opts={opts}>
               {queue.slice(0, 9).map((p, i) => (
                  <Fragment key={rowKey(p)}>
                     {i === firstHeavy && firstHeavy > 0 && (
                        <DividerLine label="heavier from here" />
                     )}
                     <Row pull={p} opts={{ ...opts, badge: false, pips: 'cr' }} />
                  </Fragment>
               ))}
               {queue.length > 9 && (
                  <DividerLine label={`+ ${queue.length - 9} more in the queue`} />
               )}
            </Lane>
         )}
         {aged.length > 0 && (
            <Lane
               title="Aging without review"
               sub="oldest debt first — take one per session"
               pulls={[]}
               opts={opts}
            >
               {agingShown.map(p => (
                  <Row
                     key={rowKey(p)}
                     pull={p}
                     opts={{ ...opts, badge: false, pips: 'cr', aging: true }}
                  />
               ))}
               {aged.length > 3 && <DividerLine label={`+ ${aged.length - 3} more aging`} />}
            </Lane>
         )}
         <Lane
            title="Needs QA"
            sub="CR done — grab one, or nudge the author"
            pulls={needsQa}
            cap={6}
            opts={{ ...opts, pips: 'qa', noDim: true }}
         />
         <RestGroup title="The rest of the board" sub="counts stay visible, rows open on demand">
            <Fold
               dot="var(--ok)"
               count={stamped.length}
               label="you stamped"
               hint="waiting on a second reviewer"
            >
               {foldRows(stamped, { pips: 'cr', badge: false })}
            </Fold>
            <Fold
               dot={STATUS_DOT.blocked}
               count={others.filter(p => p.status === 'blocked').length}
               label="blocked"
               hint="find who holds the block"
            >
               {foldRows(others.filter(p => p.status === 'blocked'))}
            </Fold>
            <Fold
               dot={STATUS_DOT.ci_pending}
               count={others.filter(p => p.status === 'ci_pending').length}
               label={STATUS_LABEL.ci_pending.toLowerCase()}
               hint="signed off, waiting on green"
            >
               {foldRows(others.filter(p => p.status === 'ci_pending'))}
            </Fold>
            <Fold
               dot={STATUS_DOT.ci_red}
               count={others.filter(p => p.status === 'ci_red').length}
               label="CI red"
               hint="authors’ move"
            >
               {foldRows(others.filter(p => p.status === 'ci_red'))}
            </Fold>
            <Fold
               dot={STATUS_DOT.draft}
               count={others.filter(p => p.status === 'draft').length}
               label="drafts"
               hint="not reviewable yet"
            >
               {foldRows(others.filter(p => p.status === 'draft'))}
            </Fold>
            <Fold
               dot="var(--ink-3)"
               count={bots.length}
               label="bot PRs"
               hint="batch in one sitting or automerge"
            >
               {foldRows(bots)}
            </Fold>
            <Fold
               dot="var(--ok)"
               count={closed.length}
               label="recently shipped"
               hint="merged or closed in the last 14 days"
            >
               {closed.slice(0, 30).map(p => (
                  <ClosedRow key={`${p.repo}#${p.number}`} pull={p} />
               ))}
            </Fold>
         </RestGroup>
      </>
   );
}
