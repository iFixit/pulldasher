import type { PullData } from '../types';
import { ago } from '../format';
import { Avatar, PullTitleLink, RepoRef } from './bits';

/**
 * Full-width row: the badge, avatar, and right cluster are all flex-none, so
 * inside a narrow column the title gets ~0px and wraps one character per
 * line. Columns must use a compact two-zone card instead (Classic's
 * ClosedCard).
 */
export function ClosedRow({ pull, lastSeen }: { pull: PullData; lastSeen?: number }) {
   const merged = !!pull.merged_at;
   const closedAt = Date.parse(pull.closed_at ?? pull.updated_at) / 1000;
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
         <span
            className={`badge ${merged ? 'badge-ready' : 'badge-cr'}`}
            title={merged ? 'merged' : 'closed without merging'}
         >
            {merged ? 'Merged' : 'Closed'}
         </span>
         <Avatar login={pull.user.login} />
         <span className="min-w-0 flex-1 text-sm break-words">
            <PullTitleLink repo={pull.repo} number={pull.number} title={pull.title} />
         </span>
         <span className="flex flex-none items-center gap-2.5 text-xs whitespace-nowrap text-ink-3">
            <RepoRef repo={pull.repo} number={pull.number} />
            <span className="w-16 text-right tabular-nums">{ago(closedAt)} ago</span>
         </span>
      </div>
   );
}
