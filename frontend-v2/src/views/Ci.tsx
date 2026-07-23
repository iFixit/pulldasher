import { useMemo } from 'react';
import { lastPushEpoch, type DerivedPull } from '../model/status';
import { checkLedgers, ciSecsWord, type CheckLedger } from '../model/ci';
import { pullKey } from '../format';
import { EmptyState } from '../components/bits';
import { Fold, FoldRows, Lane, laneShown, RestGroup, SubDoor, Truncated } from '../components/Lane';
import { Row, type RowOptions } from '../components/Row';

/**
 * The CI lens: the board re-keyed by the machine reviewer. It leads with the
 * check ledger — every check on the board, worst first, each row carrying
 * its health at a glance (failing/running share on the fixed ruler, counts
 * in words, average run time), and each FAILING check opening into the PRs
 * it's failing. That one section is the QA-engineering read: "are our tests
 * failing in certain ways?" The dev read follows: your own red builds, then
 * what's still running, then the rest folds (all-green, no-checks). A pull
 * failing several checks sits under each of them, which the sub-line admits
 * (same disclosure contract as Needs QA's CR overlap).
 */

/**
 * One check's health, at a glance: the board's 112px ruler carrying the red
 * failing share (and slate running share) of its runs, the counts in words,
 * and the average run time. Lives in a Fold's band (failing checks, where it
 * doubles as the accordion title) and in the chevron-less row a healthy
 * check gets — the ruler's fixed extent keeps fractions comparable in both.
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

   const allGreen = !failing.length && !running.length;

   return (
      <>
         {/* the ledger IS the dashboard: every check, worst first, health in
             the band; a failing check opens into the PRs it's failing. All
             collapsed until the user chooses otherwise (the choice is
             remembered) — the glance is the point, the pulls are the detail. */}
         {ledgers.length > 0 && (
            <Lane
               title="Check health"
               sub={
                  <SubDoor
                     label="How Check health reads"
                     text="every check on the board, worst first — open one for the PRs failing it"
                  >
                     <p>
                        Each band: the share of the check’s runs failing (red) or still running
                        (slate), the counts in words, and the average run time.
                     </p>
                     <p>
                        A failing check opens into every PR it’s failing, oldest first, yours
                        included. A PR failing two checks sits under both.
                     </p>
                  </SubDoor>
               }
               pulls={[]}
               count={ledgers.length}
               opts={opts}
            >
               {/* check names are case-sensitive identifiers, so the fold
                   skips the eyebrow's uppercase transform */}
               {ledgers.map(l =>
                  l.failing.length > 0 ? (
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
                  ) : (
                     // a healthy check has nothing to open: same band, no
                     // chevron — the leading spacer keeps names in one column
                     <div
                        key={l.context}
                        className="flex items-center gap-2 border-t border-secondary bg-muted/40 px-3.5 py-[6px] text-[11px] first:border-t-0"
                     >
                        <span className="w-3 flex-none" aria-hidden />
                        <span
                           className="min-w-0 truncate font-semibold text-ink-3"
                           title={l.context}
                        >
                           {l.context}
                        </span>
                        <span className="ml-auto flex min-w-0 items-center gap-3 text-ink-3">
                           <LedgerGlance ledger={l} />
                        </span>
                     </div>
                  )
               )}
            </Lane>
         )}
         <Lane
            title="Your broken builds"
            sub="nobody can review these until the build is green"
            pulls={mineBroken}
            cap={8}
            opts={opts}
         />
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
