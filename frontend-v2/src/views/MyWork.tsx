import type { DerivedPull } from '../model/status';
import type { PullData } from '../types';
import { ago } from '../format';
import { EmptyState } from '../components/bits';
import { Fold, Lane, RestGroup } from '../components/Lane';
import { Row, type RowOptions } from '../components/Row';
import { ClosedRow } from '../components/ClosedRow';

/**
 * The author's tab: only PRs you own, split by whose move it is. The old
 * "Your PRs" lane mixed both answers; here "do this next" and "nudge this
 * person" never share a section.
 */

/** Your-move verb per state; null = waiting on someone else. */
function yourMove(p: DerivedPull): string | null {
   if (p.status === 'ready') return 'Merge it';
   if (p.status === 'ci_red') return 'Fix CI';
   if (p.conflict) return 'Resolve conflicts';
   if (p.status === 'needs_qa' && !p.qaingBy) return 'QA it';
   if (p.status === 'draft') return 'Finish the draft';
   return null;
}

function waitingOn(p: DerivedPull): string {
   if (p.status === 'blocked' && p.blockedBy.length)
      return `blocked by ${p.blockedBy.join(', ')}, ask them to lift the block`;
   if (p.status === 'needs_recr' && p.recrBy.length) {
      const wait = p.headPushedAt ? ` (fix up ${ago(p.headPushedAt)})` : '';
      return `waiting on ${p.recrBy.join(', ')}’s re-stamp${wait}`;
   }
   if (p.status === 'needs_cr') return `waiting on first CR, ${p.ageDays}d old`;
   if (p.status === 'needs_qa' && p.qaingBy) return `${p.qaingBy} is QAing now`;
   if (p.status === 'ci_pending') return 'waiting on CI';
   return 'waiting';
}

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
   const move = mine.filter(p => yourMove(p) !== null);
   const waiting = mine.filter(p => yourMove(p) === null);
   const shipped = closed.filter(p => p.user.login === me);

   if (!mine.length && !shipped.length) {
      return (
         <EmptyState
            title="Nothing of yours is open"
            sub="Every PR you authored is merged or closed. Ship something new."
         />
      );
   }

   return (
      <>
         <Lane title="Your move" sub="each of these is waiting on you" pulls={[]} opts={opts}>
            {move.map(p => (
               <div key={`${p.data.repo}#${p.data.number}`} className="flex items-stretch">
                  <span className="flex w-[130px] flex-none items-center border-t border-secondary pl-3.5 text-xs font-semibold text-brand-700">
                     {yourMove(p)}
                  </span>
                  <span className="min-w-0 flex-1">
                     <Row pull={p} opts={{ ...opts, noDim: true }} />
                  </span>
               </div>
            ))}
            {!move.length && (
               <div className="px-3.5 py-3 text-[13px] text-ink-3">
                  Nothing needs you right now — it’s all in other people’s hands below.
               </div>
            )}
         </Lane>
         <Lane
            title="Waiting on others"
            sub="who to nudge, and how long it’s been"
            pulls={[]}
            opts={opts}
         >
            {waiting.map(p => (
               <div key={`${p.data.repo}#${p.data.number}`} className="flex items-stretch">
                  <span className="min-w-0 flex-1">
                     <Row pull={p} opts={{ ...opts, noDim: true }} />
                  </span>
                  <span className="flex max-w-[280px] flex-none items-center border-t border-secondary pr-3.5 pl-2 text-right text-xs text-ink-2">
                     {waitingOn(p)}
                  </span>
               </div>
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
                  label="shipped in the last 14 days"
                  hint="nice work"
               >
                  {shipped.slice(0, 30).map(p => (
                     <ClosedRow key={`${p.repo}#${p.number}`} pull={p} />
                  ))}
               </Fold>
            </RestGroup>
         )}
      </>
   );
}
