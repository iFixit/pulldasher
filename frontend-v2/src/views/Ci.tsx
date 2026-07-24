import { useMemo } from 'react';
import { lastPushEpoch, type DerivedPull } from '../model/status';
import { checkLedgers, ciSecsWord, type CheckLedger } from '../model/ci';
import { pullKey } from '../format';
import { EmptyState } from '../components/bits';
import { Fold, FoldRows, Lane, laneShown, RestGroup, SubDoor, Truncated } from '../components/Lane';
import { Row, type RowOptions } from '../components/Row';

/**
 * The CI lens: the board re-keyed by the machine reviewer, redesigned so the
 * screen stops being a wall of mostly-green rows. Two reads share one page
 * without a mode switch:
 *
 *  - the dev's "are MY builds red" — "Your broken builds" is pinned first and
 *    renders nothing when you're green (no news is good news);
 *  - the QA-engineer's "what's broken across the fleet" — "Check health" leads
 *    with a one-line summary, then only the FAILING checks (worst first, each
 *    opening into the PRs it fails). The healthy checks fold into a single
 *    count at the bottom, reachable for a whole-fleet audit but never a wall.
 *
 * No failure or timing data is lost: every check keeps its failing/running
 * share on the fixed ruler, its counts in words, and its average run time —
 * and the fleet's slowest failing check is surfaced in the summary so a
 * slow-and-red check reads at a glance.
 */

/**
 * One check's health, at a glance: the board's 112px ruler carrying the red
 * failing share (and slate running share) of its runs, the counts in words,
 * and the average run time. Lives in a Fold's band (failing checks, where it
 * doubles as the accordion title) and in the chevron-less row a healthy check
 * gets — the ruler's fixed extent keeps fractions comparable in both.
 */
function LedgerGlance({ ledger }: { ledger: CheckLedger }) {
   const { context, failing, running, total, avgSecs } = ledger;
   const failPct = (failing.length / total) * 100;
   const runPct = (running / total) * 100;
   const word = failing.length
      ? `${failing.length} of ${total} runs failing`
      : running
        ? `${running} of ${total} still running`
        : `all ${total} green`;
   return (
      <>
         <span
            role="img"
            aria-label={`${context}: ${word}`}
            className="flex h-[4px] w-28 flex-none overflow-hidden rounded-full"
            style={{ background: 'var(--secondary)' }}
         >
            {failPct > 0 && (
               <span aria-hidden style={{ width: `${failPct}%`, background: 'var(--bad)' }} />
            )}
            {runPct > 0 && (
               <span aria-hidden style={{ width: `${runPct}%`, background: 'var(--slate)' }} />
            )}
         </span>
         <span className="w-36 flex-none text-right tabular-nums">{word}</span>
         <span className="w-12 flex-none text-right tabular-nums">
            {avgSecs != null ? `~${ciSecsWord(avgSecs)}` : '—'}
         </span>
      </>
   );
}

/** A healthy (non-failing) check: the same band, no chevron — nothing to open.
 * The leading spacer keeps names in one column with the failing folds above. */
function HealthyRow({ ledger }: { ledger: CheckLedger }) {
   return (
      <div className="flex items-center gap-2 border-t border-secondary bg-muted/40 px-3.5 py-[6px] text-[11px] first:border-t-0">
         <span className="w-3 flex-none" aria-hidden />
         <span className="min-w-0 truncate font-semibold text-ink-3" title={ledger.context}>
            {ledger.context}
         </span>
         <span className="ml-auto flex min-w-0 items-center gap-3 text-ink-3">
            <LedgerGlance ledger={ledger} />
         </span>
      </div>
   );
}

export function Ci({ pulls, opts }: { pulls: DerivedPull[]; opts: RowOptions }) {
   const me = opts.me;
   const withChecks = useMemo(() => pulls.filter(p => p.ci !== 'none'), [pulls]);
   const ledgers = useMemo(() => checkLedgers(withChecks), [withChecks]);

   const failing = useMemo(
      () => withChecks.filter(p => p.ci === 'failing').sort((a, b) => b.ageDays - a.ageDays),
      [withChecks]
   );
   const mineBroken = failing.filter(p => p.data.user.login === me);

   const running = useMemo(
      () =>
         withChecks
            .filter(p => p.ci === 'pending')
            .sort((a, b) => lastPushEpoch(a) - lastPushEpoch(b)),
      [withChecks]
   );
   const green = useMemo(() => withChecks.filter(p => p.ci === 'success'), [withChecks]);
   const noChecks = useMemo(() => pulls.filter(p => p.ci === 'none'), [pulls]);

   if (!pulls.length) {
      return <EmptyState title="Workbench clear" sub="No open PRs match your filters." />;
   }
   if (!withChecks.length) {
      return <EmptyState title="No checks to show" sub="None of these PRs run CI checks." />;
   }

   // the failing/healthy split IS the wall fix: only checks with a red run
   // render as rows; the rest fold into one count at the bottom of the lane
   const failingChecks = ledgers.filter(l => l.failing.length > 0);
   const clearChecks = ledgers.filter(l => l.failing.length === 0);
   const allGreen = !failing.length && !running.length;

   // the fleet summary line — the QA-engineer's one-glance read, and where
   // timing is elevated: the slowest FAILING check (a slow red check is the
   // worst kind) rides here instead of being buried in a 48px column
   const slowestFailing = failingChecks.reduce<number | null>(
      (mx, l) => (l.avgSecs != null && (mx == null || l.avgSecs > mx) ? l.avgSecs : mx),
      null
   );
   const summary = failingChecks.length
      ? `${failingChecks.length} check${failingChecks.length === 1 ? '' : 's'} failing · ${
           failing.length
        } PR${failing.length === 1 ? '' : 's'}${
           slowestFailing != null ? ` · slowest ~${ciSecsWord(slowestFailing)}` : ''
        }`
      : running.length
        ? `no checks failing · ${running.length} still running`
        : 'every check passing';

   return (
      <>
         {/* the dev's read, pinned first: your own red builds. Renders nothing
             when you're green, so it never costs a QA-engineer a scroll. */}
         {mineBroken.length > 0 && (
            <Lane
               title="Your broken builds"
               sub="nobody can review these until the build is green"
               pulls={mineBroken}
               cap={8}
               opts={opts}
            />
         )}
         {/* the fleet read: failing checks worst-first with the summary up top;
             healthy checks folded away so the page isn't a wall of green. */}
         {ledgers.length > 0 && (
            <Lane
               title="Check health"
               sub={
                  <SubDoor label="How Check health reads" text={summary}>
                     <p>
                        Each band: the share of the check’s runs failing (red) or still running
                        (slate), the counts in words, and the average run time. The slowest failing
                        check rides in the line above — a slow, red check is the worst kind.
                     </p>
                     <p>
                        Only checks with a failing run show here; the healthy ones fold into the
                        count at the bottom, openable for a whole-fleet audit. A failing check opens
                        into every PR it’s failing, oldest first, yours included. A PR failing two
                        checks sits under both.
                     </p>
                  </SubDoor>
               }
               pulls={[]}
               count={ledgers.length}
               opts={opts}
            >
               {/* check names are case-sensitive identifiers, so the fold skips
                   the eyebrow's uppercase transform */}
               {failingChecks.map(l => (
                  <Fold
                     key={l.context}
                     count={l.failing.length}
                     showCount={false}
                     label={l.context}
                     caps={false}
                     detail={<LedgerGlance ledger={l} />}
                     id={`ci:health:${l.context}`}
                  >
                     <Truncated cap={laneShown(6, opts)} id={`ci:health:${l.context}:rows`}>
                        {l.failing.map(p => (
                           <Row key={pullKey(p.data)} pull={p} opts={opts} />
                        ))}
                     </Truncated>
                  </Fold>
               ))}
               {clearChecks.length > 0 && (
                  <Fold
                     count={clearChecks.length}
                     showCount={false}
                     caps={false}
                     label={`${clearChecks.length} check${
                        clearChecks.length === 1 ? '' : 's'
                     } all passing`}
                     gloss="Every run of these is green (or still going). Open to audit the whole fleet."
                     id="ci:health:clear"
                     defaultOpen={allGreen}
                  >
                     {clearChecks.map(l => (
                        <HealthyRow key={l.context} ledger={l} />
                     ))}
                  </Fold>
               )}
            </Lane>
         )}
         <Lane
            title="CI running"
            sub="longest since the last push first"
            pulls={running}
            cap={8}
            opts={opts}
         />
         {allGreen && (
            <EmptyState
               title="All green"
               sub="Every check on the board passed. Go review something."
            />
         )}
         {(green.length > 0 || noChecks.length > 0) && (
            <RestGroup title="The rest of the board">
               {green.length > 0 && (
                  <Fold
                     count={green.length}
                     label="All green"
                     gloss="Every check on these passed."
                     id="ci:green"
                     defaultOpen={allGreen}
                  >
                     <FoldRows list={green} opts={opts} id="ci:green" />
                  </Fold>
               )}
               {noChecks.length > 0 && (
                  <Fold
                     count={noChecks.length}
                     label="No checks"
                     gloss="Nothing runs CI on these."
                     id="ci:no-checks"
                  >
                     <FoldRows list={noChecks} opts={opts} id="ci:no-checks" />
                  </Fold>
               )}
            </RestGroup>
         )}
      </>
   );
}
