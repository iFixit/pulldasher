import type { DerivedPull } from '../../../shared/model/status';
import { pullKey, shortRepo } from '../../../shared/format';
import { reviewIsMine } from '../model/actions';
import { useNames } from '../model/names';
import { matchedRegions } from '../model/regions';
import { buildReviewLanes } from '../model/reviewLanes';
import type { PullStanding } from '../model/standing';
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
   botsForReady: allBotsForReady,
   closed,
   opts,
   standing,
}: {
   pulls: DerivedPull[];
   bots: DerivedPull[];
   /** the hideBots-bypassing bot pool (app.tsx) that keeps Ready-to-merge
    * showing merge-ready bot PRs even when `bots` has been emptied by
    * "Ignore bot PRs" — see model/reviewLanes.ts's botsForReady. */
   botsForReady: DerivedPull[];
   closed: PullData[];
   opts: RowOptions;
   /** how each PR's project stands (model/standing.ts), so a parked
    * project's PRs sink and a plan's last ones win ties */
   standing?: PullStanding;
}) {
   const me = opts.me;
   const { teams, codeRegions, repoPriority, repoQueueCap } = useSettings();
   // login -> human display name (app.tsx prefetches the board), for the
   // rank-reason popover's why-lines (model/reviewLanes.ts's whyUpNext/whyQaNext)
   const names = useNames();
   // A snooze is "not today" for THIS lens only: the daily what-do-I-review
   // loop lives here, so the quieting gesture belongs here — every other
   // lens still shows the pull. Snoozed rows collect in their own section at
   // the bottom of the board instead of vanishing into Settings.
   const { snoozed, projectLabelPrefix } = usePulldasher();
   // allBotsForReady can hold a bot allBots no longer does ("Ignore bot PRs"
   // pulled it out of the human-review surfaces) — folded in here too, deduped
   // by key, so snoozing a bot straight off the Ready-to-merge lane still
   // parks it in "Snoozed by you" instead of making it vanish with no undo.
   const nappingKeys = new Set<string>();
   const napping = [...allPulls, ...allBots, ...allBotsForReady].filter(p => {
      if (!isSnoozed(p.data, snoozed)) return false;
      const k = pullKey(p.data);
      if (nappingKeys.has(k)) return false;
      nappingKeys.add(k);
      return true;
   });
   const pulls = allPulls.filter(p => !isSnoozed(p.data, snoozed));
   const bots = allBots.filter(p => !isSnoozed(p.data, snoozed));
   const botsForReady = allBotsForReady.filter(p => !isSnoozed(p.data, snoozed));

   // Recently updated: your PRs and your review work that moved recently,
   // newest first. Bounded two ways so a quiet board stops resurfacing stale
   // bumps — since you last hit Clear (isFresh) AND within the last
   // RECENT_MAX_AGE_DAYS. Someone else's PR is here only while its review is
   // yours (reviewIsMine: asked of you, taken on, or nobody's on it), so
   // other people's self-reviews don't stream past; one you hold a live CR
   // stamp on is finished for you, and drafts or dev-blocked PRs aren't
   // yours to act on. A pull can still live in a lane below; this is a
   // highlight, not an exclusive bucket, and only Clear empties it.
   const RECENT_MAX_AGE_DAYS = 3;
   const recentCutoff = Date.now() - RECENT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
   const changed = pulls
      .filter(p => isFresh(p.data, opts.lastSeen))
      .filter(p => Date.parse(p.data.updated_at) > recentCutoff)
      .filter(
         p =>
            p.data.user.login === me ||
            (reviewIsMine(p, me) &&
               !p.data.draft &&
               p.status !== 'dev_block' &&
               !p.crBy.includes(me))
      )
      .sort((a, b) => Date.parse(b.data.updated_at) - Date.parse(a.data.updated_at));

   const lanes = buildReviewLanes({
      pulls,
      bots,
      botsForReady,
      closed,
      napping,
      changed,
      me,
      teams,
      codeRegions,
      repoPriority,
      ageWarnDays: opts.ageWarnDays,
      names,
      standing,
   });
   const queueOpts = { ...opts, rankReason: lanes.whyUpNext };
   // lanes ranked by age or by the word you owe say only what a PR's project
   // did to its place
   const projectOpts = { ...opts, rankReason: (p: DerivedPull) => lanes.whyProject(p, null) };
   // what a project does to a lane's order, said in each lane's explanation
   // on a board that has projects
   const projectRule = (sink: string, tie: string) =>
      projectLabelPrefix && (
         <p>
            {sink}. {tie}, the one that helps finish a plan in progress goes first.
         </p>
      );

   // bots/shipped stay reachable even when no human PRs need review
   if (lanes.empty) {
      return (
         <EmptyState
            variant="search"
            title="Nothing here"
            sub="Nothing to review with these filters. Clear some to see more."
         />
      );
   }

   return (
      <>
         {codeRegions.length === 0 && <RegionHint />}
         {/* Leads the whole lens (owner call): fully finished work, one press
             from shipped. Under the self-review policy you merge your own, so
             this is your ready PRs, plus another person's only when you were
             asked to review it or said you would. Not repeated in "Waiting
             on you". */}
         <Lane
            title="Ready to merge"
            sub={
               <SubDoor
                  label="Why Ready to merge leads"
                  text="your PRs that are signed off and green: merge them"
               >
                  <p>
                     Everything is done on these: code review and QA are in, CI is green, and they
                     merge cleanly. Merge your own. A PR of someone else’s shows up only if you were
                     asked to review it or said you would, so you can see it’s about to ship.
                  </p>
                  <p>Longest-waiting first.</p>
                  {projectRule(
                     'A parked project’s PRs sink to the bottom',
                     'Between two that have waited the same days'
                  )}
               </SubDoor>
            }
            pulls={lanes.ready}
            cap={6}
            opts={projectOpts}
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
                        PRs someone asked you to review, first: answer those within hours. Then
                        stamps of yours that a push undid, reviews you said you’d do, feedback that
                        needs your reply, and your own PRs to stamp, fix, or rebase. Your signed-off
                        PRs to merge lead the tab.
                     </p>
                     <p>
                        Each group is named for the action you’d take (Review, Re-stamp, Rebase…).
                        Review requests run oldest request first; inside every other group, the PR
                        that has been open the longest comes first.
                     </p>
                     {projectRule(
                        'A parked project’s PRs sink to the bottom of their group',
                        'Between two open the same days'
                     )}
                  </SubDoor>
               }
               pulls={[]}
               count={lanes.yourMove.length}
               opts={opts}
            >
               <WordGroupRows
                  pulls={lanes.yourMove}
                  opts={projectOpts}
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
                     text="your PRs, in someone else's hands"
                  >
                     <p className="font-medium text-ink">Nothing here needs you right now:</p>
                     <p>
                        your own PRs waiting on people you asked for a review, on CI, or on a hold.
                        A request nobody answers in 4 hours moves up to Waiting on you as a nudge.
                     </p>
                     <p>
                        Each group is named for what the PR is waiting on, so you can see where
                        everything of yours is stuck.
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
            sub={
               <SubDoor
                  label="What lands in Recently updated"
                  text={`your PRs and reviews that changed in the last ${RECENT_MAX_AGE_DAYS} days`}
               >
                  <p>
                     A PR shows up here when it changed since you last hit Clear, and that change
                     was in the last {RECENT_MAX_AGE_DAYS} days. Newest first.
                  </p>
                  <p>
                     Your own PRs always stay. Someone else’s shows up only while its review is
                     yours: asked of you, one you said you’d review, or one from outside the dev
                     team. It drops out once you’ve code reviewed it.
                  </p>
                  <p>
                     The review queue below is a different list: it ranks the reviews that are
                     yours, whether or not anything changed.
                  </p>
               </SubDoor>
            }
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
         {(lanes.queue.length > 0 || lanes.needsQa.length > 0) && (
            <div className={`mb-2 text-ink-3 ${eyebrowText}`}>Pick up next</div>
         )}
         {repoPriority.length > 0 ? (
            // the owner's priority-and-cap model: contiguous per-repo blocks in
            // the Settings repo order, each block score-ranked inside and
            // flood-bounded by the per-repo cap. Requests of you lead each
            // block's incoming order, so the oldest request is still first.
            <Lane
               title="Review queue"
               sub={
                  <SubDoor
                     label="How the queue is ranked"
                     text="reviews that are yours, your repos in your order"
                  >
                     <p>
                        Developers review their own PRs unless they ask, so this holds only reviews
                        that are yours: asked of you, ones you said you’d do, and PRs from outside
                        the dev team that nobody’s on yet.
                     </p>
                     <p className="font-medium text-ink">
                        Repos appear as blocks in your repo order (Settings), each showing its best
                        few:
                     </p>
                     <p>
                        Inside a block: reviews asked of you first, oldest request first, then your
                        team’s PRs, repos you’ve reviewed before and small quick wins, lightest
                        first. Bot PRs sink to each block’s bottom. The per-repo cap folds the rest
                        behind “+N more” so one busy repo can’t take the whole screen.
                     </p>
                     {projectRule(
                        'A parked project’s PRs sink below everyone else’s, above the bot PRs',
                        'When two PRs rank the same with age in whole days'
                     )}
                     <p>
                        PRs you said you’d review stay in the queue and also appear in Waiting on
                        you.
                     </p>
                  </SubDoor>
               }
               pulls={[]}
               count={lanes.queue.length}
               opts={queueOpts}
            >
               {lanes.queueBlocks.map(b => (
                  <Fold
                     key={b.repo}
                     count={b.pulls.length}
                     label={shortRepo(b.repo)}
                     gloss={`${shortRepo(
                        b.repo
                     )}’s reviewable PRs, best first; your repo order (Settings) decides where the block sits.`}
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
                  <SubDoor
                     label="How the queue is ranked"
                     text="reviews that are yours, best first"
                  >
                     <p>
                        Developers review their own PRs unless they ask, so this holds only reviews
                        that are yours: asked of you, ones you said you’d do, and PRs from outside
                        the dev team that nobody’s on yet.
                     </p>
                     <p className="font-medium text-ink">Then one score ranks the rest:</p>
                     <p>
                        Reviews asked of you come first, oldest request first, whatever repo they’re
                        from: answer those within hours.
                     </p>
                     <p>
                        Your team’s PRs always come first (edit your team on the Team tab), ordered
                        among themselves by this same score: being on your team is the boost; there
                        is no extra ranking between teammates.
                     </p>
                     <p>
                        After those: PRs in repos you’ve reviewed before and small quick wins,
                        lightest first. Bot PRs (dependency bumps) sink to the bottom.
                     </p>
                     {projectRule(
                        'A parked project’s PRs sink below everyone else’s, above the bot PRs',
                        'When two PRs rank the same with age in whole days'
                     )}
                     <p>
                        PRs you said you’d review stay in the queue and also appear in Waiting on
                        you.
                     </p>
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
                     once. Developers test their own PRs, even when they ask for a review, so this
                     holds only PRs from outside the dev team and bots that need a tester, plus ones
                     you said you’d review.
                  </p>
                  <p>
                     Anything QA-incomplete with green CI lands here, unless it’s a draft, blocked,
                     or conflicted. PRs nobody is testing yet lead; within that, lighter tests
                     first, then oldest.
                  </p>
                  {projectRule(
                     'A parked project’s PRs sink to the bottom',
                     'When two tie, counting age in whole days'
                  )}
               </SubDoor>
            }
            pulls={lanes.needsQa}
            cap={6}
            opts={{ ...opts, rankReason: lanes.whyQaNext }}
         />
         {/* an offer, not a debt: folded, uncounted, and outside the deal */}
         {lanes.couldUseInput.length > 0 && (
            <RestGroup
               title="Could use your input"
               sub="Nobody owes these a review, but they touch your areas. Add yourself as a reviewer if you jump in."
            >
               <Fold
                  count={lanes.couldUseInput.length}
                  showCount={false}
                  label="Self-reviews in your areas"
                  gloss="Their authors review these themselves, or asked a team with nobody on the roster. Your code regions first, then repos you’ve reviewed in."
                  id="review:could-use-input"
               >
                  <FoldRows
                     list={lanes.couldUseInput}
                     opts={{
                        ...opts,
                        rankReason: p => {
                           const r = matchedRegions(p, codeRegions);
                           return lanes.whyProject(
                              p,
                              r.length
                                 ? `It touches ${r.join(', ')}, a code region you flagged`
                                 : `In ${shortRepo(p.data.repo)}, where you’ve reviewed before`
                           );
                        },
                     }}
                     id="review:could-use-input"
                  />
               </Fold>
            </RestGroup>
         )}
         {(lanes.restTotal > 0 || lanes.napping.length > 0) && (
            <RestGroup title="The rest of the board">
               <Fold
                  count={lanes.queueOther.length}
                  label="Review, other repos"
                  gloss="Reviews that are yours, just outside your primary repos. The queue above sticks to the repos you actually review."
                  id="review:other-repos"
                  defaultOpen={lanes.boardIsQuiet}
               >
                  <FoldRows list={lanes.queueOther} opts={opts} id="review:other-repos" />
               </Fold>
               <Fold
                  count={lanes.needsQaOther.length}
                  label="QA, other repos"
                  gloss="QA that’s yours, just outside your primary repos."
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
                  gloss="Fully signed off; CI is still running on the latest push, and it's ready the moment checks go green."
                  id="review:ci-pending"
               >
                  <FoldRows list={lanes.ciPending} opts={opts} id="review:ci-pending" />
               </Fold>
               <Fold
                  count={lanes.ciRed.length}
                  label="CI failing"
                  gloss="Fully signed off, but a required CI check is failing; the author fixes the build, then it's ready."
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
                  gloss="Dependency bumps that aren’t up for review: merge-ready, in CI, or draft. Reviewable bot PRs join the queue above."
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
                  gloss="Hidden from this tab only, until tomorrow or until they change. Every other tab still shows them."
                  id="review:snoozed"
               >
                  <div className="flex items-center justify-between gap-2 border-t border-secondary px-3.5 py-1.5 first:border-t-0">
                     <span className="text-xs text-ink-3">
                        Hidden from this tab only; every other tab still shows them.
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
