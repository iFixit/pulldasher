import type { DerivedPull } from '../model/status';
import { authorMove } from '../model/actions';
import type { PullData } from '../types';
import { pullKey } from '../format';
import { EmptyState } from '../components/bits';
import { Fold, Lane, laneShown, RestGroup, Truncated } from '../components/Lane';
import { Row, type RowOptions } from '../components/Row';
import { ClosedRow } from '../components/ClosedRow';

/**
 * The author's tab: only PRs you own, split by whose move it is. The old
 * "Your PRs" lane mixed both answers; here "do this next" and "nudge this
 * person" never share a section. Each row's action/wait line comes from the
 * shared rowNote (model/actions.ts), the same one every other lens renders.
 */

export function MyWork({
   pulls,
   closed,
   opts,
}: {
   pulls: DerivedPull[];
   closed: PullData[];
   opts: RowOptions;
}) {
   const me = opts.me;
   const mine = pulls.filter(p => p.data.user.login === me);
   const byUrgency = (a: DerivedPull, b: DerivedPull) => b.ageDays - a.ageDays;
   const move = mine.filter(p => authorMove(p) !== null).sort(byUrgency);
   const waiting = mine.filter(p => authorMove(p) === null).sort(byUrgency);
   const shipped = closed.filter(p => p.user.login === me);

   if (!mine.length && !shipped.length) {
      return (
         <EmptyState
            title="Nothing of yours is open"
            sub="Everything you authored is merged or closed."
         />
      );
   }

   return (
      <>
         <Lane title="Your move" pulls={[]} count={move.length} opts={opts}>
            {move.map(p => (
               <Row key={pullKey(p.data)} pull={p} opts={opts} />
            ))}
            {!move.length && (
               <div className="px-3.5 py-3 text-[13px] text-ink-3">
                  Nothing needs you right now.
               </div>
            )}
         </Lane>
         <Lane title="Waiting on others" pulls={[]} count={waiting.length} opts={opts}>
            {waiting.map(p => (
               <Row key={pullKey(p.data)} pull={p} opts={opts} />
            ))}
            {!waiting.length && (
               <div className="px-3.5 py-3 text-[13px] text-ink-3">
                  Nothing is waiting on anyone else.
               </div>
            )}
         </Lane>
         {shipped.length > 0 && (
            <RestGroup>
               <Fold
                  dot="var(--ok)"
                  count={shipped.length}
                  label="recently shipped"
                  hint="merged or closed in the last 14 days"
               >
                  <Truncated cap={laneShown(30, opts)}>
                     {shipped.map(p => (
                        <ClosedRow key={pullKey(p)} pull={p} lastSeen={opts.lastSeen} />
                     ))}
                  </Truncated>
               </Fold>
            </RestGroup>
         )}
      </>
   );
}
