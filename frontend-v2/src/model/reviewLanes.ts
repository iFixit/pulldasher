import { qaDone, weightRank, type DerivedPull, type Status } from '../../../shared/model/status';
import type { PullData } from '../../../shared/types';
import { pullKey } from '../../../shared/format';
import {
   authorMove,
   DO_WORD_RANK,
   reviewerMove,
   rowNote,
   rowWord,
   WAIT_WORD_RANK,
} from './actions';
import { startHereReason } from './cheers';
import { dealRank } from './deal';
import { displayName } from './names';
import { matchesRegion } from './regions';
import { repoBlocks, type RepoBlock } from './repoBlocks';
import { claimFor, reviewRequestedFrom } from './reviewers';
import { myPeople, type PersonalTeam } from '../settings';
import { crSort, teamFirst } from './sort';

/**
 * Review.tsx's lanes/pools, pulled out of the component so the bucketing
 * rules are unit-testable without mounting React — the same split every
 * sibling view uses (Team.tsx → teamBuckets, Ci.tsx → checkLedgers). Review
 * has no render tests of its own, so this module's tests are the safety net
 * for the extraction: every pull the board can bucket a card into is covered
 * here, and Review.tsx itself does nothing but render the result.
 */

export interface ReviewLanesInput {
   /** the lens's human pool — Review.tsx's own snooze filter (isSnoozed
    * against the store's `snoozed` map) has already run, so a snoozed pull
    * never reaches the lane math below. */
   pulls: DerivedPull[];
   /** same pool, bot pulls (dependency bumps etc.) — snoozed already excluded */
   bots: DerivedPull[];
   /** merged/closed pulls in the loaded window — only `.length` feeds the
    * lanes below (the "recently closed" fold's count, the empty-board check);
    * Review.tsx still renders the array itself, straight from its own prop. */
   closed: PullData[];
   /** your snoozed pulls (Review.tsx's own isSnoozed filter, inverted) —
    * still shown, just parked at the bottom of "the rest of the board" */
   napping: DerivedPull[];
   /** new or updated since lastSeen, newest first — Review.tsx's own isFresh
    * filter. store.ts's snooze/freshness predicates are a store concern (they
    * read the live `snoozed`/`lastSeen` state), kept out of model/ the same
    * way every other model file stays independent of the store singleton. */
   changed: DerivedPull[];
   me: string;
   /** settings.selfReview: promotes "Find a QA-er" into the home to-do lane —
    * lining up QA is the daily stall on a team that doesn't gate on CR */
   selfReview: boolean;
   /** settings.teams: your personal rosters, unioned into the "teammates lead
    * the queue" set */
   teams: PersonalTeam[];
   /** settings.codeRegions: free-text areas that pull a PR into "In your code
    * regions" ahead of the plain queue/QA lanes */
   codeRegions: string[];
   /** settings.repoPriority: non-empty switches the review queue from one
    * ranked list to contiguous per-repo blocks */
   repoPriority: string[];
   /** opts.ageWarnDays: the aging threshold dealRank's urgency ramp
    * normalizes against (falls back to the model's own STARVE_DAYS) */
   ageWarnDays?: number;
   /** login → human display name (model/names.ts), threaded into whyUpNext/
    * whyQaNext (and on into startHereReason) so the rank-reason popover shows
    * a name instead of a login — defaults to {} so an unresolved login just
    * falls back to itself. */
   names?: Readonly<Record<string, string | null>>;
}

export interface ReviewLanes {
   /** every lane whose next step is yours, folded flat and re-bucketed by
    * rowWord's do-word (Re-stamp, Merge it, Review it, ...) — the kinds of
    * action that unblock other people first, then oldest within a word */
   yourMove: DerivedPull[];
   /** your own PRs and the stamps you've already given, still sitting with
    * someone else, folded flat and re-bucketed by rowWord's wait-word */
   yoursWaiting: DerivedPull[];
   /** new or updated since lastSeen, newest first — a pass-through of the
    * input so every lane the render reads comes off one object */
   changed: DerivedPull[];
   /** the one ranked review queue (dealRank + teamFirst) when no repo
    * priority is set */
   queue: DerivedPull[];
   /** reviewable, non-starved pulls outside your primary repos — folded away
    * in "the rest of the board" */
   queueOther: DerivedPull[];
   /** starved pulls piercing the repo-block partition (only meaningful with
    * repoPriority set) */
   queueStarved: DerivedPull[];
   /** the review queue's contiguous per-repo blocks (only meaningful with
    * repoPriority set) */
   queueBlocks: RepoBlock[];
   /** CR- or QA-pool pulls matching a configured code region, deduped and
    * pulled out of every lane below */
   regionMatches: DerivedPull[];
   needsQa: DerivedPull[];
   needsQaOther: DerivedPull[];
   /** fully signed off and green, bot PRs included — one merge press from done */
   ready: DerivedPull[];
   devBlocked: DerivedPull[];
   deployHeld: DerivedPull[];
   unmergeable: DerivedPull[];
   ciPending: DerivedPull[];
   ciRed: DerivedPull[];
   drafts: DerivedPull[];
   /** bot PRs not up for review right now (merge-ready, in CI, or draft) */
   botRest: DerivedPull[];
   /** your snoozed pulls — a pass-through of the input, for the same reason
    * `changed` is */
   napping: DerivedPull[];
   /** everything folded in "the rest of the board", closed pulls included */
   restTotal: number;
   /** nothing in any primary lane — the rest group's folds default open */
   boardIsQuiet: boolean;
   /** no open pulls, bots, or closed pulls at all under the current filters */
   empty: boolean;
   /** the review queue's per-card "why" line (rendered in the state popover) */
   whyUpNext: (p: DerivedPull) => string;
   /** Needs QA's own per-card "why" line — that lane sorts by qaSort, not
    * deal-score, so it needs its own reasons rather than whyUpNext's */
   whyQaNext: (p: DerivedPull) => string;
}

/** Your own pulls contribute only their do-it-now verbs to the home lane.
 * "Undraft" always stays in My work (planning, not minutes). Getting QA is
 * different: when the team self-reviews, CR isn't the gate and lining up QA
 * is the daily stall, so "Find a QA-er" graduates to a home to-do. */
function ownVerb(p: DerivedPull, selfReview: boolean): string | null {
   const verb = authorMove(p);
   if (!verb) return null;
   const doNow = ['Merge it', 'Fix CI', 'Address feedback', 'Lift your block', 'Rebase'];
   if (selfReview) doNow.push('Find a QA-er');
   return doNow.includes(verb) ? verb : null;
}

export function buildReviewLanes(input: ReviewLanesInput): ReviewLanes {
   const {
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
      ageWarnDays,
      names = {},
   } = input;

   const team = new Set(myPeople(teams));
   const others = pulls.filter(p => p.data.user.login !== me);

   // Repo relevance is per-person (a web dev and a firmware dev share the
   // monorepo but little else) and inferred from the current board: the
   // repos you've authored or stamped on. An empty inference means we can't
   // tell, so every repo counts as primary and the queue stays flat.
   const primarySet = new Set(
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
   const botRest = bots
      .filter(p => !botKeys.has(pullKey(p.data)) && p.status !== 'ready')
      .sort(bySecurityThenAge);
   const isDemoted = (p: DerivedPull) => botKeys.has(pullKey(p.data));

   // 4. Needs QA is a query, not the status bucket: QA runs in parallel with
   //    CR here (v1's QA column predicate), so anything QA-incomplete with
   //    green CI belongs — not just pulls whose CR is already done. Unclaimed
   //    QA leads (it needs a volunteer), someone-else's claim sinks; within a
   //    claim state, lighter tests first, then oldest. Split by your primary
   //    repos, same as the review queue — QA is the bottleneck on a
   //    self-review team, so it deserves the same relevance cut.
   // (computed above the queue/needsQa construction so regionMatches below
   // can read both pools before either lane's pool is filtered)
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
            weightRank(a.weight) - weightRank(b.weight) ||
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
   const queue = teamFirst(
      dealRank(
         [
            ...nonStarved.filter(
               p => isPrimaryRepo(p.data.repo) && !regionKeys.has(pullKey(p.data))
            ),
            ...crPool.filter(p => p.starved && !regionKeys.has(pullKey(p.data))),
            ...botReviewable,
         ],
         { me, pulls, deprioritize: isDemoted, warnDays: ageWarnDays }
      ),
      team
   );
   const queueOther = crSort(
      nonStarved.filter(p => !isPrimaryRepo(p.data.repo) && !regionKeys.has(pullKey(p.data)))
   );

   // Ready to merge is finishable work for anyone: fully signed off, green,
   // one button-press from done. It earns a real lane in Pick up next rather
   // than a fold — and bot PRs that reach ready join it, since a human has to
   // land them. Longest-waiting first: the ones most likely forgotten.
   const ready = [
      ...others.filter(p => p.status === 'ready'),
      ...bots.filter(p => p.status === 'ready'),
   ].sort((a, b) => b.ageDays - a.ageDays);

   const needsQa = teamFirst(
      qaSort(qaPool.filter(p => isPrimaryRepo(p.data.repo) && !regionKeys.has(pullKey(p.data)))),
      team
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

   // the per-card "why" behind the repo# door in the ranked lanes — the same
   // reason strings the dealt card's footnote and the Start-here toast use,
   // so every surface explains a pick in the same words
   const whyUpNext = (p: DerivedPull) =>
      team.has(p.data.user.login)
         ? `From ${displayName(names, p.data.user.login) ?? p.data.user.login}, on your team: teammates’ PRs lead your queue`
         : startHereReason(p, pulls, me, false, names);
   // the queue's repo blocks (priority order, starved pierced out front) —
   // computed unconditionally, cheap; the render only reads it when a
   // priority is set
   const { starved: queueStarved, blocks: queueBlocks } = repoBlocks(queue, repoPriority);

   // Needs QA's own "why" line: that lane isn't ranked by deal-score, it's
   // sorted by qaSort (unclaimed-first, then lightest, then oldest) — reusing
   // whyUpNext's reciprocity/quick-win/urgency reasons here would describe a
   // ranking this lane doesn't use.
   const whyQaNext = (p: DerivedPull) =>
      team.has(p.data.user.login)
         ? `From ${displayName(names, p.data.user.login) ?? p.data.user.login}, on your team: teammates’ PRs lead this lane`
         : p.qaingLogin
           ? `${displayName(names, p.qaingLogin) ?? p.qaingLogin} is already testing it; it sinks below unclaimed QA`
           : p.weight === 'XS' || p.weight === 'S'
             ? `Nobody's testing it yet, a light one (${p.weight})`
             : `Nobody's testing it yet, waiting ${Math.max(1, Math.round(p.ageDays))}d`;

   const boardIsQuiet =
      !yourMove.length &&
      !yoursWaiting.length &&
      !changed.length &&
      !queue.length &&
      !needsQa.length &&
      !ready.length;

   // the rest group itself earns a title only when it has something inside —
   // an empty "rest of the board" with 11 closed folds under it is still noise.
   // stamped/qaStamped moved into "Waiting on others" above, so they no longer
   // count here.
   const restTotal =
      queueOther.length +
      needsQaOther.length +
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

   return {
      yourMove,
      yoursWaiting,
      changed,
      queue,
      queueOther,
      queueStarved,
      queueBlocks,
      regionMatches,
      needsQa,
      needsQaOther,
      ready,
      devBlocked,
      deployHeld,
      unmergeable,
      ciPending,
      ciRed,
      drafts,
      botRest,
      napping,
      restTotal,
      boardIsQuiet,
      empty,
      whyUpNext,
      whyQaNext,
   };
}
