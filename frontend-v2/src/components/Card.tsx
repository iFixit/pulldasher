import type { ReactNode } from 'react';
import { Avatar, PullTitleLink, RepoRef } from './bits';

/**
 * The two-zone column card: identity (avatar + full-width wrapping title)
 * over one fact line (repo #number left, a right-anchored cluster). Every
 * card that lives in a narrow column composes this shell; only the right
 * cluster differs per variant, so the ledger geometry stays identical.
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
   right,
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
   right: ReactNode;
}) {
   return (
      <div
         className={`relative flex items-start gap-2.5 border-t border-secondary px-4 py-2.5 first:border-t-0 hover:bg-muted ${className}`}
      >
         {/* lives in the padding gutter: a changed card must not indent its content */}
         {fresh && (
            <span
               className={`${fresh === 'new' ? 'dot-fresh' : 'dot-updated'} absolute top-4 left-[5px]`}
               role="img"
               aria-label={
                  fresh === 'new' ? 'new since your last look' : 'changed since your last look'
               }
               title={fresh === 'new' ? 'new since your last look' : 'changed since your last look'}
            />
         )}
         <span className="mt-px flex-none">
            <Avatar login={login} onClick={onPerson} />
         </span>
         <span className="min-w-0 flex-1">
            <span className="block text-sm leading-snug break-words">
               <PullTitleLink repo={repo} number={number} title={title} onOpen={onOpen} />
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-ink-3">
               <RepoRef repo={repo} number={number} />
               <span className="ml-auto inline-flex items-center gap-2.5">{right}</span>
            </span>
         </span>
      </div>
   );
}
