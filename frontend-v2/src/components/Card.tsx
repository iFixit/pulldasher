import type { ReactNode } from 'react';
import { Avatar, PullTitleLink } from './bits';

/**
 * The one row every lens renders: identity on top (avatar + full-width
 * wrapping title), one meta line below (repo, context, flags, and a
 * right-anchored metric rail). Giving the title its own line is what lets a
 * long title wrap cleanly instead of fighting a dozen metadata chips, and
 * what lets the whole thing reflow to a phone. The meta content is the
 * caller's — only the shell (and its geometry) is shared, so the rail lands
 * at the same x down the board in every lens.
 *
 * The title link stretches over the whole card (`stretch`), so a click
 * anywhere opens the PR; genuinely interactive children opt back out with
 * `.pd-raise`.
 */
export function CardShell({
   login,
   onPerson,
   repo,
   number,
   title,
   fresh,
   onOpen,
   className = '',
   meta,
   stretch = true,
}: {
   login: string;
   onPerson?: (login: string) => void;
   repo: string;
   number: number;
   title: string;
   /** 'new' = opened since your last look (solid dot); 'updated' = changed (ring) */
   fresh?: 'new' | 'updated' | null;
   onOpen?: () => void;
   className?: string;
   /** the whole meta line: badge, repo#number, context, flags, metric rail */
   meta: ReactNode;
   stretch?: boolean;
}) {
   return (
      <div
         className={`pd-row relative flex items-start gap-2.5 border-t border-secondary px-3.5 py-2 first:border-t-0 hover:bg-muted ${className}`}
      >
         {/* lives in the padding gutter: a changed card must not indent its content */}
         {fresh && (
            <span
               className={`${fresh === 'new' ? 'dot-fresh' : 'dot-updated'} absolute top-3.5 left-[5px]`}
               role="img"
               aria-label={
                  fresh === 'new' ? 'new since your last look' : 'changed since your last look'
               }
               title={fresh === 'new' ? 'new since your last look' : 'changed since your last look'}
            />
         )}
         <span className="pd-raise mt-px flex-none">
            <Avatar login={login} onClick={onPerson} />
         </span>
         <span className="min-w-0 flex-1">
            <span className="block text-sm leading-snug break-words">
               <PullTitleLink
                  repo={repo}
                  number={number}
                  title={title}
                  onOpen={onOpen}
                  stretch={stretch}
               />
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
               {meta}
            </span>
         </span>
      </div>
   );
}
