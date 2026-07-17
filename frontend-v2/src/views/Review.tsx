import type { DerivedPull, Status } from '../model/status';
import { pullKey } from '../format';
import { crSort } from '../model/sort';
import { authorMove, reviewerMove } from '../model/actions';
import type { PullData } from '../types';
import { EmptyState, STATUS_DOT, STATUS_LABEL } from '../components/bits';
import { AnnotatedRow, Fold, FoldRows, Lane, RestGroup, Truncated } from '../components/Lane';
import type { RowOptions } from '../components/Row';
import { ClosedRow } from '../components/ClosedRow';

/**
 * The home tab. It opens with the one lane the whole app used to lack: every
 * action that is yours — re-stamps you owe, your own merge buttons, your CI
 * fixes — regardless of who authored the pull. The daily loop must not
 * require flipping between Review and My work. Below that, other people's
 * work to pick from.
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

   // 1. Yours to do: strictly your verbs. The earlier "Act now" lesson still
   //    binds — padding this with other people's jobs made it noise — but
   //    your own merge button is your job, whichever tab you're on.
   const MOVE_RANK = [
      'Re-stamp',
      'Re-QA',
      'Finish QA',
      'Merge it',
      'Fix CI',
      'Address feedback',
      'Rebase',
   ];
   const todo = pulls
      .map(p => ({
         p,
         verb: p.data.user.login === me ? ownVerb(p) : reviewerMove(p, me),
      }))
      .filter((x): x is { p: DerivedPull; verb: string } => x.verb !== null)
      .sort(
         (a, b) =>
            MOVE_RANK.indexOf(a.verb) - MOVE_RANK.indexOf(b.verb) || b.p.ageDays - a.p.ageDays
      );

   // 2. Review queue: best next review first (leverage + age + weight).
   //    Includes pulls waiting on someone else's re-stamp — a fresh CR from
   //    you counts there too (the stale pip marks them).
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

   // 4. Needs QA is a query, not the status bucket: QA runs in parallel with
   //    CR here (v1's QA column predicate), so anything QA-incomplete with
   //    green CI belongs — not just pulls whose CR is already done. Your own
   //    in-flight QA is pinned first (v1 qaCompare), unclaimed next, claimed
   //    by someone else last.
   const needsQa = others
      .filter(
         p =>
            p.qaHave < p.data.status.qa_req &&
            ['success', 'none'].includes(p.ci) &&
            !p.conflict &&
            !['draft', 'dev_block'].includes(p.status) &&
            // your in-flight QA and owed re-QAs live in "Yours to do"
            p.qaingBy !== me &&
            !(p.status === 'needs_qa' && p.reqaBy.includes(me))
      )
      .sort(
         (a, b) =>
            Number(b.qaingBy === me) - Number(a.qaingBy === me) ||
            Number(!!a.qaingBy && a.qaingBy !== me) - Number(!!b.qaingBy && b.qaingBy !== me) ||
            b.ageDays - a.ageDays
      );

   const stamped = others.filter(p => p.status === 'needs_cr' && p.crBy.includes(me));
   const byStatus = (s: Status) => others.filter(p => p.status === s);
   const devBlocked = byStatus('dev_block');
   const deployHeld = byStatus('deploy_block');
   const unmergeable = byStatus('unmergeable');
   const ciPending = byStatus('ci_pending');
   const ciRed = byStatus('ci_red');
   const drafts = byStatus('draft');

   // bots/shipped stay reachable even when no human PRs need review
   const empty = !pulls.length && !bots.length && !closed.length;
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
         {todo.length > 0 && (
            <Lane title="Yours to do" pulls={[]} count={todo.length} opts={opts}>
               <Truncated cap={10} id="lane:Yours to do">
                  {todo.map(({ p, verb }) => (
                     <AnnotatedRow key={pullKey(p.data)} pull={p} opts={opts} side="left">
                        {verb}
                     </AnnotatedRow>
                  ))}
               </Truncated>
            </Lane>
         )}
         <Lane title="Review queue" pulls={queue} cap={9} opts={{ ...opts, badge: false }} />
         <Lane
            title="Aging without full review"
            pulls={aged}
            cap={8}
            opts={{ ...opts, badge: false, aging: true }}
         />
         <Lane
            title="Needs QA"
            sub="CR and QA run in parallel"
            pulls={needsQa}
            cap={6}
            opts={opts}
         />
         <RestGroup title="The rest of the board">
            <Fold
               dot={STATUS_DOT.ready}
               count={ready.length}
               label="ready to merge"
               hint="nudge if idle"
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
            <Fold dot={STATUS_DOT.dev_block} count={devBlocked.length} label="dev blocked">
               <FoldRows list={devBlocked} opts={opts} />
            </Fold>
            <Fold
               dot={STATUS_DOT.deploy_block}
               count={deployHeld.length}
               label="deploy hold"
               hint="each row names the holder"
            >
               <FoldRows list={deployHeld} opts={opts} />
            </Fold>
            <Fold
               dot={STATUS_DOT.unmergeable}
               count={unmergeable.length}
               label="can't merge"
               hint="the author rebases"
            >
               <FoldRows list={unmergeable} opts={opts} />
            </Fold>
            <Fold
               dot={STATUS_DOT.ci_pending}
               count={ciPending.length}
               label={STATUS_LABEL.ci_pending.toLowerCase()}
               hint="waiting on green"
            >
               <FoldRows list={ciPending} opts={opts} />
            </Fold>
            <Fold dot={STATUS_DOT.ci_red} count={ciRed.length} label="CI red">
               <FoldRows list={ciRed} opts={opts} />
            </Fold>
            <Fold
               dot={STATUS_DOT.draft}
               count={drafts.length}
               label={drafts.length === 1 ? 'draft' : 'drafts'}
            >
               <FoldRows list={drafts} opts={opts} />
            </Fold>
            <Fold dot="var(--ink-3)" count={bots.length} label="bot PRs" hint="security first">
               {/* `security` is this org's most-used label (50 in 3 months),
                   almost all on bot bumps: they lead the fold */}
               <FoldRows
                  list={[...bots].sort(
                     (a, b) =>
                        Number(b.data.labels.some(l => /security/i.test(l.title))) -
                           Number(a.data.labels.some(l => /security/i.test(l.title))) ||
                        b.ageDays - a.ageDays
                  )}
                  opts={opts}
               />
            </Fold>
            <Fold
               dot="var(--ok)"
               count={closed.length}
               label="recently shipped"
               hint="merged or closed in the last 14 days"
            >
               <Truncated>
                  {closed.map(p => (
                     <ClosedRow key={pullKey(p)} pull={p} lastSeen={opts.lastSeen} />
                  ))}
               </Truncated>
            </Fold>
         </RestGroup>
      </>
   );
}

// Your own pulls contribute only their do-it-now verbs to the home lane;
// "Find a QA-er" and "Finish the draft" stay in My work — they're planning,
// not minutes.
function ownVerb(p: DerivedPull): string | null {
   const verb = authorMove(p);
   return verb && ['Merge it', 'Fix CI', 'Address feedback', 'Rebase'].includes(verb) ? verb : null;
}
