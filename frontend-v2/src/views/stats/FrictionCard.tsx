import type { Friction } from '../../model/stats';
import { BarRow, StatsCard } from './parts';

const ROWS: { key: keyof Friction; label: string; dot: string; hint: string }[] = [
   {
      key: 'conflicts',
      label: 'merge conflicts',
      dot: 'var(--warn)',
      hint: 'the author needs to rebase',
   },
   {
      key: 'devBlocked',
      label: 'dev blocked',
      dot: 'var(--warn)',
      hint: 'feedback waiting on the author',
   },
   { key: 'ciRed', label: 'CI failing', dot: 'var(--bad)', hint: 'a required CI check is failing' },
   {
      key: 'deployBlocked',
      label: 'deploy blocked',
      dot: 'var(--ink-3)',
      hint: 'done, deliberately not shipped',
   },
   {
      key: 'external',
      label: 'external block',
      dot: 'var(--warn)',
      hint: 'stuck on something outside the repo',
   },
   { key: 'stacked', label: 'stacked', dot: 'var(--ink-3)', hint: 'lands with a parent branch' },
   { key: 'drafts', label: 'drafts', dot: 'var(--border)', hint: 'not ready for review yet' },
];

/**
 * Everything stuck on something other than review attention — the part of the
 * board no amount of stamping will move. Zero rows stay visible but dimmed:
 * "no conflicts" is information. Each row gets a bar scaled to the card's
 * shared max, glanceable the same way the rest of Stats reads.
 */
export function FrictionCard({ friction }: { friction: Friction }) {
   const max = Math.max(...ROWS.map(r => friction[r.key]), 1);
   return (
      <StatsCard title="Friction" sub="stuck on something other than review">
         <div className="mt-3 flex flex-col gap-1.5">
            {ROWS.map(r => {
               const n = friction[r.key];
               return (
                  <div key={r.key} className={n === 0 ? 'opacity-45' : ''}>
                     <BarRow
                        pct={(n / max) * 100}
                        color={r.dot}
                        title={r.hint}
                        lead={
                           <span className="flex w-36 flex-none items-center gap-2">
                              <span
                                 aria-hidden
                                 className="h-2 w-2 flex-none rounded-full"
                                 style={{ background: r.dot }}
                              />
                              <span className="truncate text-ink-2">{r.label}</span>
                           </span>
                        }
                        trail={
                           <span className="w-5 flex-none text-right font-medium text-ink tabular-nums">
                              {n}
                           </span>
                        }
                     />
                  </div>
               );
            })}
         </div>
      </StatsCard>
   );
}
