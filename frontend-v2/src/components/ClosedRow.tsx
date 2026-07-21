import { memo } from 'react';
import type { PullData } from '../types';
import { ago, closedEpoch } from '../format';
import { Avatar, PullTitleLink, RepoRef } from './bits';
import { ClosedBadgeTrigger } from './StatePopover';

/**
 * Full-width receipt row. The badge + avatar are flex-none; everything else
 * lives in ONE flexible min-w-0 column — title on top, a muted repo · age line
 * under it — so nothing competes with the title for width. The old layout kept
 * the repo ref + age in a flex-none whitespace-nowrap cluster on the right,
 * which on a phone starved the title to ~0px and stacked it one char per line.
 * Memoized like Row: closed rows live in folds that re-render with every
 * publish, but a closed pull's data never changes again.
 */
export const ClosedRow = memo(function ClosedRow({
   pull,
   lastSeen,
}: {
   pull: PullData;
   lastSeen?: number;
}) {
   const merged = !!pull.merged_at;
   const closedAt = closedEpoch(pull);
   const fresh = lastSeen != null && closedAt > lastSeen;
   return (
      <div className="pd-row relative flex items-center gap-2.5 border-t border-secondary py-2 pr-3.5 pl-[11px] transition-[background-color] duration-150 ease-out first:border-t-0 hover:bg-muted motion-reduce:transition-none">
         {fresh && (
            <span
               className="dot-fresh absolute top-1/2 left-[3px] -translate-y-1/2"
               role="img"
               aria-label={`${merged ? 'merged' : 'closed'} since your last look`}
               title={`${merged ? 'merged' : 'closed'} since your last look`}
            />
         )}
         <span className="flex-none">
            <ClosedBadgeTrigger pull={pull} />
         </span>
         <span className="flex-none">
            <Avatar login={pull.user.login} />
         </span>
         <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm">
               <PullTitleLink repo={pull.repo} number={pull.number} title={pull.title} stretch />
            </span>
            <span className="flex items-center gap-2 text-xs whitespace-nowrap text-ink-3">
               <RepoRef repo={pull.repo} number={pull.number} />
               <span className="tabular-nums">{ago(closedAt)} ago</span>
            </span>
         </span>
      </div>
   );
});
