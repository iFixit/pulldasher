import { type DerivedPull, qaDone, type Status, weightRank } from '../model/status';
import { pullKey } from '../format';
import { crSort, starFirst } from '../model/sort';
import { matchedRegions, matchesRegion } from '../model/regions';
import {
   authorMove,
   DO_WORD_RANK,
   reviewerMove,
   rowNote,
   rowWord,
   WAIT_WORD_RANK,
} from '../model/actions';
import { reviewRequestedFrom } from '../model/reviewers';
import { startHereReason } from '../model/cheers';
import { dealRank } from '../model/deal';
import { useSettings } from '../settings';
import { claimFor, clearSnoozes, isFresh, isSnoozed, usePulldasher } from '../store';
import type { PullData } from '../types';
import { EmptyState, QuietButton, STATUS_DOT, STATUS_LABEL } from '../components/bits';
import { Fold, FoldRows, Lane, laneShown, RestGroup, SubDoor, Truncated } from '../components/Lane';
import { RegionHint } from '../components/RegionHint';
import type { RowOptions } from '../components/Row';
import { eyebrowText, WordGroupRows } from '../components/WordGroups';
import { ClosedRow } from '../components/ClosedRow';

/**
 * The home tab. It opens with the one lane the whole app used to lack: every
 * action that is yours — re-stamps you owe, your own merge buttons, your CI
 * fixes — regardless of who authored the pull. The daily loop must not
 * require flipping between Review and My work. Below that, other people's
 * work to pick from.
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
   const { selfReview, primaryRepos, starredPeople, codeRegions } = useSettings();
   const starred = new Set(starredPeople);
   // A snooze is "not today" for THIS lens only: the daily what-do-I-review
   // loop lives here, so the quieting gesture belongs here — every other
   // lens still shows the pull. Snoozed rows collect in their own section at
   // the bottom of the board instead of vanishing into Settings.
   const { snoozed } = usePulldasher();
   const napping = [...allPulls, ...allBots].filter(p => isSnoozed(p.data, snoozed));
   const pulls = allPulls.filter(p => !isSnoozed(p.data, snoozed));
   const bots = allBots.filter(p => !isSnoozed(p.data, snoozed));
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

   // 1. Waiting on you: strictly your verbs. The earlier "Act now" lesson still
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

   // 2. Review queue: best next review first (leverage + age + weight).
   //    Includes pulls waiting on someone else's re-stamp — a fresh CR from
   //    you counts there too (the stale pip marks them).
   // exclude PRs you already hold a live CR stamp on — including a needs_recr
   // whose re-stamp is owed by someone else, not you. You reviewed this head;
   // being asked to review it again because a different reviewer's stamp went
   // stale is the re-review gap that put already-done work back in your queue.
   const crPool = others.filter(
      p =>
         !p.cryo &&
         !p.crBy.includes(me) &&
         (p.status === 'needs_cr' || (p.status === 'needs_recr' && !p.recrBy.includes(me)))
   );
   const nonStarved = crPool.filter(p => !p.starved);

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
            !p.cryo &&
            !p.crBy.includes(me) &&
            (p.status === 'needs_cr' || (p.status === 'needs_recr' && !p.recrBy.includes(me)))
      )
      .sort(bySecurityThenAge);
   const botKeys = new Set(botReviewable.map(p => pullKey(p.data)));
   const botRest = bots.filter(p => !botKeys.has(pullKey(p.data))).sort(bySecurityThenAge);
   const isDemoted = (p: DerivedPull) => botKeys.has(pullKey(p.data));

   // 4. Needs QA is a query, not the status bucket: QA runs in parallel with
   //    CR here (v1's QA column predicate), so anything QA-incomplete with
   //    green CI belongs — not just pulls whose CR is already done. Unclaimed
   //    QA leads (it needs a volunteer), someone-else's claim sinks; within a
   //    claim state, lighter tests first, then oldest. Split by your primary
   //    repos, same as the review queue — QA is the bottleneck on a
   //    self-review team, so it deserves the same relevance cut.
   // (moved above the queue/needsQa construction so regionMatches below can
   // read both pools before either lane's pool is filtered)
   const qaPool = others.filter(
      p =>
         !p.cryo &&
         !qaDone(p) &&
         ['success', 'none'].includes(p.ci) &&
         !p.conflict &&
         !['draft', 'dev_block'].includes(p.status) &&
         // your in-flight QA and owed re-QAs live in "Waiting on you"; a QA
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

   // In your code regions: reviewable pulls (CR or QA pool) matching a region
   // you set in Settings, deduped across the two pools and genuinely pulled
   // out of the queue/QA lanes below (including their "other repos" folds)
   // into their own section — the most explicit "this is my area" signal
   // earns its own spot instead of a float within the queue.
   const regionSeen = new Set<string>();
   const regionMatches = crSort(
      [...crPool, ...qaPool].filter(p => {
         const k = pullKey(p.data);
         if (regionSeen.has(k) || !matchesRegion(p, codeRegions)) return false;
         regionSeen.add(k);
         return true;
      })
   );
   const regionKeys = new Set(regionMatches.map(p => pullKey(p.data)));

   // ONE review queue: your primary repos' reviewables, every starved pull
   // regardless of repo (the fairness backstop rides in the ranking now, not
   // a separate Aging lane — starveScore's uncapped age × size term floats
   // them to the top numerically instead of positionally), and the day's bot
   // bumps sinking to the tail. The top of this lane IS the board's best
   // next pickup; the retired "Deal me one" button dealt this exact order,
   // which is why the button became redundant and was removed. Non-starved work outside your primary repos still
   // folds into "other repos" below, reachable but not in the way. Region
   // matches are excluded here too (same Set-filter pattern as botKeys) — they
   // live in their own lane above, not doubled up in the queue.
   const queue = starFirst(
      dealRank(
         [
            ...nonStarved.filter(
               p => isPrimaryRepo(p.data.repo) && !regionKeys.has(pullKey(p.data))
            ),
            ...crPool.filter(p => p.starved && !regionKeys.has(pullKey(p.data))),
            ...botReviewable,
         ],
         { me, pulls, deprioritize: isDemoted, warnDays: opts.ageWarnDays }
      ),
      starred
   );
   const queueOther = crSort(
      nonStarved.filter(p => !isPrimaryRepo(p.data.repo) && !regionKeys.has(pullKey(p.data)))
   );

   // Ready-to-merge is the author's button, not the reviewer's job: a count
   // in the rest group, not a lane at the top.
   const ready = others.filter(p => p.status === 'ready');

   const needsQa = starFirst(
      qaSort(qaPool.filter(p => isPrimaryRepo(p.data.repo) && !regionKeys.has(pullKey(p.data)))),
      starred
   );
   const needsQaOther = qaSort(
      qaPool.filter(p => !isPrimaryRepo(p.data.repo) && !regionKeys.has(pullKey(p.data)))
   );

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
   const claimed = crSort(pulls.filter(p => claimFor(p.data)?.login === me));

   // A push answered the feedback, so the ball is back with whoever asked for
   // changes — their move now is to re-review, not to wait some more.
   const reReview = others.filter(p => rowNote(p, me).action === 'Re-review');

   // "Waiting on you": every lane above whose next step is yours, folded into one flat
   // list and re-bucketed by rowWord (Requested of you / You're reviewing no
   // longer stand alone — their members show up here, grouped by verb instead
   // of by where they came from).
   const yourMoveKeys = new Set<string>();
   const yourMove: DerivedPull[] = [];
   for (const p of [...todo.map(({ p }) => p), ...requestedOfYou, ...claimed, ...reReview]) {
      const k = pullKey(p.data);
      if (yourMoveKeys.has(k)) continue;
      yourMoveKeys.add(k);
      yourMove.push(p);
   }
   const doRankOf = (p: DerivedPull) => {
      const word = rowWord(p, me, { claim: claimFor(p.data) }).word;
      const idx = DO_WORD_RANK.indexOf(word);
      return idx === -1 ? Number.POSITIVE_INFINITY : idx;
   };
   yourMove.sort((a, b) => doRankOf(a) - doRankOf(b) || b.ageDays - a.ageDays);

   // "Waiting on others": your PRs and stamps sitting with someone else right now —
   // your own PRs waiting on a review/QA, plus a stamp you've already given
   // that isn't fully signed off yet (stamped/qaStamped, formerly their own
   // rest-group folds — redundant once this lane exists).
   const yoursWaitingKeys = new Set<string>();
   const yoursWaiting: DerivedPull[] = [];
   for (const p of [
      ...pulls.filter(p => p.data.user.login === me && rowWord(p, me).kind === 'wait'),
      ...stamped,
      ...qaStamped,
   ]) {
      const k = pullKey(p.data);
      if (yoursWaitingKeys.has(k)) continue;
      yoursWaitingKeys.add(k);
      yoursWaiting.push(p);
   }
   const waitRankOf = (p: DerivedPull) => {
      const word = rowWord(p, me, { claim: claimFor(p.data) }).word;
      const idx = WAIT_WORD_RANK.indexOf(word);
      return idx === -1 ? Number.POSITIVE_INFINITY : idx;
   };
   yoursWaiting.sort((a, b) => waitRankOf(a) - waitRankOf(b) || b.ageDays - a.ageDays);

   // a quiet board (nothing in any primary lane) is exactly when the rest
   // group's folds become the main event — they should greet you open, not
   // as a wall of closed triangles
   // the per-card "why" behind the repo# door in the ranked lanes — the same
   // reason strings the dealt card's footnote and the Start-here toast use,
   // so every surface explains a pick in the same words
   const whyUpNext = (p: DerivedPull) => startHereReason(p, pulls, me);

   // Needs QA's own "why" line: that lane isn't ranked by deal-score, it's
   // sorted by qaSort (unclaimed-first, then lightest, then oldest) — reusing
   // whyUpNext's reciprocity/quick-win/urgency reasons here would describe a
   // ranking this lane doesn't use.
   const whyQaNext = (p: DerivedPull) =>
      p.qaingLogin
         ? `${p.qaingLogin} is already testing it; it sinks below unclaimed QA`
         : p.sizeKnown && (p.weight === 'XS' || p.weight === 'S')
           ? `Nobody's testing it yet, a light one (${p.weight})`
           : `Nobody's testing it yet, waiting ${Math.max(1, Math.round(p.ageDays))}d`;

   const boardIsQuiet =
      !yourMove.length &&
      !yoursWaiting.length &&
      !changed.length &&
      !queue.length &&
      !needsQa.length;

   // the rest group itself earns a title only when it has something inside —
   // an empty "rest of the board" with 11 closed folds under it is still noise.
   // stamped/qaStamped moved into "Waiting on others" above, so they no longer
   // count here.
   const restTotal =
      queueOther.length +
      needsQaOther.length +
      ready.length +
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
            sub="Nothing to review with these filters. Clear some to see more."
         />
      );
   }

   return (
      <>
         {codeRegions.length === 0 && <RegionHint />}
         {yourMove.length > 0 && (
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
                        Grouped by the action, most urgent action first, oldest first inside a
                        group.
                     </p>
                  </SubDoor>
               }
               pulls={[]}
               count={yourMove.length}
               opts={opts}
            >
               <WordGroupRows
                  pulls={yourMove}
                  opts={opts}
                  id="lane:Waiting on you"
                  cap={laneShown(12, opts)}
               />
            </Lane>
         )}
         {yoursWaiting.length > 0 && (
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
                     <p>Grouped by what each one waits on.</p>
                  </SubDoor>
               }
               pulls={[]}
               count={yoursWaiting.length}
               opts={opts}
            >
               <WordGroupRows
                  pulls={yoursWaiting}
                  opts={opts}
                  id="lane:Waiting on others"
                  cap={laneShown(8, opts)}
               />
            </Lane>
         )}
         <Lane
            title="Changed since your last look"
            sub="new or updated while you were away"
            pulls={changed}
            cap={8}
            opts={opts}
         />
         {/* below here is offered work, not owed work — the board's suggestion
             for what to pick up next, as distinct from "Waiting on you" above. The
             label only earns its place when something is actually on offer. */}
         {(queue.length > 0 || needsQa.length > 0 || regionMatches.length > 0) && (
            <div className={`mb-2 text-ink-3 ${eyebrowText}`}>Pick up next</div>
         )}
         {codeRegions.length > 0 && regionMatches.length > 0 && (
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
               pulls={regionMatches}
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
         <Lane
            title="Review queue"
            sub={
               <SubDoor label="How the queue is ranked" text="one queue, best next review first">
                  <p className="font-medium text-ink">One score ranks every card:</p>
                  <p>
                     PRs that have waited {opts.ageWarnDays ?? 4}+ days for review jump to the top,
                     oldest and biggest first, even from repos you don’t usually review.
                  </p>
                  <p>
                     After those: PRs in repos you’ve reviewed before, PRs from people who review
                     your work, and small quick wins, lightest first. PRs from people you starred
                     always come first; bot PRs (dependency bumps) sink to the bottom.
                  </p>
                  <p>PRs you claim stay in the queue and also appear in Waiting on you.</p>
               </SubDoor>
            }
            pulls={queue}
            cap={12}
            opts={{ ...opts, rankReason: whyUpNext }}
         />
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
            pulls={needsQa}
            cap={6}
            opts={{ ...opts, rankReason: whyQaNext }}
         />
         {(restTotal > 0 || napping.length > 0) && (
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
                  dot={STATUS_DOT.dev_block}
                  count={devBlocked.length}
                  label="dev blocked"
                  hint="paused by the author, nothing to review yet"
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
                  hint="the author fixes CI first"
                  id="review:ci-red"
                  defaultOpen={boardIsQuiet}
               >
                  <FoldRows list={ciRed} opts={opts} id="review:ci-red" />
               </Fold>
               <Fold
                  dot={STATUS_DOT.draft}
                  count={drafts.length}
                  label={drafts.length === 1 ? 'draft' : 'drafts'}
                  hint="not up for review yet"
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
               {/* your snoozes, visibly parked at the board's bottom instead
                   of vanishing into Settings — hiding is trustworthy when you
                   can always see what's hidden. Review-lens only: a snooze
                   quiets this lens's daily loop, nothing else. */}
               <Fold
                  dot="var(--ink-3)"
                  count={napping.length}
                  label="snoozed by you"
                  hint="back tomorrow, or as soon as they change"
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
                  <FoldRows list={napping} opts={opts} id="review:snoozed" />
               </Fold>
            </RestGroup>
         )}
      </>
   );
}

// Your own pulls contribute only their do-it-now verbs to the home lane.
// "Undraft" always stays in My work (planning, not minutes). Getting
// QA is different: when the team self-reviews, CR isn't the gate and lining up
// QA is the daily stall, so "Find a QA-er" graduates to a home to-do.
function ownVerb(p: DerivedPull, selfReview: boolean): string | null {
   const verb = authorMove(p);
   if (!verb) return null;
   const doNow = ['Merge it', 'Fix CI', 'Address feedback', 'Lift your block', 'Rebase'];
   if (selfReview) doNow.push('Find a QA-er');
   return doNow.includes(verb) ? verb : null;
}
