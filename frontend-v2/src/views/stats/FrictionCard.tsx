import type { Friction } from '../../model/stats';
import { StatsCard } from './parts';

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
   { key: 'ciRed', label: 'CI red', dot: 'var(--bad)', hint: 'a required check is failing' },
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
 * "no conflicts" is information.
 */
export function FrictionCard({ friction }: { friction: Friction }) {
   return (
      <StatsCard title="Friction" sub="stuck on something other than review">
         <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 min-[380px]:grid-cols-2">
            {ROWS.map(r => {
               const n = friction[r.key];
               return (
                  <div
                     key={r.key}
                     title={r.hint}
                     className={`flex items-center gap-2 text-[13px] ${n === 0 ? 'opacity-45' : ''}`}
                  >
                     <span
                        aria-hidden
                        className="h-2 w-2 flex-none rounded-full"
                        style={{ background: r.dot }}
                     />
                     <span className="flex-1 text-ink-2">{r.label}</span>
                     <span className="font-medium text-ink tabular-nums">{n}</span>
                  </div>
               );
            })}
         </div>
      </StatsCard>
   );
}
