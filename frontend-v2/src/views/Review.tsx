import type { DerivedPull } from '../../../shared/model/status';
import { ago, pullKey, shortRepo } from '../../../shared/format';
import { useNames } from '../model/names';
import { matchedRegions } from '../model/regions';
import { buildReviewLanes } from '../model/reviewLanes';
import { useSettings } from '../settings';
import { clearSnoozes, isFresh, isSnoozed, markAllSeen, usePulldasher } from '../store';
import type { PullData } from '../../../shared/types';
import { EmptyState, QuietButton } from '../components/bits';
import { Fold, FoldRows, Lane, laneShown, RestGroup, SubDoor, Truncated } from '../components/Lane';
import { RegionHint } from '../components/RegionHint';
import type { RowOptions } from '../components/Row';
import { eyebrowText, WordGroupRows } from '../components/WordGroups';
import { ClosedRow } from '../components/ClosedRow';

/**
 * The home tab. It opens with Ready to merge — the fastest board-clearing
 * wins, done work anyone can land — then the one lane the whole app used to
 * lack: every action that is yours (re-stamps you owe, your own merge buttons,
 * your CI fixes), regardless of who authored the pull. The daily loop must not
 * require flipping between Review and My work. Below that, other people's work
 * to pick from.
 *
 * The lane/pool math (queues, QA, "waiting on you", region matches, ...) is
 * model/reviewLanes.ts's buildReviewLanes — this component's job is only to
 * filter out snoozed pulls (a store concern) and render the result.
 */
export function Review({
   pulls: allPulls,
   bots: allBots,
   closed,
   opts,
}: {
   pulls: DerivedPull[];
   bots: DerivedPull[];
   closed: PullData[];
   opts: RowOptions;
}) {
   const me = opts.me;
   const { selfReview, teams, codeRegions, repoPriority, repoQueueCap } = useSettings();
   // login -> human display name (app.tsx prefetches the board), for the
   // rank-reason popover's why-lines (model/reviewLanes.ts's whyUpNext/whyQaNext)
   const names = useNames();
   // A snooze is "not today" for THIS lens only: the daily what-do-I-review
   // loop lives here, so the quieting gesture belongs here — every other
   // lens still shows the pull. Snoozed rows collect in their own section at
   // the bottom of the board instead of vanishing into Settings.
   const { snoozed } = usePulldasher();
   const napping = [...allPulls, ...allBots].filter(p => isSnoozed(p.data, snoozed));
   const pulls = allPulls.filter(p => !isSnoozed(p.data, snoozed));
   const bots = allBots.filter(p => !isSnoozed(p.data, snoozed));

   // Recently updated: everything that moved since the user last hit Clear,
   // newest first. A pull can also live in a lane below; this is the "what
   // happened" glance, not an exclusive bucket — and only the Clear button
   // empties it (nothing leaves the list silently).
   const changed = pulls
      .filter(p => isFresh(p.data, opts.lastSeen))
      // others' drafts stay out of the "what changed" glance: a draft you
      // don't own isn't yours to act on, and draftsMode already keeps them off
      // the board — they only reach this pool through boardHidden's
      // review-requested exception (app.tsx). Your own drafts stay; they're
      // your work.
      .filter(p => !p.data.draft || p.data.user.login === me)
      .sort((a, b) => Date.parse(b.data.updated_at) - Date.parse(a.data.updated_at));

   const lanes = buildReviewLanes({
      pulls,
      bots,
      closed,
      napping,
      changed,
      me,
      selfReview,
      teams,
      codeRegions,
      repoPriority,
      ageWarnDays: opts.ageWarnDays,
      names,
   });
   const queueOpts = { ...opts, rankReason: lanes.whyUpNext };

   // bots/shipped stay reachable even when no human PRs need review
   if (lanes.empty) {
      return (
         <EmptyState
            title="All clear"
            sub="Nothing to review with these filters. Clear some to see more."
         />
      );
   }

   return (
      <>
         {codeRegions.length === 0 && <RegionHint />}
         {/* Leads the whole lens (owner call): fully finished work — signed
             off, green, one press from shipped — is the fastest, highest-
             leverage thing on the board, so clearing it comes before even your
             own owed work below. Your OWN ready PR still also appears in
             "Waiting on you" as a Merge-it; this lane is everyone else's done
             work, landable by anyone. */}
         <Lane
            title="Ready to merge"
            sub={
               <SubDoor
                  label="Why Ready to merge leads"
                  text="signed off and green, someone just has to press merge"
               >
                  <p>
                     Everything is done on these: code review and QA are in, CI is green, and they
                     merge cleanly. The author usually lands their own PR, but anyone can. Merge it,
                     or nudge the author if it’s been sitting.
                  </p>
                  <p>
                     Bot PRs land here too once they’re fully green: they only ship when a human
                     merges them. Longest-waiting first.
                  </p>
               </SubDoor>
            }
            pulls={lanes.ready}
            cap={6}
            opts={opts}
         />
         {lanes.yourMove.length > 0 && (
            <Lane
               title="Waiting on you"
               sub={
                  <SubDoor
                     label="What lands in Waiting on you"
                     text="every PR whose next step is yours, most urgent first"
                  >
                     <p className="font-medium text-ink">
                        If it’s in this lane, nothing happens until you act:
                     </p>
                     <p>
                        PRs you approved that changed after your approval (they need a fresh
                        re-stamp from you), feedback that needs your reply, your own PRs ready to
                        merge, fix, or rebase, PRs someone asked you to review, and reviews you
                        claimed.
                     </p>
                     <p>
                        Each group is named for the action you’d take (Re-stamp, Respond, Merge…).
                        The kinds of action that unblock other people come first; inside a group,
                        the PR that has been open the longest comes first.
                     </p>
                  </SubDoor>
               }
               pulls={[]}
               count={lanes.yourMove.length}
               opts={opts}
            >
               <WordGroupRows
                  pulls={lanes.yourMove}
                  opts={opts}
                  id="lane:Waiting on you"
                  cap={laneShown(12, opts)}
               />
            </Lane>
         )}
         {lanes.yoursWaiting.length > 0 && (
            <Lane
               title="Waiting on others"
               sub={
                  <SubDoor
                     label="What lands in Waiting on others"
                     text="your PRs and stamps, in someone else's hands"
                  >
                     <p className="font-medium text-ink">Nothing here needs you right now:</p>
                     <p>
                        your own PRs waiting on a review, QA, or CI, plus PRs you’ve already stamped
                        that are still waiting on another reviewer.
                     </p>
                     <p>
                        Each group is named for what the PR is waiting on (a review, a tester, CI, a
                        re-stamp), so you can see where everything of yours is stuck.
                     </p>
                  </SubDoor>
               }
               pulls={[]}
               count={lanes.yoursWaiting.length}
               opts={opts}
            >
               <WordGroupRows
                  pulls={lanes.yoursWaiting}
                  opts={opts}
                  id="lane:Waiting on others"
                  cap={laneShown(8, opts)}
               />
            </Lane>
         )}
         <Lane
            title="Recently updated"
            sub={`new or updated in the last ${ago(opts.lastSeen)}`}
            pulls={lanes.changed}
            cap={8}
            opts={opts}
            // the ONE control that moves the baseline — at the point of its
            // effect, not buried in Settings; nothing advances it silently
            headerExtra={
               <QuietButton size="sm" onClick={() => markAllSeen()}>
                  Clear
               </QuietButton>
            }
         />
         {/* below here is offered work, not owed work — the board's suggestion
             for what to pick up next, as distinct from "Waiting on you" above. The
             label only earns its place when something is actually on offer. */}
         {(lanes.queue.length > 0 ||
            lanes.needsQa.length > 0 ||
            lanes.regionMatches.length > 0) && (
            <div className={`mb-2 text-ink-3 ${eyebrowText}`}>Pick up next</div>
         )}
         {codeRegions.length > 0 && lanes.regionMatches.length > 0 && (
            <Lane
               title="In your code regions"
               sub={
                  <SubDoor label="How code regions match" text="areas you flagged in Settings">
                     <p>
                        A PR lands here when its title, description, labels, branch, or repo
                        contains one of your regions. Plain text, case-insensitive, no regex.
                     </p>
                  </SubDoor>
               }
               pulls={lanes.regionMatches}
               cap={8}
               opts={{
                  ...opts,
                  // the lane heading already says "this is your region," so
                  // the row-level region mark would just repeat it
                  hideRegionMark: true,
                  rankReason: p => {
                     const r = matchedRegions(p, codeRegions);
                     return r.length
                        ? `It touches ${r.join(', ')}, a code region you flagged`
                        : null;
                  },
               }}
            />
         )}
         {repoPriority.length > 0 ? (
            // the owner's priority-and-cap model: contiguous per-repo blocks in
            // the Settings repo order, each block score-ranked inside and
            // flood-bounded by the per-repo cap. Starving PRs pierce the
            // partition — the fairness backstop can't sit below a repo the
            // viewer ranked last, or "surface the other repos" becomes a lie.
            <Lane
               title="Review queue"
               sub={
                  <SubDoor
                     label="How the queue is ranked"
                     text="your repos in your order, best first"
                  >
                     <p className="font-medium text-ink">
                        Repos appear as blocks in your repo order (Settings), each showing its best
                        few:
                     </p>
                     <p>
                        PRs that have waited {opts.ageWarnDays ?? 4}+ days for review outrank the
                        blocks entirely — they lead the lane whatever repo they’re from.
                     </p>
                     <p>
                        Inside a block: your team’s PRs first, then repos you’ve reviewed before,
                        people who review your work, and small quick wins, lightest first. Bot PRs
                        sink to each block’s bottom. The per-repo cap folds the rest behind “+N
                        more” so one busy repo can’t take the whole screen.
                     </p>
                     <p>PRs you claim stay in the queue and also appear in Waiting on you.</p>
                  </SubDoor>
               }
               pulls={[]}
               count={lanes.queue.length}
               opts={queueOpts}
            >
               <Fold
                  count={lanes.queueStarved.length}
                  label="Starving"
                  tone="do"
                  gloss={`Waited ${opts.ageWarnDays ?? 4}+ days for review — these outrank your repo order.`}
                  id="review:queue:starving"
                  defaultOpen
               >
                  <FoldRows list={lanes.queueStarved} opts={queueOpts} id="review:queue:starving" />
               </Fold>
               {lanes.queueBlocks.map(b => (
                  <Fold
                     key={b.repo}
                     count={b.pulls.length}
                     label={shortRepo(b.repo)}
                     gloss={`${shortRepo(b.repo)}’s reviewable PRs, best first — your repo order (Settings) decides where the block sits.`}
                     id={`review:queue:${b.repo}`}
                     defaultOpen
                  >
                     <FoldRows
                        list={b.pulls}
                        opts={queueOpts}
                        id={`review:queue:${b.repo}`}
                        cap={repoQueueCap || Number.POSITIVE_INFINITY}
                        label={`more from ${shortRepo(b.repo)}`}
                     />
                  </Fold>
               ))}
            </Lane>
         ) : (
            <Lane
               title="Review queue"
               sub={
                  <SubDoor label="How the queue is ranked" text="one queue, best next review first">
                     <p className="font-medium text-ink">One score ranks every card:</p>
                     <p>
                        PRs that have waited {opts.ageWarnDays ?? 4}+ days for review jump to the
                        top, oldest and biggest first, even from repos you don’t usually review.
                     </p>
                     <p>
                        Your team’s PRs always come first (edit your team on the Team tab), ordered
                        among themselves by this same score — being on your team is the boost; there
                        is no extra ranking between teammates.
                     </p>
                     <p>
                        After those: PRs in repos you’ve reviewed before, PRs from people who review
                        your work, and small quick wins, lightest first. Bot PRs (dependency bumps)
                        sink to the bottom.
                     </p>
                     <p>PRs you claim stay in the queue and also appear in Waiting on you.</p>
                  </SubDoor>
               }
               pulls={lanes.queue}
               cap={12}
               opts={queueOpts}
            />
         )}
         <Lane
            title="Needs QA"
            sub={
               <SubDoor
                  label="How Needs QA is ordered"
                  text="nobody-testing-it first, lightest first, oldest first"
               >
                  <p>
                     QA runs in parallel with CR, so a pull can sit here and in the review queue at
                     once.
                  </p>
                  <p>
                     Anything QA-incomplete with green CI lands here, unless it’s a draft, blocked,
                     or conflicted. PRs nobody is testing yet lead; within that, lighter tests
                     first, then oldest.
                  </p>
               </SubDoor>
            }
            pulls={lanes.needsQa}
            cap={6}
            opts={{ ...opts, rankReason: lanes.whyQaNext }}
         />
         {(lanes.restTotal > 0 || lanes.napping.length > 0) && (
            <RestGroup title="The rest of the board">
               <Fold
                  count={lanes.queueOther.length}
                  label="Review, other repos"
                  gloss="Reviewable, just outside your primary repos. The queue above sticks to the repos you actually review."
                  id="review:other-repos"
                  defaultOpen={lanes.boardIsQuiet}
               >
                  <FoldRows list={lanes.queueOther} opts={opts} id="review:other-repos" />
               </Fold>
               <Fold
                  count={lanes.needsQaOther.length}
                  label="QA, other repos"
                  gloss="Needs a tester, just outside your primary repos."
                  id="review:qa-other-repos"
                  defaultOpen={lanes.boardIsQuiet}
               >
                  <FoldRows list={lanes.needsQaOther} opts={opts} id="review:qa-other-repos" />
               </Fold>
               <Fold
                  count={lanes.devBlocked.length}
                  label="Blocked"
                  gloss="Someone left a dev block; the author owes changes first. Nothing to review yet."
                  id="review:dev-blocked"
               >
                  <FoldRows list={lanes.devBlocked} opts={opts} id="review:dev-blocked" />
               </Fold>
               <Fold
                  count={lanes.deployHeld.length}
                  label="Deploy hold"
                  gloss="Done, but deliberately not shipped yet. Each row names who holds it."
                  id="review:deploy-blocked"
               >
                  <FoldRows list={lanes.deployHeld} opts={opts} id="review:deploy-blocked" />
               </Fold>
               <Fold
                  count={lanes.unmergeable.length}
                  label="Conflicts"
                  gloss="These have merge conflicts with their base branch, so GitHub can’t merge them until the author rebases."
                  id="review:unmergeable"
               >
                  <FoldRows list={lanes.unmergeable} opts={opts} id="review:unmergeable" />
               </Fold>
               <Fold
                  count={lanes.ciPending.length}
                  label="CI running"
                  gloss="Fully signed off — CI is still running on the latest push, and it's ready the moment checks go green."
                  id="review:ci-pending"
               >
                  <FoldRows list={lanes.ciPending} opts={opts} id="review:ci-pending" />
               </Fold>
               <Fold
                  count={lanes.ciRed.length}
                  label="CI failing"
                  gloss="Fully signed off, but a required CI check is failing — the author fixes the build, then it's ready. (A red build still awaiting review stays in the queue; reviewing it is your call.)"
                  id="review:ci-red"
                  defaultOpen={lanes.boardIsQuiet}
               >
                  <FoldRows list={lanes.ciRed} opts={opts} id="review:ci-red" />
               </Fold>
               <Fold
                  count={lanes.drafts.length}
                  label={lanes.drafts.length === 1 ? 'Draft' : 'Drafts'}
                  gloss="Not up for review yet."
                  id="review:drafts"
               >
                  <FoldRows list={lanes.drafts} opts={opts} id="review:drafts" />
               </Fold>
               {/* the reviewable bots moved up into the queue and the deal;
                   what's left here isn't up for review (merge-ready, in CI, or
                   draft), so it stays folded and never auto-opens */}
               <Fold
                  count={lanes.botRest.length}
                  label="Bot PRs"
                  gloss="Dependency bumps that aren’t up for review — merge-ready, in CI, or draft. Reviewable bot PRs join the queue above."
                  id="review:bots"
               >
                  <FoldRows list={lanes.botRest} opts={opts} id="review:bots" />
               </Fold>
               <Fold
                  count={closed.length}
                  label="Recently closed"
                  gloss="Merged or closed in the last 14 days."
                  id="review:shipped"
                  defaultOpen={lanes.boardIsQuiet}
               >
                  <Truncated cap={laneShown(30, opts)} id="review:shipped-rows">
                     {closed.map(p => (
                        <ClosedRow key={pullKey(p)} pull={p} lastSeen={opts.lastSeen} />
                     ))}
                  </Truncated>
               </Fold>
               {/* your snoozes, visibly parked at the board's bottom instead
                   of vanishing into Settings — hiding is trustworthy when you
                   can always see what's hidden. Review-lens only: a snooze
                   quiets this lens's daily loop, nothing else. */}
               <Fold
                  count={lanes.napping.length}
                  label="Snoozed by you"
                  gloss="Hidden from this lens only, until tomorrow or until they change. Every other lens still shows them."
                  id="review:snoozed"
               >
                  <div className="flex items-center justify-between gap-2 border-t border-secondary px-3.5 py-1.5 first:border-t-0">
                     <span className="text-xs text-ink-3">
                        Hidden from this lens only; every other lens still shows them.
                     </span>
                     <QuietButton size="sm" onClick={() => clearSnoozes()}>
                        Wake all
                     </QuietButton>
                  </div>
                  <FoldRows list={lanes.napping} opts={opts} id="review:snoozed" />
               </Fold>
            </RestGroup>
         )}
      </>
   );
}
