import type { DerivedPull } from '../../../shared/model/status';
import { rowWord } from '../model/actions';
import type { PullData } from '../../../shared/types';
import { pullKey } from '../../../shared/format';
import { claimFor } from '../model/reviewers';
import { EmptyState } from '../components/bits';
import { Fold, Lane, laneShown, RestGroup, Truncated } from '../components/Lane';
import type { RowOptions } from '../components/Row';
import { WordGroupRows } from '../components/WordGroups';
import { ClosedRow } from '../components/ClosedRow';

/**
 * The author's tab: only PRs you own, split by whose move it is. The old
 * "Your PRs" lane mixed both answers; here "do this next" and "nudge this
 * person" never share a section. The split runs on the SAME rowWord the
 * word-group sub-headers render — lane and header can't disagree (splitting
 * on authorMove once put a brand "Chase CR" header inside "Waiting on
 * others", because the two models diverge on edge cases like external
 * blocks).
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
   const kindOf = (p: DerivedPull) => rowWord(p, me, { claim: claimFor(p.data) }).kind;
   const move = mine.filter(p => kindOf(p) === 'do').sort(byUrgency);
   const waiting = mine.filter(p => kindOf(p) !== 'do').sort(byUrgency);
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
            <WordGroupRows pulls={move} opts={opts} id="mine:move" cap={laneShown(12, opts)} />
            {!move.length && (
               <div className="px-3.5 py-3 text-[13px] text-ink-3">
                  Nothing needs you right now.
               </div>
            )}
         </Lane>
         <Lane title="Waiting on others" pulls={[]} count={waiting.length} opts={opts}>
            <WordGroupRows
               pulls={waiting}
               opts={opts}
               id="mine:waiting"
               cap={laneShown(12, opts)}
            />
            {!waiting.length && (
               <div className="px-3.5 py-3 text-[13px] text-ink-3">
                  Nothing is waiting on anyone else.
               </div>
            )}
         </Lane>
         {shipped.length > 0 && (
            <RestGroup>
               <Fold
                  count={shipped.length}
                  label="Recently closed"
                  gloss="Merged or closed in the last 14 days."
                  id="mine:shipped"
                  // both lanes above are clear and shipped has something to
                  // show: "look what got done" is exactly the content the
                  // all-clear day deserves, not another closed triangle
                  defaultOpen={!move.length && !waiting.length}
               >
                  <Truncated cap={laneShown(30, opts)} id="mine:shipped-rows">
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
