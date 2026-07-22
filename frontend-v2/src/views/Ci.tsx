import { useMemo } from 'react';
import { lastPushEpoch, type DerivedPull } from '../model/status';
import { checkLedgers, ciSecsWord, type CheckLedger } from '../model/ci';
import { pullKey } from '../format';
import { EmptyState } from '../components/bits';
import { Fold, FoldRows, Lane, laneShown, RestGroup, Rows, Truncated } from '../components/Lane';
import { Row, type RowOptions } from '../components/Row';
import { eyebrowText } from '../components/WordGroups';

/**
 * The CI lens: the board re-keyed by the machine reviewer. Where Review asks
 * "what's my move," this asks "what's broken, by which check" — your own red
 * builds first (fixing CI is always the author's move), then everyone else's
 * failures grouped under the check that's failing them, then what's still
 * running, then a per-check health ledger. The rest folds complete the
 * partition (all-green and no-checks pulls), so every open pull is
 * accounted for exactly once across the lanes and folds — except that a
 * pull failing several checks sits under each of them, which the sub-line
 * admits (same disclosure contract as Needs QA's CR overlap).
 */

/**
 * One check's health row: name, the board's 112px ruler carrying the red
 * failing share (and slate running share) of its runs, quiet counts, and the
 * average run time. The ruler matches the weight strip's fixed extent so
 * fractions compare truthfully down the list.
 */
function HealthRow({ ledger }: { ledger: CheckLedger }) {
   const { context, failing, running, total, avgSecs } = ledger;
   const failPct = (failing.length / total) * 100;
   const runPct = (running / total) * 100;
   const word = failing.length
      ? `${failing.length} of ${total} runs failing`
      : running
        ? `${running} of ${total} still running`
        : `all ${total} green`;
   return (
      <div className="flex items-center gap-3 border-t border-secondary px-3.5 py-2 text-xs first:border-t-0">
         <span className="min-w-0 flex-1 truncate font-medium text-ink" title={context}>
            {context}
         </span>
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
         <span className="w-36 flex-none text-right text-ink-3 tabular-nums">{word}</span>
         <span className="w-12 flex-none text-right text-ink-3 tabular-nums">
            {avgSecs != null ? `~${ciSecsWord(avgSecs)}` : '—'}
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

   // others' failures re-keyed by the check that's failing them, worst check
   // first — a pull failing two checks sits under both (the sub-line admits
   // it); yours are excluded here because they already lead the page
   const byCheck = useMemo(() => {
      const mine = new Set(failing.filter(p => p.data.user.login === me).map(p => pullKey(p.data)));
      return ledgers
         .map(l => ({
            context: l.context,
            pulls: l.failing.filter(p => !mine.has(pullKey(p.data))),
         }))
         .filter(g => g.pulls.length > 0);
   }, [ledgers, failing, me]);

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
         <Lane
            title="Your broken builds"
            sub="nobody can review these until the build is green"
            pulls={mineBroken}
            cap={8}
            opts={opts}
         />
         {byCheck.length > 0 && (
            <section className={opts.compact ? 'mb-4' : 'mb-7'}>
               <Lane
                  title="Failing, by check"
                  sub="worst check first, oldest pull first. A pull failing two checks sits under both; yours lead the page"
                  pulls={[]}
                  count={byCheck.reduce((sum, g) => sum + g.pulls.length, 0)}
                  opts={opts}
               >
                  {/* check names are case-sensitive identifiers, so the
                      fold skips the eyebrow's uppercase transform */}
                  {byCheck.map(g => (
                     <Fold
                        key={g.context}
                        count={g.pulls.length}
                        label={g.context}
                        caps={false}
                        id={`ci:check:${g.context}`}
                        defaultOpen
                     >
                        <Truncated cap={laneShown(6, opts)} id={`ci:check:${g.context}:rows`}>
                           {g.pulls.map(p => (
                              <Row key={pullKey(p.data)} pull={p} opts={opts} />
                           ))}
                        </Truncated>
                     </Fold>
                  ))}
               </Lane>
            </section>
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
         {ledgers.length > 0 && (
            <section className={opts.compact ? 'mb-4' : 'mb-7'}>
               <div className={`mb-2 text-ink-3 ${eyebrowText}`}>Check health</div>
               <Rows>
                  {ledgers.map(l => (
                     <HealthRow key={l.context} ledger={l} />
                  ))}
               </Rows>
            </section>
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
