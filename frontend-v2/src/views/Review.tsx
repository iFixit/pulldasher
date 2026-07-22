import { useEffect, useState } from 'react';
import { type DerivedPull, qaDone, type Status, weightRank } from '../model/status';
import { pullKey, rowDomId } from '../format';
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
import { dealFrom, dealRank } from '../model/deal';
import { useSettings } from '../settings';
import { claimFor, claimReview, isFresh, usePulldasher } from '../store';
import type { PullData } from '../types';
import { EmptyState, QuietButton, STATUS_DOT, STATUS_LABEL } from '../components/bits';
import {
   Fold,
   FoldRows,
   GroupHeader,
   Lane,
   laneShown,
   RestGroup,
   Rows,
   SubDoor,
   Truncated,
} from '../components/Lane';
import { RegionHint } from '../components/RegionHint';
import { markDealtFlash, Row, type RowOptions } from '../components/Row';
import { eyebrowText, WordGroupRows } from '../components/WordGroups';
import { ClosedRow } from '../components/ClosedRow';

/**
 * The dealt pull IS a board row — the real Row component, not a re-drawn
 * card, so the banner shows exactly what the queue shows (alarm CI, pips,
 * weight strip, age baseline, the repo# state door, flags, hover actions)
 * and can never drift from it. Below the row: the "why this one" line as a
 * quiet footnote — reasons are context, not state — and the two verbs.
 * Claiming is a commitment (it also adds you as a GitHub reviewer), so it's
 * an explicit button, not a side effect of dealing.
 */
function DealtCard({
   pull,
   opts,
   pulls,
   onClaim,
   onPass,
}: {
   pull: DerivedPull;
   opts: RowOptions;
   pulls: DerivedPull[];
   onClaim: () => void;
   onPass: () => void;
}) {
   return (
      <div className="flex flex-col">
         <Row pull={pull} opts={opts} />
         <div className="border-t border-secondary px-3.5 pt-2 text-[11px] leading-snug text-ink-3">
            {startHereReason(pull, pulls, opts.me, true)}
         </div>
         <div className="flex items-center gap-2 px-3.5 pt-2 pb-3">
            <QuietButton tone="brand" onClick={onClaim}>
               Claim it
            </QuietButton>
            <QuietButton onClick={onPass}>Pass</QuietButton>
         </div>
      </div>
   );
}

/**
 * "Deal me one" as the board's greeting: for a reviewer who'd rather be
 * handed the next pull than browse, a quiet full-width strip at the very top
 * of the lens — the page opens by answering "what should I pick up next?".
 * Clicking it unfolds an inline banner (a lane-shaped section, the one
 * header system) holding the dealt pull as a REAL full-width board row.
 * It used to be a popover on the queue lane's header, which buried the
 * feature mid-page, squeezed the row to 320px (denying it the board's rail
 * geometry), and dismissed on any stray click mid-commitment — an inline
 * banner has none of those failure modes and keeps the queue visible
 * beneath, so you can see the dealt card IS the queue's top card.
 *
 * "Claim it" takes the pull (and adds you as a GitHub reviewer), then deals
 * the next for an uninterrupted run of triage — and once the claim lands in
 * the store, scrolls to the row in its new lane ("Waiting on you", right below)
 * and flashes it, so the commitment visibly arrives somewhere. "Pass" skips
 * without claiming. "Done" or Escape folds the banner back to the strip.
 */
function DealStrip({ queue, opts }: { queue: DerivedPull[]; opts: RowOptions }) {
   const { pulls } = usePulldasher();
   const [open, setOpen] = useState(false);
   const [dealtKey, setDealtKey] = useState<string | null>(null);
   const [passed, setPassed] = useState<ReadonlySet<string>>(new Set());
   // the claim we're waiting to see land in the store, so the scroll targets
   // the row AFTER it has moved to its new lane, not its old queue position
   const [landing, setLanding] = useState<{ key: string; repo: string; number: number } | null>(
      null
   );

   const deal = (passedNow: ReadonlySet<string>) => {
      const picked = dealFrom(queue, { claims: opts.claims ?? {}, passed: passedNow });
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
      setLanding({ key: dealtKey, repo: dealt.data.repo, number: dealt.data.number });
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

   // scroll to the claimed row once the store's claims include it — that's
   // the same publish that re-buckets it into "Waiting on you" and paints the
   // markDealtFlash highlight, so the scroll lands on its settled position.
   // A frame's wait lets the re-render commit first.
   useEffect(() => {
      if (!landing || opts.claims?.[landing.key]?.login !== opts.me) return;
      const target = landing;
      setLanding(null);
      requestAnimationFrame(() => {
         document
            .getElementById(rowDomId(target))
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
   }, [landing, opts.claims, opts.me]);

   useEffect(() => {
      if (!open) return;
      const onKey = (e: KeyboardEvent) => {
         if (e.key === 'Escape') setOpen(false);
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
   }, [open]);

   // nothing to deal and no session in progress: no strip at all — a button
   // that could only say "nothing left" is noise, not an affordance
   if (!queue.length && !open) return null;

   return (
      <section className={opts.compact ? 'mb-4' : 'mb-7'}>
         {!open ? (
            <button
               type="button"
               onClick={() => {
                  setPassed(new Set());
                  deal(new Set());
                  setOpen(true);
               }}
               className="pressable flex w-full items-center gap-2 rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-left text-xs text-ink-2 hover:text-brand"
            >
               <span className="flex-none font-medium whitespace-nowrap">Deal me one</span>
               <span className="min-w-0 text-ink-3">— takes the top card of your review queue</span>
               <span className="ml-auto flex-none text-ink-3 tabular-nums">{queue.length}</span>
            </button>
         ) : (
            <>
               <GroupHeader
                  title="Dealt to you"
                  sub="the top card of your review queue — claim it or pass"
                  compact={opts.compact}
                  headerExtra={<QuietButton onClick={() => setOpen(false)}>Done</QuietButton>}
               />
               <Rows>
                  {dealt ? (
                     <DealtCard
                        pull={dealt}
                        opts={opts}
                        pulls={pulls}
                        onClaim={claim}
                        onPass={pass}
                     />
                  ) : (
                     <div className="px-3.5 py-3 text-xs text-ink-3">
                        Nothing left to deal — you’ve claimed or passed everything in the queue.
                     </div>
                  )}
               </Rows>
            </>
         )}
      </section>
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
   // bumps sinking to the tail. Ranked by the exact score Deal me one uses,
   // so the button always deals the top visible card — the list and the
   // button can't disagree. Non-starved work outside your primary repos still
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
   const claimed = crSort(pulls.filter(p => opts.claims?.[pullKey(p.data)]?.login === me));

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
      const word = rowWord(p, me, { claim: claimFor(p.data, opts.claims ?? {}) }).word;
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
      const word = rowWord(p, me, { claim: claimFor(p.data, opts.claims ?? {}) }).word;
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
         ? `${p.qaingLogin} is already testing it — it sinks below unclaimed QA`
         : p.sizeKnown && (p.weight === 'XS' || p.weight === 'S')
           ? `Nobody's testing it yet — a light one (${p.weight})`
           : `Nobody's testing it yet — waiting ${Math.max(1, Math.round(p.ageDays))}d`;

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
         <DealStrip queue={queue} opts={opts} />
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
                        If it's in this lane, nothing happens until you act:
                     </p>
                     <p>
                        re-stamps a push owes, feedback waiting on your answer, your own merge
                        buttons, CI fixes and rebases on your PRs, reviews requested of you, and
                        claims you hold.
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
                        your own PRs waiting on a review, QA, or CI, plus PRs you've already stamped
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
                     pulls open {opts.ageWarnDays ?? 4}+ days without a full CR float to the top,
                     longest-and-heaviest waiters first (age × size), even outside your primary
                     repos.
                  </p>
                  <p>
                     Then: repos you’ve stamped before, authors who’ve reviewed yours, and small
                     quick wins, lightest first. Pulls from people you’ve starred always lead, ahead
                     of everything above; bot bumps sink to the tail.
                  </p>
                  <p>“Deal me one” deals the top card that isn’t claimed or passed.</p>
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
                  dot={STATUS_DOT.dev_block}
                  count={devBlocked.length}
                  label="dev blocked"
                  hint="paused by the author — nothing to review yet"
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
