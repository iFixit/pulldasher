import type { PullData } from '../types';
import { ago, closedEpoch } from '../format';
import { Avatar, ClosedBadge, PullTitleLink, RepoRef } from './bits';

/**
 * Full-width row: the badge, avatar, and right cluster are all flex-none, so
 * inside a narrow column the title gets ~0px and wraps one character per
 * line. Columns must use a compact two-zone card instead (Classic's
 * ClosedCard).
 */
export function ClosedRow({ pull, lastSeen }: { pull: PullData; lastSeen?: number }) {
   const merged = !!pull.merged_at;
   const closedAt = closedEpoch(pull);
   const fresh = lastSeen != null && closedAt > lastSeen;
   return (
      <div className="pd-row relative flex items-center gap-2.5 border-t border-secondary py-2 pr-3.5 pl-[11px] first:border-t-0 hover:bg-muted">
         {fresh && (
            <span
               className="dot-fresh absolute top-1/2 left-[3px] -translate-y-1/2"
               role="img"
               aria-label={`${merged ? 'merged' : 'closed'} since your last look`}
               title={`${merged ? 'merged' : 'closed'} since your last look`}
            />
         )}
         <ClosedBadge merged={merged} />
         <span className="pd-raise flex-none">
            <Avatar login={pull.user.login} />
         </span>
         <span className="min-w-0 flex-1 text-sm break-words">
            <PullTitleLink repo={pull.repo} number={pull.number} title={pull.title} stretch />
         </span>
         <span className="pd-raise flex flex-none items-center gap-2.5 text-xs whitespace-nowrap text-ink-3">
            <RepoRef repo={pull.repo} number={pull.number} />
            <span className="w-16 text-right tabular-nums">{ago(closedAt)} ago</span>
         </span>
      </div>
   );
}
