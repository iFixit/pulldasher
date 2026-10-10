import {
   CR_INCOMPLETE,
   isIterating,
   qaDone,
   STARVE_DAYS,
   weightRank,
   type DerivedPull,
   type Status,
} from '../../../shared/model/status';
import type { PullData } from '../../../shared/types';
import { pullKey } from '../../../shared/format';
import {
   askedOf,
   authorMove,
   authorOwnsIt,
   DO_WORD_RANK,
   reviewerMove,
   nobodysReview,
   qaIsMine,
   reviewIsMine,
   rowNote,
   rowWord,
   selfReviewed,
   WAIT_WORD_RANK,
} from './actions';
import { startHereReason } from './cheers';
import { dealRank, dealScore } from './deal';
import { displayName } from './names';
import { matchesRegion, regionFirst } from './regions';
import { repoBlocks, type RepoBlock } from './repoBlocks';
import { claimFor } from './reviewers';
import { myPeople, type PersonalTeam } from '../settings';
import { crScore, crSort, finishersFirst, sinkBy, teamFirst } from './sort';
import type { PullStanding } from './standing';

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
   /** same pool, bot pulls (dependency bumps etc.) — snoozed already excluded.
    * This pool empties out when "Ignore bot PRs" hides bots from Review's
    * human-review surfaces (the queue tail, the bot fold), unless a filter
    * reveals them. */
   bots: DerivedPull[];
   /** the bot pool Ready-to-merge draws from instead of `bots` — bypasses
    * "Ignore bot PRs" (a green, signed-off bot PR is one merge press from
    * done regardless of that setting), while still respecting every other
    * hide (hidden repo/person, cryo, drafts). Defaults to `bots` so a
    * caller that doesn't separate the two pools sees today's behavior:
    * hiding bots hides them from Ready too. */
   botsForReady?: DerivedPull[];
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
   /** settings.teams: your personal rosters, unioned into the "teammates lead
    * the queue" set */
   teams: PersonalTeam[];
   /** settings.codeRegions: free-text areas that put someone's self-reviewed
    * PR into "Could use your input" */
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
   /** how each PR's project stands (model/standing.ts): a parked project's
    * PRs sink in every ranked lane, and the last PRs of a plan in progress
    * go first on a tie. Absent on a board without projects. */
   standing?: PullStanding;
}

export interface ReviewLanes {
   /** every lane whose next step is yours, folded flat and re-bucketed by
    * rowWord's do-word (Re-stamp, Merge it, Review it, ...) — the kinds of
    * action that unblock other people first, then oldest within a word */
   yourMove: DerivedPull[];
   /** your own PRs waiting on someone else (people you asked, CI, a block),
    * folded flat and re-bucketed by rowWord's wait-word */
   yoursWaiting: DerivedPull[];
   /** new or updated since lastSeen, newest first — a pass-through of the
    * input so every lane the render reads comes off one object */
   changed: DerivedPull[];
   /** the one ranked review queue (dealRank + teamFirst) when no repo
    * priority is set */
   queue: DerivedPull[];
   /** reviewable pulls outside your primary repos — folded away
    * in "the rest of the board" */
   queueOther: DerivedPull[];
   /** the review queue's contiguous per-repo blocks (only meaningful with
    * repoPriority set) */
   queueBlocks: RepoBlock[];
   /** other people's self-reviewed PRs in your code regions or in repos
    * you've reviewed in, regions first: a chance to help, never a debt, so
    * nothing counts it and nothing deals from it */
   couldUseInput: DerivedPull[];
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
   /** a lane's "why" line with what the PR's project did to its place: a
    * parked project's sank it, the last PRs of a plan in progress won a tie.
    * `base` is the lane's own reason; null when there's nothing to say */
   whyProject: (p: DerivedPull, base: string | null) => string | null;
}

const NO_STANDING: PullStanding = { parked: new Map(), finishing: new Map() };

/** Your own pulls contribute only their do-it-now verbs to the home lane:
 * under self-review your own stamps and a request gone quiet are daily work.
 * "Undraft" always stays in My work (planning, not minutes). "Merge it" is
 * the Ready to merge lane's, which leads the tab. */
const OWN_DO_NOW = [
   'Re-stamp',
   'Fix CI',
   'Address feedback',
   'Stamp CR',
   'Stamp QA',
   'Lift your block',
   'Rebase',
   'Answer the review',
   'Unblock',
];
function ownVerb(p: DerivedPull): string | null {
   // 'Answer the review' and the external-block 'Unblock' come from rowNote
   // (they sit above authorNote there), so authorMove alone never sees them
   const shown = rowNote(p, p.data.user.login).action;
   const verb = shown === 'Answer the review' || shown === 'Unblock' ? shown : authorMove(p);
   if (!verb) return null;
   if (verb.startsWith('Nudge ')) return 'Nudge';
   return OWN_DO_NOW.includes(verb) ? verb : null;
}

export function buildReviewLanes(input: ReviewLanesInput): ReviewLanes {
   const {
      pulls,
      bots,
      botsForReady = bots,
      closed,
      napping,
      changed,
      me,
      teams,
      codeRegions,
      repoPriority,
      ageWarnDays,
      names = {},
      standing = NO_STANDING,
   } = input;

   const team = new Set(myPeople(teams));
   const others = pulls.filter(p => p.data.user.login !== me);

   // A project's say in each ranked lane (model/standing.ts): a parked
   // project's PRs sink, never hidden, the way an iterating PR sinks; and
   // where two PRs tie, which each lane reads as its own ranking with age in
   // whole days, the one that helps finish a plan in progress goes first.
   const sunk = (p: DerivedPull) => standing.parked.has(pullKey(p.data));
   const finishes = (p: DerivedPull) => standing.finishing.has(pullKey(p.data));
   const days = (p: DerivedPull) => Math.round(p.ageDays);
   const crRank = (list: DerivedPull[]) =>
      finishersFirst(
         crSort(list, sunk),
         p => `${sunk(p)}|${isIterating(p)}|${Math.round(crScore(p) * STARVE_DAYS)}|${days(p)}`,
         finishes
      );

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
   //    The list is re-ranked by do-word below, so no order here.
   const todo = pulls.filter(
      p => (p.data.user.login === me ? ownVerb(p) : reviewerMove(p, me)) !== null
   );

   // 2. Review queue: best next review first (leverage + age + weight), and
   //    only review that's yours under self-review (reviewIsMine): asked of
   //    you, taken on by you, or needing someone else with nobody on it. A
   //    developer's own unrequested PR is never in anyone else's queue.
   // exclude PRs you already hold a live CR stamp on — including a needs_recr
   // whose re-stamp is owed by someone else, not you. You reviewed this head;
   // being asked to review it again because a different reviewer's stamp went
   // stale is the re-review gap that put already-done work back in your queue.
   const crPool = others.filter(
      p =>
         !p.cryo &&
         !p.crBy.includes(me) &&
         reviewIsMine(p, me) &&
         (p.status === 'needs_cr' || (p.status === 'needs_recr' && !p.recrBy.includes(me)))
   );

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
   // a ready PR is on the Ready lane when it's yours, asked of you, claimed, or
   // from outside the dev team (an outside contributor or a bot has no
   // author-developer to merge it, so it's everyone's)
   const readyMine = (p: DerivedPull) =>
      p.data.user.login === me ||
      !p.authorIsDeveloper ||
      askedOf(p).includes(me) ||
      claimFor(p.data)?.login === me;
   const botKeys = new Set(botReviewable.map(p => pullKey(p.data)));
   const botRest = bots
      .filter(p => !botKeys.has(pullKey(p.data)) && !(p.status === 'ready' && readyMine(p)))
      .sort(bySecurityThenAge);
   const isDemoted = (p: DerivedPull) => botKeys.has(pullKey(p.data));

   // 4. Needs QA is a query, not the status bucket: QA runs in parallel with
   //    CR here (v1's QA column predicate), so anything QA-incomplete with
   //    green CI belongs — not just pulls whose CR is already done. Unclaimed
   //    QA leads (it needs a volunteer), someone-else's claim sinks; within a
   //    claim state, lighter tests first, then oldest. Split by your primary
   //    repos, same as the review queue — QA is the bottleneck on a
   //    self-review team, so it deserves the same relevance cut.
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
         !p.reqaBy.includes(me) &&
         // QA is the author's own, except for an outside tester or a claim
         qaIsMine(p, me)
   );
   const qaSort = (list: DerivedPull[]) =>
      [...list].sort(
         (a, b) =>
            Number(!!a.qaingLogin) - Number(!!b.qaingLogin) ||
            weightRank(a.weight) - weightRank(b.weight) ||
            b.ageDays - a.ageDays
      );
   // teammates lead the primary lane; a parked project's PRs sink below
   // everything, theirs included
   const qaRank = (list: DerivedPull[], pinTeam: boolean) => {
      const pinned = (p: DerivedPull) => pinTeam && team.has(p.data.user.login);
      const sorted = qaSort(list);
      return finishersFirst(
         sinkBy(pinTeam ? teamFirst(sorted, team) : sorted, p => Number(sunk(p))),
         p => `${sunk(p)}|${pinned(p)}|${!!p.qaingLogin}|${p.weight}|${days(p)}`,
         finishes
      );
   };

   // Could use your input: other people's self-reviewed PRs, still owed a
   // stamp, in your code regions or in repos you've reviewed someone else's
   // PR in. Nobody asked you, so it's an offer, never a debt: the lane rests
   // folded and nothing counts it, deals from it, or lets it starve (crSort's
   // age credit is off for a self-reviewed PR). Region matches first.
   const reviewedIn = new Set(
      others.filter(p => p.crBy.includes(me) || p.qaBy.includes(me)).map(p => p.data.repo)
   );
   const couldUseInput = regionFirst(
      crSort(
         others.filter(
            p =>
               (selfReviewed(p) || nobodysReview(p)) &&
               !p.cryo &&
               !authorOwnsIt(p) &&
               (CR_INCOMPLETE.includes(p.status) || p.status === 'needs_qa') &&
               !p.crBy.includes(me) &&
               // you were asked and answered (GitHub cleared the request):
               // it's the author's move or yours to re-review, not an offer
               !p.data.review_requests?.some(r => r.answered && r.login === me) &&
               (matchesRegion(p, codeRegions) || reviewedIn.has(p.data.repo))
         ),
         sunk
      ),
      codeRegions
   );

   // ONE review queue: reviews asked of you lead, oldest request first (they
   // are answered in hours), whatever repo they're from. Then your primary
   // repos' other reviewables (claims, outside-dev pulls) by the deal score,
   // the day's bot bumps sinking to the tail. The top of this lane IS the
   // board's best next pickup. A parked project's PRs sink below every other
   // person's, teammates' included, and above the bots.
   const dealOpts = { me, pulls, deprioritize: isDemoted, warnDays: ageWarnDays };
   const classOf = (p: DerivedPull) => (isDemoted(p) ? 2 : sunk(p) ? 1 : 0);
   const requestedOfMe = (p: DerivedPull) => askedOf(p).includes(me);
   const requests = crPool
      .filter(requestedOfMe)
      .sort((a, b) => (a.askedAt ?? Infinity) - (b.askedAt ?? Infinity));
   const queue = [
      ...requests,
      ...finishersFirst(
         sinkBy(
            teamFirst(
               dealRank(
                  [
                     ...crPool.filter(p => !requestedOfMe(p) && isPrimaryRepo(p.data.repo)),
                     ...botReviewable,
                  ],
                  dealOpts
               ),
               team
            ),
            classOf
         ),
         // the score in days of waiting, as the why line counts them
         p =>
            `${classOf(p)}|${team.has(p.data.user.login)}|${Math.round(
               dealScore(p, dealOpts) * (ageWarnDays ?? STARVE_DAYS)
            )}`,
         finishes
      ),
   ];
   const queueOther = crRank(crPool.filter(p => !requestedOfMe(p) && !isPrimaryRepo(p.data.repo)));

   // Ready to merge: signed off, green, one press from done. Under the
   // policy the author merges their own, so this is your own ready PRs, plus
   // another person's when you were asked to review it or took it on, or when its
   // author isn't a developer (outside contributors and bots).
   // Longest-waiting first: the ones most likely forgotten. botsForReady
   // (not `bots`) so a bot PR you claimed still shows when "Ignore bot PRs"
   // has emptied `bots`.
   const ready = finishersFirst(
      [...pulls, ...botsForReady]
         .filter(p => p.status === 'ready' && readyMine(p))
         .sort((a, b) => Number(sunk(a)) - Number(sunk(b)) || b.ageDays - a.ageDays),
      p => `${sunk(p)}|${days(p)}`,
      finishes
   );

   const needsQa = qaRank(
      qaPool.filter(p => isPrimaryRepo(p.data.repo)),
      true
   );
   const needsQaOther = qaRank(
      qaPool.filter(p => !isPrimaryRepo(p.data.repo)),
      false
   );

   const byStatus = (s: Status) => others.filter(p => p.status === s);
   const devBlocked = byStatus('dev_block');
   const deployHeld = byStatus('deploy_block');
   const unmergeable = byStatus('unmergeable');
   const ciPending = byStatus('ci_pending');
   const ciRed = byStatus('ci_red');
   const drafts = byStatus('draft');

   // the author asked you (by name or through a team): the most concrete
   // "review this" on the board, so it leads, while it's still your move
   const requestedOfYou = others.filter(p => {
      return askedOf(p).includes(me) && rowNote(p, me).action === 'Review it';
   });

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
   for (const p of [...todo, ...requestedOfYou, ...claimed, ...reReview]) {
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
   // the oldest request first (they're answered in hours); a parked
   // project's sink within their word's group, never out of it
   const askedAtOf = (p: DerivedPull) =>
      askedOf(p).includes(me) ? p.askedAt ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
   yourMove.sort(
      (a, b) =>
         doRankOf(a) - doRankOf(b) ||
         askedAtOf(a) - askedAtOf(b) ||
         Number(sunk(a)) - Number(sunk(b)) ||
         b.ageDays - a.ageDays
   );
   const yourMoveRanked = finishersFirst(
      yourMove,
      p => `${doRankOf(p)}|${sunk(p)}|${days(p)}`,
      finishes
   );

   // "Waiting on others": your own PRs sitting with someone else right now:
   // people you asked, CI, a block. A stamp you gave on someone else's PR
   // isn't here: under self-review the rest of that PR is its author's.
   const yoursWaiting = pulls.filter(
      p => p.data.user.login === me && rowWord(p, me).kind === 'wait'
   );
   const waitRankOf = (p: DerivedPull) => {
      const word = rowWord(p, me, { claim: claimFor(p.data) }).word;
      const idx = WAIT_WORD_RANK.indexOf(word);
      return idx === -1 ? Number.POSITIVE_INFINITY : idx;
   };
   yoursWaiting.sort((a, b) => waitRankOf(a) - waitRankOf(b) || b.ageDays - a.ageDays);

   // what a PR's project did to its place, said after the lane's own reason:
   // a parked project's sank it, so that's the whole story; the last PRs of a
   // plan in progress won a tie
   const whyProject = (p: DerivedPull, base: string | null): string | null => {
      const key = pullKey(p.data);
      const parked = standing.parked.get(key);
      if (parked) return `Parked project: ${parked}`;
      const finishing = standing.finishing.get(key);
      if (!finishing) return base;
      const last =
         finishing.left === 1
            ? `Helps finish ${finishing.slug}: its last open PR`
            : `Helps finish ${finishing.slug}: one of its last ${finishing.left} open PRs`;
      return base ? `${base}. ${last}` : last;
   };

   // the per-card "why" behind the repo# door in the ranked lanes — the same
   // reason strings the dealt card's footnote and the Start-here toast use,
   // so every surface explains a pick in the same words
   const whyUpNext = (p: DerivedPull) => {
      const base = team.has(p.data.user.login)
         ? `From ${
              displayName(names, p.data.user.login) ?? p.data.user.login
           }, on your team: teammates’ PRs lead your queue`
         : startHereReason(p, me, false, names);
      return whyProject(p, base) ?? base;
   };
   // the queue's repo blocks (priority order) —
   // computed unconditionally, cheap; the render only reads it when a
   // priority is set
   const { blocks: queueBlocks } = repoBlocks(queue, repoPriority);

   // Needs QA's own "why" line: that lane isn't ranked by deal-score, it's
   // sorted by qaSort (unclaimed-first, then lightest, then oldest) — reusing
   // whyUpNext's reciprocity/quick-win/urgency reasons here would describe a
   // ranking this lane doesn't use.
   const whyQaNext = (p: DerivedPull) => {
      const base = team.has(p.data.user.login)
         ? `From ${
              displayName(names, p.data.user.login) ?? p.data.user.login
           }, on your team: teammates’ PRs lead this lane`
         : p.qaingLogin
         ? `${
              displayName(names, p.qaingLogin) ?? p.qaingLogin
           } is already testing it; it sinks below unclaimed QA`
         : p.weight === 'XS' || p.weight === 'S'
         ? `Nobody's testing it yet, a light one (${p.weight})`
         : `Nobody's testing it yet, waiting ${Math.max(1, Math.round(p.ageDays))}d`;
      return whyProject(p, base) ?? base;
   };

   const boardIsQuiet =
      !yourMove.length &&
      !yoursWaiting.length &&
      !changed.length &&
      !queue.length &&
      !needsQa.length &&
      !ready.length;

   // the rest group itself earns a title only when it has something inside —
   // an empty "rest of the board" with 11 closed folds under it is still noise.
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

   // bots/shipped stay reachable even when no human PRs need review. Checks
   // botsForReady too: a merge-ready bot can sit in `ready` via botsForReady
   // while `bots` itself is empty ("Ignore bot PRs" hid it from the queue/
   // fold), and that bot must not be declared "nothing to see" out from
   // under it.
   const empty = !pulls.length && !bots.length && !closed.length && !botsForReady.length;

   return {
      yourMove: yourMoveRanked,
      yoursWaiting,
      changed,
      queue,
      queueOther,
      queueBlocks,
      couldUseInput,
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
      whyProject,
   };
}
