import { useState } from 'react';
import { type DerivedPull, qaDone, type Status, weightRank } from '../model/status';
import { epoch, pullKey } from '../format';
import { crSort, starFirst } from '../model/sort';
import { matchesRegion } from '../model/regions';
import { groupIntoTree } from '../model/stack';
import { authorMove, reviewerMove } from '../model/actions';
import { reviewRequestedFrom } from '../model/reviewers';
import { startHereReason } from '../model/cheers';
import { dealOne } from '../model/deal';
import { useSettings } from '../settings';
import { claimReview, isFresh, usePulldasher } from '../store';
import type { PullData } from '../types';
import {
   AgeStamp,
   Avatar,
   DiffSize,
   EmptyState,
   PullTitleLink,
   QuietButton,
   RepoRef,
   SigPips,
   STATUS_DOT,
   STATUS_LABEL,
   WeightMeter,
} from '../components/bits';
import { Fold, FoldRows, Lane, laneShown, RestGroup, Truncated } from '../components/Lane';
import { onOpen, Popover } from '../components/Popover';
import { RegionHint } from '../components/RegionHint';
import { markDealtFlash, Row, type RowOptions } from '../components/Row';
import { ClosedRow } from '../components/ClosedRow';

/**
 * The dealt pull, shown as a real card inside the Deal-me-one popover: avatar
 * and author, the title as a GitHub link, the same weight / size / age / state
 * metrics a row carries, the CR-QA pips, and one line on why this one came up.
 * Claiming it is a commitment (it also adds you as a GitHub reviewer), so it's
 * an explicit button, not a side effect of dealing.
 */
function DealtCard({
   pull,
   me,
   pulls,
   onClaim,
   onPass,
}: {
   pull: DerivedPull;
   me: string;
   pulls: DerivedPull[];
   onClaim: () => void;
   onPass: () => void;
}) {
   const d = pull.data;
   return (
      <div className="flex flex-col gap-2.5 p-3">
         <div className="flex items-center gap-2">
            <Avatar login={d.user.login} size={18} />
            <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{d.user.login}</span>
            <RepoRef repo={d.repo} number={d.number} />
         </div>
         <div className="text-sm leading-snug break-words">
            <PullTitleLink repo={d.repo} number={d.number} title={d.title} />
         </div>
         <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-3">
            <WeightMeter weight={pull.weight} known={pull.sizeKnown} />
            {pull.sizeKnown && (
               <DiffSize additions={d.additions ?? 0} deletions={d.deletions ?? 0} />
            )}
            <span className="text-ink-2">{STATUS_LABEL[pull.status]}</span>
            <AgeStamp
               ageDays={pull.ageDays}
               createdAt={epoch(d.created_at)}
               updatedAt={epoch(d.updated_at)}
            />
         </div>
         <div className="flex items-center gap-2.5">
            <SigPips
               label="CR"
               have={pull.crHave}
               req={d.status.cr_req}
               by={pull.crBy}
               staleBy={pull.recrBy}
               me={me}
               sigs={d.status.allCR}
            />
            <SigPips
               label="QA"
               have={pull.qaHave}
               req={d.status.qa_req}
               by={pull.qaBy}
               staleBy={pull.reqaBy}
               me={me}
               sigs={d.status.allQA}
            />
         </div>
         <div className="flex items-center gap-1.5 rounded-md bg-brand-50 px-2 py-1 text-[11px] text-brand-700">
            <span aria-hidden>🎯</span>
            <span>{startHereReason(pull, pulls, me)}</span>
         </div>
         <div className="mt-0.5 flex items-center gap-2">
            <QuietButton tone="brand" onClick={onClaim}>
               Claim it
            </QuietButton>
            <QuietButton onClick={onPass}>Pass</QuietButton>
         </div>
      </div>
   );
}

/**
 * "Deal me one": for a reviewer who'd rather be handed the next pull than
 * browse, pick the single best one out of the review queue and show it as a
 * card in a popover anchored to the button. "Claim it" takes it (and adds you
 * as a GitHub reviewer) then immediately deals the next, so a run of triage
 * doesn't mean reopening; "Pass" skips to the next without claiming. Clicking
 * away or Escape ends the session. Opening always deals a fresh pull.
 */
function DealButton({
   queue,
   opts,
   deprioritize,
}: {
   queue: DerivedPull[];
   opts: RowOptions;
   /** bots (etc.) the pick should hand out only once human work is clear */
   deprioritize?: (p: DerivedPull) => boolean;
}) {
   const { pulls } = usePulldasher();
   const me = opts.me;
   const [dealtKey, setDealtKey] = useState<string | null>(null);
   const [passed, setPassed] = useState<ReadonlySet<string>>(new Set());

   const deal = (passedNow: ReadonlySet<string>) => {
      const picked = dealOne(queue, {
         me,
         pulls,
         claims: opts.claims ?? {},
         passed: passedNow,
         deprioritize,
      });
      setDealtKey(picked ? pullKey(picked.data) : null);
   };

   const dealt = dealtKey ? queue.find(p => pullKey(p.data) === dealtKey) : null;

   const claim = () => {
      if (!dealtKey || !dealt) return;
      // flash the row as its claim badge appears (the store publish re-renders
      // it a beat later, which is what paints markDealtFlash's highlight), then
      // deal the next straight away for an uninterrupted run of triage
      markDealtFlash(dealtKey);
      claimReview(dealt.data);
      const next = new Set(passed);
      next.add(dealtKey);
      setPassed(next);
      deal(next);
   };

   const pass = () => {
      if (!dealtKey) return;
      const next = new Set(passed);
      next.add(dealtKey);
      setPassed(next);
      deal(next);
   };

   return (
      <Popover
         label="A pull to review"
         side="right"
         width="w-[320px]"
         panelClass="text-xs"
         trigger={t => (
            <button
               {...t}
               type="button"
               // opening always deals a fresh pull
               onClick={onOpen(t, () => {
                  setPassed(new Set());
                  deal(new Set());
               })}
               className="hit pressable rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-medium text-ink-2 hover:text-brand"
            >
               Deal me one
            </button>
         )}
      >
         {dealt ? (
            <DealtCard pull={dealt} me={me} pulls={pulls} onClaim={claim} onPass={pass} />
         ) : (
            <div className="p-3 text-xs text-ink-3">Nothing left to deal in this queue.</div>
         )}
      </Popover>
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
      'Lift your block',
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
   const aged = crPool.filter(p => p.starved).sort((a, b) => b.starveScore - a.starveScore);
   const reviewable = crSort(crPool.filter(p => !p.starved));

   // Bot PRs (dependency bumps, mostly) are review work too — someone has to
   // move the daily ones along — just low priority. The reviewable ones join
   // the queue tail and the deal, demoted so they're only handed out once human
   // work is clear; the rest (already merge-ready, in CI, or draft) stay folded.
   const bySecurityThenAge = (a: DerivedPull, b: DerivedPull) =>
      Number(b.data.labels.some(l => /security/i.test(l.title))) -
         Number(a.data.labels.some(l => /security/i.test(l.title))) || b.ageDays - a.ageDays;
   const botReviewable = bots
      .filter(
         p =>
            !p.crBy.includes(me) &&
            (p.status === 'needs_cr' || (p.status === 'needs_recr' && !p.recrBy.includes(me)))
      )
      .sort(bySecurityThenAge);
   const botKeys = new Set(botReviewable.map(p => pullKey(p.data)));
   const botRest = bots.filter(p => !botKeys.has(pullKey(p.data))).sort(bySecurityThenAge);
   const isDemoted = (p: DerivedPull) => botKeys.has(pullKey(p.data));

   // your review queue leads with your repos, then the day's bot bumps at the
   // tail; everything else folds into "other repos" so it's reachable but not in
   // the way. Starvation stays cross-repo (the Aging lane) — the fairness
   // backstop is deliberately everyone's job.
   const queueHumans = starFirst(
      reviewable.filter(p => isPrimaryRepo(p.data.repo)),
      starred
   );
   const queue = [...queueHumans, ...botReviewable];
   const queueOther = reviewable.filter(p => !isPrimaryRepo(p.data.repo));

   // Deal me one draws from the whole reviewable pool — your primary repos, the
   // aging cross-repo backstop, and bots — so a triage run doesn't skip the
   // stuff that quietly needs moving. Bots sink to the end of the pick.
   const dealPool = [...queueHumans, ...aged, ...botReviewable];

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
         // stamp you already gave lives in the "QA'd by you" fold. The re-QA
         // exclusion is status-agnostic to match reviewerMove — a re-QA owed
         // on a needs_recr pull is still yours to do, not a generic lane slot
         p.qaingLogin !== me &&
         !p.qaBy.includes(me) &&
         !p.reqaBy.includes(me)
   );
   const qaSort = (list: DerivedPull[]) =>
      [...list].sort(
         (a, b) =>
            Number(!!a.qaingLogin) - Number(!!b.qaingLogin) ||
            (a.sizeKnown ? weightRank(a.weight) : 2.5) -
               (b.sizeKnown ? weightRank(b.weight) : 2.5) ||
            b.ageDays - a.ageDays
      );
   const needsQa = starFirst(qaSort(qaPool.filter(p => isPrimaryRepo(p.data.repo))), starred);
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

   // GitHub asked you directly — the most concrete "review this" on the board,
   // so it leads. Only while it's still your move (unstamped, review-stage).
   const requestedOfYou = crSort(
      others.filter(
         p =>
            (p.status === 'needs_cr' || p.status === 'needs_recr') &&
            reviewRequestedFrom(p, me) &&
            !p.crBy.includes(me)
      )
   );

   // PRs you've claimed — the coordination lane so a claim isn't just a hand
   // icon buried in a lower lane; it's your commitment, surfaced up top.
   const claimed = crSort(pulls.filter(p => opts.claims?.[pullKey(p.data)]?.login === me));

   // In your code regions: reviewable pulls (CR or QA pool) matching a region
   // you set in Settings, deduped across the two pools and pulled out of the
   // queue/QA lanes below into their own section — the most explicit "this is
   // my area" signal earns its own spot instead of a float within the queue.
   const regionSeen = new Set<string>();
   const regionMatches = crSort(
      [...crPool, ...qaPool].filter(p => {
         const k = pullKey(p.data);
         if (regionSeen.has(k) || !matchesRegion(p, codeRegions)) return false;
         regionSeen.add(k);
         return true;
      })
   );

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
      botRest.length +
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
         {codeRegions.length === 0 && <RegionHint />}
         {todo.length > 0 && (
            <Lane title="Yours to do" pulls={[]} count={todo.length} opts={opts}>
               <Truncated cap={laneShown(10, opts)} id="lane:Yours to do">
                  {todoTree.map(({ pull: p, depth }) => (
                     <Row key={pullKey(p.data)} pull={p} opts={opts} depth={depth} />
                  ))}
               </Truncated>
            </Lane>
         )}
         {requestedOfYou.length > 0 && (
            <Lane
               title="Requested of you"
               sub="GitHub asked you to review these"
               pulls={requestedOfYou}
               cap={8}
               opts={opts}
            />
         )}
         {claimed.length > 0 && (
            <Lane
               title="You're reviewing"
               sub="you claimed these — finish them or release"
               pulls={claimed}
               cap={6}
               opts={opts}
            />
         )}
         <Lane
            title="Changed since your last look"
            sub="new or updated while you were away"
            pulls={changed}
            cap={8}
            opts={opts}
         />
         {codeRegions.length > 0 && regionMatches.length > 0 && (
            <Lane
               title="In your code regions"
               sub="areas you flagged in Settings"
               pulls={regionMatches}
               cap={8}
               opts={opts}
            />
         )}
         <Lane
            title="Aging without full review"
            pulls={aged}
            cap={8}
            opts={{ ...opts, aging: true }}
         />
         <Lane
            title="Review queue"
            pulls={queue}
            cap={9}
            opts={opts}
            headerExtra={<DealButton queue={dealPool} opts={opts} deprioritize={isDemoted} />}
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
                  id="review:ready"
               >
                  <FoldRows list={ready} opts={opts} id="review:ready" />
               </Fold>
               <Fold
                  dot="var(--ok)"
                  count={stamped.length}
                  label="stamped by you"
                  hint="waiting on another reviewer"
                  id="review:stamped"
               >
                  <FoldRows list={stamped} opts={opts} id="review:stamped" />
               </Fold>
               <Fold
                  dot="var(--ok)"
                  count={qaStamped.length}
                  label="QA’d by you"
                  hint="waiting on another tester"
                  id="review:qa-stamped"
               >
                  <FoldRows list={qaStamped} opts={opts} id="review:qa-stamped" />
               </Fold>
               <Fold
                  dot={STATUS_DOT.dev_block}
                  count={devBlocked.length}
                  label="dev blocked"
                  id="review:dev-blocked"
               >
                  <FoldRows list={devBlocked} opts={opts} id="review:dev-blocked" />
               </Fold>
               <Fold
                  dot={STATUS_DOT.deploy_block}
                  count={deployHeld.length}
                  label="deploy blocked"
                  hint="each row names who blocked it"
                  id="review:deploy-blocked"
               >
                  <FoldRows list={deployHeld} opts={opts} id="review:deploy-blocked" />
               </Fold>
               <Fold
                  dot={STATUS_DOT.unmergeable}
                  count={unmergeable.length}
                  label="can’t merge"
                  hint="the author rebases"
                  id="review:unmergeable"
               >
                  <FoldRows list={unmergeable} opts={opts} id="review:unmergeable" />
               </Fold>
               <Fold
                  dot={STATUS_DOT.ci_pending}
                  count={ciPending.length}
                  label={STATUS_LABEL.ci_pending.toLowerCase()}
                  hint="waiting on green"
                  id="review:ci-pending"
               >
                  <FoldRows list={ciPending} opts={opts} id="review:ci-pending" />
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
                  id="review:drafts"
               >
                  <FoldRows list={drafts} opts={opts} id="review:drafts" />
               </Fold>
               {/* the reviewable bots moved up into the queue and the deal;
                   what's left here isn't up for review (merge-ready, in CI, or
                   draft), so it stays folded and never auto-opens */}
               <Fold
                  dot="var(--ink-3)"
                  count={botRest.length}
                  label="other bot PRs"
                  hint="not up for review"
                  id="review:bots"
               >
                  <FoldRows list={botRest} opts={opts} id="review:bots" />
               </Fold>
               <Fold
                  dot="var(--ok)"
                  count={closed.length}
                  label="recently closed"
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
   const doNow = ['Merge it', 'Fix CI', 'Address feedback', 'Lift your block', 'Rebase'];
   if (selfReview) doNow.push('Find a QA-er');
   return doNow.includes(verb) ? verb : null;
}
