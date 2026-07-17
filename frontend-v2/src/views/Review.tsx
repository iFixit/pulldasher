import type { DerivedPull, Status } from '../model/status';
import { pullKey } from '../format';
import { crSort } from '../model/sort';
import type { PullData } from '../types';
import { EmptyState, STATUS_DOT, STATUS_LABEL } from '../components/bits';
import { Fold, FoldRows, Lane, RestGroup, Truncated } from '../components/Lane';
import type { RowOptions } from '../components/Row';
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

   // 1. Act now: ONLY re-stamps you personally owe. The review pass found the
   //    old version padded with other people's jobs (their re-stamps, other
   //    authors' merge buttons) — three mornings of that and the lane reads
   //    as noise. Now it's always truthfully "minutes, and yours".
   const actNow = others.filter(p => p.status === 'needs_recr' && p.recrBy.includes(me));

   // 2. Review queue: lightest first. Includes pulls waiting on someone
   //    else's re-stamp — a fresh CR from you counts there too (the stale
   //    pip marks them).
   const crPool = others.filter(
      p =>
         (p.status === 'needs_cr' && !p.crBy.includes(me)) ||
         (p.status === 'needs_recr' && !p.recrBy.includes(me))
   );
   const aged = crPool.filter(p => p.starved).sort((a, b) => b.starveScore - a.starveScore);
   const queue = crSort(crPool.filter(p => !p.starved));

   // Ready-to-merge is the author's button, not the reviewer's job: a count
   // in the rest group, not a lane at the top.
   const ready = others.filter(p => p.status === 'ready');

   // 4. Needs QA: a real lane again (v1's QA column earned it); QAing-label
   //    rows sort last since someone is already on them.
   const needsQa = [...others.filter(p => p.status === 'needs_qa')].sort(
      (a, b) => Number(!!a.qaingBy) - Number(!!b.qaingBy)
   );

   const stamped = others.filter(p => p.status === 'needs_cr' && p.crBy.includes(me));
   const byStatus = (s: Status) => others.filter(p => p.status === s);
   const blocked = byStatus('blocked');
   const ciPending = byStatus('ci_pending');
   const ciRed = byStatus('ci_red');
   const drafts = byStatus('draft');

   // bots/shipped stay reachable even when no human PRs need review
   const empty = !others.length && !bots.length && !closed.length;
   if (empty) {
      return (
         <EmptyState
            title="Workbench clear"
            sub="Nothing to review in this scope. Widen the scope to see more."
         />
      );
   }

   return (
      <>
         <Lane
            title="Act now"
            sub="re-stamps you owe, minutes each"
            pulls={actNow}
            cap={8}
            opts={opts}
         />
         <Lane
            title="Review queue"
            sub="lightest first"
            pulls={queue}
            cap={9}
            opts={{ ...opts, badge: false }}
         />
         <Lane
            title="Aging without review"
            sub="biggest debt first. Take one."
            pulls={aged}
            cap={3}
            opts={{ ...opts, badge: false, aging: true }}
         />
         <Lane
            title="Needs QA"
            sub="CR done, grab one or nudge the author"
            pulls={needsQa}
            cap={6}
            opts={opts}
         />
         <RestGroup title="The rest of the board" sub="blocked, red, drafts, bots, shipped">
            <Fold
               dot={STATUS_DOT.ready}
               count={ready.length}
               label="ready to merge"
               hint="authors can merge, nudge if idle"
            >
               <FoldRows list={ready} opts={opts} />
            </Fold>
            <Fold
               dot="var(--ok)"
               count={stamped.length}
               label="stamped by you"
               hint="waiting on another reviewer"
            >
               <FoldRows list={stamped} opts={opts} extra={{ badge: false }} />
            </Fold>
            <Fold dot={STATUS_DOT.blocked} count={blocked.length} label="blocked" hint="each row names the holder">
               <FoldRows list={blocked} opts={opts} />
            </Fold>
            <Fold
               dot={STATUS_DOT.ci_pending}
               count={ciPending.length}
               label={STATUS_LABEL.ci_pending.toLowerCase()}
               hint="signed off, waiting on green"
            >
               <FoldRows list={ciPending} opts={opts} />
            </Fold>
            <Fold dot={STATUS_DOT.ci_red} count={ciRed.length} label="CI red" hint="usually the author's fix">
               <FoldRows list={ciRed} opts={opts} />
            </Fold>
            <Fold
               dot={STATUS_DOT.draft}
               count={drafts.length}
               label={drafts.length === 1 ? 'draft' : 'drafts'}
               hint="not reviewable yet"
            >
               <FoldRows list={drafts} opts={opts} />
            </Fold>
            <Fold
               dot="var(--ink-3)"
               count={bots.length}
               label="bot PRs"
               hint="dependency bumps, review in a batch"
            >
               <FoldRows list={bots} opts={opts} />
            </Fold>
            <Fold
               dot="var(--ok)"
               count={closed.length}
               label="recently shipped"
               hint="merged or closed in the last 14 days"
            >
               <Truncated>
                  {closed.map(p => (
                     <ClosedRow key={pullKey(p)} pull={p} />
                  ))}
               </Truncated>
            </Fold>
         </RestGroup>
      </>
   );
}
