import { useState } from 'react';
import { type DerivedPull, qaDone, type Status, weightRank } from '../model/status';
import { pullKey, rowDomId } from '../format';
import { crSort, starFirst } from '../model/sort';
import { regionFirst } from '../model/regions';
import { groupIntoTree } from '../model/stack';
import { authorMove, reviewerMove } from '../model/actions';
import { dealOne } from '../model/deal';
import { useSettings } from '../settings';
import { claimReview, isFresh, releaseReview, usePulldasher } from '../store';
import type { PullData } from '../types';
import { EmptyState, QuietButton, STATUS_DOT, STATUS_LABEL } from '../components/bits';
import { Fold, FoldRows, Lane, laneShown, RestGroup, Truncated } from '../components/Lane';
import { markDealtFlash, Row, type RowOptions } from '../components/Row';
import { ClosedRow } from '../components/ClosedRow';

/**
 * "Deal me one": for a reviewer who'd rather click than browse, pick the
 * single best pull from the review queue, claim it, and scroll to it. A
 * "Pass" button appears alongside once something's dealt — passing releases
 * the claim and deals the next one, so cycling through the queue this way
 * never requires opening the lane at all.
 */
function DealButton({ queue, opts }: { queue: DerivedPull[]; opts: RowOptions }) {
   const { pulls } = usePulldasher();
   const [dealtKey, setDealtKey] = useState<string | null>(null);
   const [passed, setPassed] = useState<ReadonlySet<string>>(new Set());
   // self-clearing, same pattern as Settings' refreshNote — a transient
   // "nothing to deal" note, not a standing empty state
   const [note, setNote] = useState('');

   const deal = (passedNow: ReadonlySet<string>) => {
      const picked = dealOne(queue, {
         me: opts.me,
         pulls,
         claims: opts.claims ?? {},
         passed: passedNow,
      });
      if (!picked) {
         setDealtKey(null);
         setNote('nothing to deal');
         setTimeout(() => setNote(''), 2500);
         return;
      }
      setDealtKey(pullKey(picked.data));
      claimReview(picked.data);
      // the flash needs the row to actually re-render (see markDealtFlash) —
      // claiming does that on its own a beat later, once the store's debounced
      // publish lands with the new claims map
      markDealtFlash(pullKey(picked.data));
      const id = rowDomId(picked.data);
      requestAnimationFrame(() => {
         document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
   };

   const dealt = dealtKey ? queue.find(p => pullKey(p.data) === dealtKey) : null;

   return (
      <span className="flex items-center gap-2">
         {note && <span className="text-xs text-ink-3">{note}</span>}
         <QuietButton onClick={() => deal(passed)}>Deal me one</QuietButton>
         {dealt && (
            <QuietButton
               onClick={() => {
                  releaseReview(dealt.data);
                  const next = new Set(passed);
                  next.add(dealtKey!);
                  setPassed(next);
                  deal(next);
               }}
            >
               Pass
            </QuietButton>
         )}
      </span>
   );
}

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
   const { selfReview, primaryRepos, starredPeople, codeRegions } = useSettings();
   const starred = new Set(starredPeople);
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
   // Row recomputes its own verb via rowNote, so reordering by stack (and
   // dropping the { p, verb } wrapper) loses nothing the row needs.
   const todoTree = groupIntoTree(todo.map(({ p }) => p));

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
   const aged = regionFirst(
      crPool.filter(p => p.starved).sort((a, b) => b.starveScore - a.starveScore),
      codeRegions
   );
   // your review queue leads with your repos; everything else folds into "other
   // repos" so it's reachable but not in the way. Starvation stays cross-repo
   // (below) — the fairness backstop is deliberately everyone's job.
   const reviewable = crSort(crPool.filter(p => !p.starved));
   // region matches float above even starred authors — a code region is the
   // most explicit "this is my area" signal, so it wins the top of the queue
   const queue = regionFirst(
      starFirst(
         reviewable.filter(p => isPrimaryRepo(p.data.repo)),
         starred
      ),
      codeRegions
   );
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
   const needsQa = regionFirst(
      starFirst(qaSort(qaPool.filter(p => isPrimaryRepo(p.data.repo))), starred),
      codeRegions
   );
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

   // a quiet board (nothing in any primary lane) is exactly when the rest
   // group's folds become the main event — they should greet you open, not
   // as a wall of closed triangles
   const boardIsQuiet =
      !todo.length && !changed.length && !queue.length && !aged.length && !needsQa.length;

   // the rest group itself earns a title only when it has something inside —
   // an empty "rest of the board" with 11 closed folds under it is still noise
   const restTotal =
      queueOther.length +
      needsQaOther.length +
      ready.length +
      stamped.length +
      qaStamped.length +
      devBlocked.length +
      deployHeld.length +
      unmergeable.length +
      ciPending.length +
      ciRed.length +
      drafts.length +
      bots.length +
      closed.length;

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
                  {todoTree.map(({ pull: p, depth }) => (
                     <Row key={pullKey(p.data)} pull={p} opts={opts} depth={depth} />
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
            pulls={queue}
            cap={9}
            opts={opts}
            headerExtra={<DealButton queue={queue} opts={opts} />}
         />
         <Lane
            title="Aging without full review"
            pulls={aged}
            cap={8}
            opts={{ ...opts, aging: true }}
         />
         <Lane
            title="Needs QA"
            sub="CR and QA run in parallel"
            pulls={needsQa}
            cap={6}
            opts={opts}
         />
         {restTotal > 0 && (
            <RestGroup title="The rest of the board">
               <Fold
                  dot={STATUS_DOT.needs_cr}
                  count={queueOther.length}
                  label="to review in other repos"
                  hint="outside your primary repos"
                  id="review:other-repos"
                  defaultOpen={boardIsQuiet}
               >
                  <FoldRows list={queueOther} opts={opts} id="review:other-repos" />
               </Fold>
               <Fold
                  dot={STATUS_DOT.needs_qa}
                  count={needsQaOther.length}
                  label="to QA in other repos"
                  hint="outside your primary repos"
                  id="review:qa-other-repos"
                  defaultOpen={boardIsQuiet}
               >
                  <FoldRows list={needsQaOther} opts={opts} id="review:qa-other-repos" />
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
               <Fold
                  dot={STATUS_DOT.ci_red}
                  count={ciRed.length}
                  label="CI red"
                  id="review:ci-red"
                  defaultOpen={boardIsQuiet}
               >
                  <FoldRows list={ciRed} opts={opts} id="review:ci-red" />
               </Fold>
               <Fold
                  dot={STATUS_DOT.draft}
                  count={drafts.length}
                  label={drafts.length === 1 ? 'draft' : 'drafts'}
               >
                  <FoldRows list={drafts} opts={opts} />
               </Fold>
               {/* deliberately never auto-opened, even on a quiet board — bots stay deprioritized */}
               <Fold
                  dot="var(--ink-3)"
                  count={bots.length}
                  label="bot PRs"
                  hint="security first"
                  id="review:bots"
               >
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
                     id="review:bots"
                  />
               </Fold>
               <Fold
                  dot="var(--ok)"
                  count={closed.length}
                  label="recently shipped"
                  hint="merged or closed in the last 14 days"
                  id="review:shipped"
                  defaultOpen={boardIsQuiet}
               >
                  <Truncated cap={laneShown(30, opts)} id="review:shipped-rows">
                     {closed.map(p => (
                        <ClosedRow key={pullKey(p)} pull={p} lastSeen={opts.lastSeen} />
                     ))}
                  </Truncated>
               </Fold>
            </RestGroup>
         )}
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
