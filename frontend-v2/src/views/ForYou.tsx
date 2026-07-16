import { Fragment } from 'react';
import { isIterating, weightRank, type DerivedPull } from '../model/status';
import { EmptyState, STATUS_DOT, STATUS_LABEL } from '../components/bits';
import { DividerLine, Fold, Lane, RestGroup } from '../components/Lane';
import { Row, type RowOptions } from '../components/Row';

/** lightest first; actively-iterating pulls sink (demoted, never hidden) */
export function crSort(pulls: DerivedPull[]): DerivedPull[] {
   return [...pulls].sort(
      (a, b) =>
         Number(isIterating(a.data)) - Number(isIterating(b.data)) ||
         weightRank(a.weight) - weightRank(b.weight) ||
         (a.data.additions ?? 0) +
            (a.data.deletions ?? 0) -
            ((b.data.additions ?? 0) + (b.data.deletions ?? 0))
   );
}

export function ForYou({
   pulls,
   bots,
   opts,
}: {
   pulls: DerivedPull[];
   bots: DerivedPull[];
   opts: RowOptions;
}) {
   const me = opts.me;
   const yours = pulls.filter(p => p.data.user.login === me);
   const others = pulls.filter(p => p.data.user.login !== me);

   // 1. Act now: re-stamps (yours first), then merge nudges. Minutes each.
   const actNow = [
      ...others.filter(p => p.status === 'needs_recr' && p.recrBy.includes(me)),
      ...others.filter(p => p.status === 'needs_recr' && !p.recrBy.includes(me)),
      ...others.filter(p => p.status === 'ready'),
   ];

   // 2. Review queue: oldest debt pinned on top, then lightest to heaviest.
   const crPool = others.filter(p => p.status === 'needs_cr' && !p.crBy.includes(me));
   const aged = crPool.filter(p => p.starved).sort((a, b) => b.starveScore - a.starveScore);
   const pick = aged[0];
   const queue = crSort(crPool.filter(p => p !== pick && !p.starved));
   const firstHeavy = queue.findIndex(p => weightRank(p.weight) >= 2);

   // 3. Everything else stays countable but folded.
   const stamped = others.filter(p => p.status === 'needs_cr' && p.crBy.includes(me));
   const restAging = aged.slice(1);
   const rowKey = (p: DerivedPull) => `${p.data.repo}#${p.data.number}`;
   const foldRows = (list: DerivedPull[], o: Partial<RowOptions> = {}) =>
      list
         .slice(0, 30)
         .map(p => <Row key={rowKey(p)} pull={p} opts={{ ...opts, noDim: true, ...o }} />);

   const empty = !actNow.length && !yours.length && !crPool.length && !others.length;

   return (
      <>
         <Lane
            title="Act now"
            sub="reviewed already or fully signed off, minutes each"
            pulls={actNow}
            cap={8}
            opts={{ ...opts, pips: 'cr' }}
         />
         <Lane
            title="Your PRs"
            sub="whose move each one is"
            pulls={yours}
            cap={10}
            opts={{ ...opts, noDim: true }}
         />
         {crPool.length > 0 && (
            <Lane
               title="Review queue"
               sub={`lightest first${pick ? ', oldest debt pinned on top' : ''}`}
               pulls={[]}
               opts={opts}
            >
               {pick && (
                  <Row pull={pick} opts={{ ...opts, badge: false, pips: 'cr', aging: true }} />
               )}
               {queue.slice(0, 9).map((p, i) => (
                  <Fragment key={rowKey(p)}>
                     {i === firstHeavy && firstHeavy > 0 && (
                        <DividerLine label="heavier from here" />
                     )}
                     <Row pull={p} opts={{ ...opts, badge: false, pips: 'cr' }} />
                  </Fragment>
               ))}
               {crPool.length - Math.min(9, queue.length) - (pick ? 1 : 0) > 0 && (
                  <DividerLine
                     label={`+ ${crPool.length - Math.min(9, queue.length) - (pick ? 1 : 0)} more in the queue`}
                  />
               )}
            </Lane>
         )}
         {empty ? (
            <EmptyState
               title="Workbench clear"
               sub="No open PRs in this scope. Widen it, or savor the moment."
            />
         ) : (
            <RestGroup title="The rest of the board" sub="counts stay visible, rows open on demand">
               <Fold
                  dot={STATUS_DOT.needs_qa}
                  count={others.filter(p => p.status === 'needs_qa').length}
                  label={STATUS_LABEL.needs_qa.toLowerCase()}
                  hint="authors drive QA, nudge only"
               >
                  {foldRows(
                     others.filter(p => p.status === 'needs_qa'),
                     { pips: 'qa' }
                  )}
               </Fold>
               <Fold
                  dot="var(--warn)"
                  count={restAging.length}
                  label="aging"
                  hint="no CR for 7d+, grab one when you can"
               >
                  {foldRows(restAging, { pips: 'cr', aging: true, badge: false })}
               </Fold>
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
            </RestGroup>
         )}
      </>
   );
}
