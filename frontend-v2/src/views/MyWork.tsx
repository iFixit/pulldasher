import type { DerivedPull } from '../model/status';
import type { PullData } from '../types';
import { ago } from '../format';
import { EmptyState } from '../components/bits';
import { Fold, Lane, RestGroup, Truncated } from '../components/Lane';
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
   if (p.status === 'needs_qa' && !p.qaingBy) return 'Find a QA-er';
   if (p.status === 'draft') return 'Finish the draft';
   return null;
}

function waitingOn(p: DerivedPull): string {
   if (p.status === 'blocked' && p.blockedBy.length)
      return `blocked by ${p.blockedBy.join(', ')}, ask them to lift the block`;
   if (p.status === 'needs_recr' && p.recrBy.length) {
      const wait = p.headPushedAt ? ` (fix pushed ${ago(p.headPushedAt)} ago)` : '';
      return `waiting on ${p.recrBy.join(', ')}’s re-stamp${wait}`;
   }
   if (p.status === 'needs_cr')
      return p.crHave > 0
         ? `${p.crHave} of ${p.data.status.cr_req} CRs, open ${p.ageDays}d`
         : `no CR yet, open ${p.ageDays}d`;
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
   const byUrgency = (a: DerivedPull, b: DerivedPull) => b.ageDays - a.ageDays;
   const move = mine.filter(p => yourMove(p) !== null).sort(byUrgency);
   const waiting = mine.filter(p => yourMove(p) === null).sort(byUrgency);
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
         <Lane
            title="Your move"
            sub="each of these is waiting on you"
            pulls={[]}
            count={move.length}
            opts={opts}
         >
            {move.map(p => (
               <div
                  key={`${p.data.repo}#${p.data.number}`}
                  className="flex items-stretch border-t border-secondary first:border-t-0"
               >
                  <span className="flex w-[130px] flex-none items-center pl-3.5 text-xs font-semibold text-brand-700">
                     {yourMove(p)}
                  </span>
                  <span className="min-w-0 flex-1">
                     <Row pull={p} opts={{ ...opts, cue: false }} />
                  </span>
               </div>
            ))}
            {!move.length && (
               <div className="px-3.5 py-3 text-[13px] text-ink-3">
                  Nothing needs you right now. Everything below is waiting on someone else.
               </div>
            )}
         </Lane>
         <Lane
            title="Waiting on others"
            sub="who to nudge, and how long it’s been"
            pulls={[]}
            count={waiting.length}
            opts={opts}
         >
            {waiting.map(p => (
               <div
                  key={`${p.data.repo}#${p.data.number}`}
                  className="flex items-center border-t border-secondary first:border-t-0"
               >
                  <span className="min-w-0 flex-1">
                     <Row pull={p} opts={{ ...opts, cue: false }} />
                  </span>
                  <span className="w-[280px] flex-none truncate pr-3.5 pl-2 text-right text-xs text-ink-2">
                     <span title={waitingOn(p)}>{waitingOn(p)}</span>
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
                  label="merged or closed in the last 14 days"
                  hint=""
               >
                  <Truncated>
                     {shipped.map(p => (
                        <ClosedRow key={`${p.repo}#${p.number}`} pull={p} />
                     ))}
                  </Truncated>
               </Fold>
            </RestGroup>
         )}
      </>
   );
}
