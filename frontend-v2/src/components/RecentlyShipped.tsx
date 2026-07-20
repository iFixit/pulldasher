import { ago, closedEpoch, pullKey } from '../format';
import { rankShipped, type ShipRelevance, shipRelevance } from '../model/shipped';
import type { PullData } from '../types';
import { Avatar, PullTitleLink, RepoRef } from './bits';

/** How many shipped pulls the panel lists inline before folding the rest into
 * "+N more". Four keeps the catch-up a glance, not a second board. */
const INLINE_CAP = 4;

function RelTag({ rel }: { rel: Exclude<ShipRelevance, null> }) {
   // yours reads loudest (your work shipped); reviewed is a quieter hairline
   return rel === 'yours' ? (
      <span className="flex-none rounded bg-brand-100 px-1.5 py-px text-[11px] font-semibold text-brand-900">
         yours
      </span>
   ) : (
      <span className="flex-none rounded px-1.5 py-px text-[11px] font-medium text-brand-700 ring-1 ring-brand-100 ring-inset">
         reviewed
      </span>
   );
}

function ShippedItem({ pull, me }: { pull: PullData; me: string }) {
   const merged = !!pull.merged_at;
   const rel = shipRelevance(pull, me);
   return (
      <li className="flex items-center gap-2.5 border-t border-brand-100/70 px-3 py-1.5 first:border-t-0 hover:bg-brand-100/50">
         <span
            aria-hidden
            title={merged ? 'merged' : 'closed'}
            className={`h-2 w-2 flex-none rounded-[2px] ${merged ? 'bg-brand' : 'border border-ink-3'}`}
         />
         <Avatar login={pull.user.login} size={18} />
         <span className="min-w-0 flex-1 truncate">
            <PullTitleLink repo={pull.repo} number={pull.number} title={pull.title} />
         </span>
         {rel && <RelTag rel={rel} />}
         <span className="hidden flex-none text-xs sm:block">
            <RepoRef repo={pull.repo} number={pull.number} />
         </span>
         <span className="w-14 flex-none text-right text-xs tabular-nums text-ink-3">
            {ago(closedEpoch(pull))} ago
         </span>
      </li>
   );
}

/**
 * "Shipped while you were away": the catch-up that replaced the bare
 * merged-count banner. Instead of a number that jumps to a fold of dead rows,
 * it names what actually shipped — yours first, then ones you reviewed — each
 * linking to the PR itself. Dismiss (×) marks everything seen now; a long list
 * folds the tail into "see all on the board", where the old jump-to-fold
 * behavior lives on as a secondary.
 */
export function RecentlyShipped({
   shipped,
   me,
   onSeeAll,
   onDismiss,
}: {
   shipped: PullData[];
   me: string;
   /** jump to the board's shipped fold; absent on lenses that have no fold */
   onSeeAll?: () => void;
   onDismiss: () => void;
}) {
   const ranked = rankShipped(shipped, me);
   const visible = ranked.slice(0, INLINE_CAP);
   const overflow = ranked.length - visible.length;
   const yours = ranked.filter(p => shipRelevance(p, me) === 'yours').length;
   const reviewed = ranked.filter(p => shipRelevance(p, me) === 'reviewed').length;
   const breakdown = [yours > 0 && `${yours} yours`, reviewed > 0 && `${reviewed} you reviewed`]
      .filter(Boolean)
      .join(' · ');

   return (
      <div className="mx-auto mt-3 max-w-[1240px] px-5 text-[13px]">
         <div className="notice-inner overflow-hidden rounded-lg border border-brand-100 bg-brand-50">
            <div className="flex items-center gap-2 px-3 py-2">
               <span aria-hidden className="text-brand">
                  ●
               </span>
               <span className="text-brand-900">
                  <b className="font-semibold tabular-nums">{shipped.length}</b> shipped while you
                  were away
               </span>
               {breakdown && <span className="text-brand-700/80">· {breakdown}</span>}
               <button
                  type="button"
                  onClick={onDismiss}
                  aria-label="mark shipped items seen"
                  title="dismiss"
                  className="hit pressable -m-1 ml-auto flex-none rounded p-1 text-brand-700/60 hover:text-brand-900"
               >
                  <svg
                     viewBox="0 0 16 16"
                     className="h-3.5 w-3.5"
                     fill="none"
                     stroke="currentColor"
                     strokeWidth="1.75"
                  >
                     <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                  </svg>
               </button>
            </div>
            <ul className="settle-once border-t border-brand-100">
               {visible.map(p => (
                  <ShippedItem key={pullKey(p)} pull={p} me={me} />
               ))}
            </ul>
            {overflow > 0 &&
               (onSeeAll ? (
                  <button
                     type="button"
                     onClick={onSeeAll}
                     className="pressable block w-full border-t border-brand-100 px-3 py-1.5 text-left text-xs font-medium text-brand-700 hover:bg-brand-100/50"
                  >
                     +{overflow} more — see all on the board →
                  </button>
               ) : (
                  <div className="border-t border-brand-100 px-3 py-1.5 text-xs text-brand-700/70">
                     +{overflow} more
                  </div>
               ))}
         </div>
      </div>
   );
}
