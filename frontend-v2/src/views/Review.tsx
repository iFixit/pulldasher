import { type DerivedPull, qaDone, type Status, weightRank } from '../model/status';
import { pullKey } from '../format';
import { crSort } from '../model/sort';
import { authorMove, reviewerMove } from '../model/actions';
import { useSettings } from '../settings';
import { isFresh } from '../store';
import type { PullData } from '../types';
import { EmptyState, STATUS_DOT, STATUS_LABEL } from '../components/bits';
import { Fold, FoldRows, Lane, laneShown, RestGroup, Truncated } from '../components/Lane';
import { Row, type RowOptions } from '../components/Row';
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
   const { selfReview, primaryRepos } = useSettings();
   const others = pulls.filter(p => p.data.user.login !== me);

   // Repo relevance is per-person: a web dev and a firmware dev share the
   // monorepo but little else. Your primary repos are the ones you set, or —
   // until you set any — the ones you're demonstrably in (authored or stamped
   // on the current board). An empty set means we can't tell, so treat every
   // repo as primary and fall back to one flat queue.
   const primarySet = primaryRepos.length
      ? new Set(primaryRepos)
      : new Set(
           pulls
              .filter(p => p.data.user.login === me || p.crBy.includes(me) || p.qaBy.includes(me))
              .map(p => p.data.repo)
        );
   const isPrimaryRepo = (repo: string) => primarySet.size === 0 || primarySet.has(repo);

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
      'Find a QA-er',
   ];
   const todo = pulls
      .map(p => ({
         p,
         verb: p.data.user.login === me ? ownVerb(p, selfReview) : reviewerMove(p, me),
      }))
      .filter((x): x is { p: DerivedPull; verb: string } => x.verb !== null)
      .sort(
         (a, b) =>
            MOVE_RANK.indexOf(a.verb) - MOVE_RANK.indexOf(b.verb) || b.p.ageDays - a.p.ageDays
      );

   // 2. Review queue: best next review first (leverage + age + weight).
   //    Includes pulls waiting on someone else's re-stamp — a fresh CR from
   //    you counts there too (the stale pip marks them).
   // exclude PRs you already hold a live CR stamp on — including a needs_recr
   // whose re-stamp is owed by someone else, not you. You reviewed this head;
   // being asked to review it again because a different reviewer's stamp went
   // stale is the re-review gap that put already-done work back in your queue.
   const crPool = others.filter(
      p =>
         !p.crBy.includes(me) &&
         (p.status === 'needs_cr' || (p.status === 'needs_recr' && !p.recrBy.includes(me)))
   );
   const aged = crPool.filter(p => p.starved).sort((a, b) => b.starveScore - a.starveScore);
   // your review queue leads with your repos; everything else folds into "other
   // repos" so it's reachable but not in the way. Starvation stays cross-repo
   // (below) — the fairness backstop is deliberately everyone's job.
   const reviewable = crSort(crPool.filter(p => !p.starved));
   const queue = reviewable.filter(p => isPrimaryRepo(p.data.repo));
   const queueOther = reviewable.filter(p => !isPrimaryRepo(p.data.repo));

   // Ready-to-merge is the author's button, not the reviewer's job: a count
   // in the rest group, not a lane at the top.
   const ready = others.filter(p => p.status === 'ready');

   // 4. Needs QA is a query, not the status bucket: QA runs in parallel with
   //    CR here (v1's QA column predicate), so anything QA-incomplete with
   //    green CI belongs — not just pulls whose CR is already done. Unclaimed
   //    QA leads (it needs a volunteer), someone-else's claim sinks; within a
   //    claim state, lighter tests first, then oldest. Split by your primary
   //    repos, same as the review queue — QA is the bottleneck on a
   //    self-review team, so it deserves the same relevance cut.
   const qaPool = others.filter(
      p =>
         !qaDone(p) &&
         ['success', 'none'].includes(p.ci) &&
         !p.conflict &&
         !['draft', 'dev_block'].includes(p.status) &&
         // your in-flight QA and owed re-QAs live in "Yours to do"; a QA
         // stamp you already gave lives in the "QA'd by you" fold
         p.qaingLogin !== me &&
         !p.qaBy.includes(me) &&
         !(p.status === 'needs_qa' && p.reqaBy.includes(me))
   );
   const qaSort = (list: DerivedPull[]) =>
      [...list].sort(
         (a, b) =>
            Number(!!a.qaingLogin) - Number(!!b.qaingLogin) ||
            (a.sizeKnown ? weightRank(a.weight) : 2.5) -
               (b.sizeKnown ? weightRank(b.weight) : 2.5) ||
            b.ageDays - a.ageDays
      );
   const needsQa = qaSort(qaPool.filter(p => isPrimaryRepo(p.data.repo)));
   const needsQaOther = qaSort(qaPool.filter(p => !isPrimaryRepo(p.data.repo)));

   // your live CR stamp is in, the PR just isn't fully signed off yet (another
   // reviewer owes a stamp, or a re-CR). Covers needs_recr too, so a PR you
   // reviewed doesn't vanish once someone else's stamp goes stale.
   const stamped = others.filter(
      p => (p.status === 'needs_cr' || p.status === 'needs_recr') && p.crBy.includes(me)
   );
   // QA's symmetric case: you gave a QA stamp but qa_req wants more. Without
   // this the PR sits in "Needs QA" as if you never touched it.
   const qaStamped = others.filter(p => !qaDone(p) && p.qaBy.includes(me));
   const byStatus = (s: Status) => others.filter(p => p.status === s);
   const devBlocked = byStatus('dev_block');
   const deployHeld = byStatus('deploy_block');
   const unmergeable = byStatus('unmergeable');
   const ciPending = byStatus('ci_pending');
   const ciRed = byStatus('ci_red');
   const drafts = byStatus('draft');

   // Changed since your last look: everything that moved (new or updated),
   // collected at the top instead of a bar toggle — newest change first. A
   // pull can also live in a lane below; this is the "what happened while I
   // was away" glance, not an exclusive bucket.
   const changed = pulls
      .filter(p => isFresh(p.data, opts.lastSeen, opts.acked))
      .sort((a, b) => Date.parse(b.data.updated_at) - Date.parse(a.data.updated_at));

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
               <Truncated cap={laneShown(10, opts)} id="lane:Yours to do">
                  {todo.map(({ p }) => (
                     <Row key={pullKey(p.data)} pull={p} opts={opts} />
                  ))}
               </Truncated>
            </Lane>
         )}
         <Lane
            title="Changed since your last look"
            sub="new or updated while you were away"
            pulls={changed}
            cap={8}
            opts={opts}
         />
         <Lane
            title="Review queue"
            sub={queueOther.length ? 'in your repos' : undefined}
            pulls={queue}
            cap={9}
            opts={opts}
         />
         <Lane
            title="Aging without full review"
            pulls={aged}
            cap={8}
            opts={{ ...opts, aging: true }}
         />
         <Lane
            title="Needs QA"
            sub={
               needsQaOther.length
                  ? 'in your repos · CR and QA run in parallel'
                  : 'CR and QA run in parallel'
            }
            pulls={needsQa}
            cap={6}
            opts={opts}
         />
         <RestGroup title="The rest of the board">
            <Fold
               dot={STATUS_DOT.needs_cr}
               count={queueOther.length}
               label="to review in other repos"
               hint="outside your primary repos"
            >
               <FoldRows list={queueOther} opts={opts} />
            </Fold>
            <Fold
               dot={STATUS_DOT.needs_qa}
               count={needsQaOther.length}
               label="to QA in other repos"
               hint="outside your primary repos"
            >
               <FoldRows list={needsQaOther} opts={opts} />
            </Fold>
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
               <FoldRows list={stamped} opts={opts} />
            </Fold>
            <Fold
               dot="var(--ok)"
               count={qaStamped.length}
               label="QA’d by you"
               hint="waiting on another tester"
            >
               <FoldRows list={qaStamped} opts={opts} />
            </Fold>
            <Fold dot={STATUS_DOT.dev_block} count={devBlocked.length} label="dev blocked">
               <FoldRows list={devBlocked} opts={opts} />
            </Fold>
            <Fold
               dot={STATUS_DOT.deploy_block}
               count={deployHeld.length}
               label="deploy blocked"
               hint="each row names who blocked it"
            >
               <FoldRows list={deployHeld} opts={opts} />
            </Fold>
            <Fold
               dot={STATUS_DOT.unmergeable}
               count={unmergeable.length}
               label="can’t merge"
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
               <Truncated cap={laneShown(30, opts)}>
                  {closed.map(p => (
                     <ClosedRow key={pullKey(p)} pull={p} lastSeen={opts.lastSeen} />
                  ))}
               </Truncated>
            </Fold>
         </RestGroup>
      </>
   );
}

// Your own pulls contribute only their do-it-now verbs to the home lane.
// "Finish the draft" always stays in My work (planning, not minutes). Getting
// QA is different: when the team self-reviews, CR isn't the gate and lining up
// QA is the daily stall, so "Find a QA-er" graduates to a home to-do.
function ownVerb(p: DerivedPull, selfReview: boolean): string | null {
   const verb = authorMove(p);
   if (!verb) return null;
   const doNow = ['Merge it', 'Fix CI', 'Address feedback', 'Rebase'];
   if (selfReview) doNow.push('Find a QA-er');
   return doNow.includes(verb) ? verb : null;
}
