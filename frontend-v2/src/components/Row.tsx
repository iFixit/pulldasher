import { memo, useState } from 'react';
import type { DerivedPull } from '../model/status';
import { isIterating } from '../model/status';
import { ago, githubUrl } from '../format';
import { refreshPull } from '../store';
import { Avatar, Pips, RepoRef, StatusBadge, WeightChip } from './bits';

export interface RowOptions {
   /** hide the status badge when the lane already says it */
   badge?: boolean;
   pips?: 'cr' | 'qa' | 'both' | 'none';
   /** show the open-Nd flag on starved pulls */
   aging?: boolean;
   /**
    * Column mode (Board/Classic): the title owns the space. Drops the cue
    * line, warning flags, weight chip, and hover actions — a full row's
    * anatomy crushes titles to two letters inside a 340px column.
    */
   compact?: boolean;
   /** suppress the cue line when the view says the same thing beside the row */
   cue?: boolean;
   me: string;
   lastSeen: number;
   onPerson?: (login: string) => void;
}

function cue(p: DerivedPull, me: string): string | null {
   const d = p.data;
   if (p.status === 'needs_recr' && p.recrBy.length) {
      const who = p.recrBy.includes(me) ? 'you' : p.recrBy.join(', ');
      const wait = p.headPushedAt ? ` · fix pushed ${ago(p.headPushedAt)} ago` : '';
      return `CR’d by ${who}${wait}`;
   }
   if (p.status === 'ready')
      return `signed off and green, ${d.user.login === me ? 'you' : d.user.login} can merge`;
   if (p.status === 'needs_qa')
      return p.qaingBy ? `${p.qaingBy} is QAing` : 'CR done, needs a QA stamp';
   if (p.status === 'ci_pending') return 'signed off, only CI left';
   if (p.status === 'blocked' && p.blockedBy.length) return `blocked by ${p.blockedBy.join(', ')}`;
   return null;
}

/** Small warning flags that ride along regardless of lane. */
function WarnFlags({ pull }: { pull: DerivedPull }) {
   return (
      <>
         {pull.conflict && (
            <span className="flag-amber" title="merge conflicts with the base branch">
               conflicts
            </span>
         )}
         {pull.dependent && (
            <span
               className="flag-amber"
               title={`based on ${pull.data.base.ref}, lands with its parent`}
            >
               dependent
            </span>
         )}
         {pull.mergeUnknown && pull.status === 'ready' && (
            <span className="flag-amber" title="GitHub hasn't confirmed this merges cleanly yet">
               mergeable?
            </span>
         )}
         {pull.ci === 'pending' && pull.status !== 'ci_pending' && (
            <span className="text-xs text-ink-3" title="CI is still running">
               CI…
            </span>
         )}
         {pull.externalBlock && (
            <span className="flag-amber" title="blocked on something outside the repo">
               external
            </span>
         )}
         {pull.qaingBy && pull.status === 'needs_qa' && (
            <span
               className="flag-qaing"
               title={`${pull.qaingBy} is already testing this (the QAing label)`}
            >
               QAing: {pull.qaingBy}
            </span>
         )}
      </>
   );
}

/** Hover/focus actions: copy the branch name, re-fetch from GitHub. */
function RowActions({ pull }: { pull: DerivedPull }) {
   const [copied, setCopied] = useState(false);
   return (
      <span className="row-actions hidden flex-none items-center gap-1 min-[860px]:inline-flex">
         <button
            type="button"
            aria-label={`copy branch name ${pull.data.head.ref}`}
            title={`copy branch: ${pull.data.head.ref}`}
            className="rounded border-0 bg-transparent px-1 text-xs text-ink-3 hover:text-brand"
            onClick={() => {
               void navigator.clipboard.writeText(pull.data.head.ref);
               setCopied(true);
               setTimeout(() => setCopied(false), 1200);
            }}
         >
            {copied ? (
               '✓'
            ) : (
               <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 fill-current">
                  <path d="M5 1a1 1 0 0 0-1 1v1H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1a1 1 0 0 0 1-1V4.4L11.6 1H5Zm6 11v1H3V4h1v7a1 1 0 0 0 1 1h6Zm2-2H5V2h5v3h3v5Z" />
               </svg>
            )}
         </button>
         <button
            type="button"
            aria-label="re-fetch this PR from GitHub"
            title="re-fetch this PR from GitHub"
            className="rounded border-0 bg-transparent px-1 text-xs text-ink-3 hover:text-brand"
            onClick={() => refreshPull(pull.data.repo, pull.data.number)}
         >
            <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 fill-current">
               <path d="M8 3a5 5 0 1 0 4.9 6h-1.55A3.5 3.5 0 1 1 8 4.5c.97 0 1.85.4 2.48 1.02L8.5 7.5H13V3l-1.46 1.46A4.98 4.98 0 0 0 8 3Z" />
            </svg>
         </button>
      </span>
   );
}

/**
 * Column card (Board/Classic): two zones instead of one fought-over line.
 * Zone 1 is identity — avatar plus the title at full text width, so a long
 * title wraps twice instead of five times against a dead metadata column.
 * Zone 2 is one fact line — repo#number, pips, age pushed to the right edge
 * so ages scan as a vertical column down the board.
 */
function CompactCard({ pull, opts }: { pull: DerivedPull; opts: RowOptions }) {
   const d = pull.data;
   const fresh = Date.parse(d.updated_at) / 1000 > opts.lastSeen;
   const pips = opts.pips ?? 'both';
   const staleCr = pull.recrBy.length > 0;
   return (
      <div
         className={`pd-row relative flex items-start gap-2.5 border-t border-secondary px-4 py-2.5 first:border-t-0 hover:bg-muted ${fresh ? 'row-fresh' : ''} transition-[background-color] duration-150 motion-reduce:transition-none`}
      >
         {/* lives in the padding gutter: a changed card must not indent its content */}
         {fresh && (
            <span
               className="dot-fresh absolute top-4 left-[5px]"
               title="changed since your last look"
            />
         )}
         <span className="mt-px flex-none">
            <Avatar login={d.user.login} onClick={opts.onPerson} />
         </span>
         <span className="min-w-0 flex-1">
            <span className="block text-sm leading-snug break-words">
               <a
                  className="font-medium hover:underline hover:underline-offset-2"
                  href={githubUrl(d.repo, d.number)}
                  target="_blank"
                  rel="noopener noreferrer"
               >
                  {d.title}
               </a>
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-ink-3">
               <RepoRef repo={d.repo} number={d.number} />
               <span className="ml-auto inline-flex items-center gap-2.5">
                  {pull.qaingBy && pull.status === 'needs_qa' && (
                     <span className="flag-qaing" title={`${pull.qaingBy} is already testing this`}>
                        ◉
                     </span>
                  )}
                  {(pips === 'cr' || pips === 'both') && (
                     <Pips label="CR" have={pull.crHave} req={d.status.cr_req} stale={staleCr} />
                  )}
                  {(pips === 'qa' || pips === 'both') && (
                     <Pips label="QA" have={pull.qaHave} req={d.status.qa_req} />
                  )}
                  <span
                     className="w-7 text-right tabular-nums"
                     title={`opened ${pull.ageDays} ${pull.ageDays === 1 ? 'day' : 'days'} ago`}
                  >
                     {pull.ageDays}d
                  </span>
               </span>
            </span>
         </span>
      </div>
   );
}

function RowImpl({ pull, opts }: { pull: DerivedPull; opts: RowOptions }) {
   const d = pull.data;
   const compact = opts.compact === true;
   const fresh = Date.parse(d.updated_at) / 1000 > opts.lastSeen;
   const pips = opts.pips ?? 'both';
   if (compact) return <CompactCard pull={pull} opts={opts} />;

   const showWeight = pull.sizeKnown && ['needs_cr', 'needs_recr'].includes(pull.status);
   const staleCr = pull.recrBy.length > 0;
   const line = opts.cue === false ? null : cue(pull, opts.me);

   return (
      <div
         className={`pd-row relative flex items-center gap-2.5 border-t border-secondary py-2 pr-3.5 pl-3.5 first:border-t-0 hover:bg-muted ${fresh ? 'row-fresh' : ''} transition-[background-color] duration-150 motion-reduce:transition-none`}
      >
         {/* lives in the padding gutter: a changed row must not indent its content */}
         {fresh && (
            <span
               className="dot-fresh absolute top-1/2 left-[3px] -translate-y-1/2"
               title="changed since your last look"
            />
         )}
         {opts.badge === false ? null : <StatusBadge status={pull.status} />}
         <Avatar login={d.user.login} onClick={opts.onPerson} />
         {/* the title is how a reviewer decides: never truncate it, wrap instead */}
         <span className="min-w-0 flex-1 text-sm break-words">
            <a
               className="font-medium hover:underline hover:underline-offset-2"
               href={githubUrl(d.repo, d.number)}
               target="_blank"
               rel="noopener noreferrer"
            >
               {d.title}
            </a>
         </span>
         <RowActions pull={pull} />
         {isIterating(d) && (
            <span className="flag-amber" title="changed in the last 30 min, may still be moving">
               iterating
            </span>
         )}
         {opts.aging && pull.starved && (
            <span className="flag-amber" title={`open ${pull.ageDays} days with no CR stamp yet`}>
               open {pull.ageDays}d
            </span>
         )}
         <WarnFlags pull={pull} />
         {line && (
            <span className="hidden max-w-[300px] flex-none truncate text-xs text-ink-2 min-[860px]:inline">
               {line}
            </span>
         )}
         <span className="flex flex-none items-center gap-2.5 text-xs text-ink-3">
            <RepoRef repo={d.repo} number={d.number} />
            {showWeight && <WeightChip weight={pull.weight} />}
            {(pips === 'cr' || pips === 'both') && (
               <Pips label="CR" have={pull.crHave} req={d.status.cr_req} stale={staleCr} />
            )}
            {(pips === 'qa' || pips === 'both') && (
               <Pips label="QA" have={pull.qaHave} req={d.status.qa_req} />
            )}
            <span
               className="w-7 text-right tabular-nums"
               title={`opened ${pull.ageDays} ${pull.ageDays === 1 ? 'day' : 'days'} ago`}
            >
               {pull.ageDays}d
            </span>
         </span>
      </div>
   );
}

/**
 * Rows re-render only when their pull is re-derived (the store caches
 * derive() per PullData reference) or an option actually changes — a burst
 * of pullChange events must not reconcile 180 untouched rows.
 */
export const Row = memo(
   RowImpl,
   (a, b) =>
      a.pull === b.pull &&
      a.opts.badge === b.opts.badge &&
      a.opts.pips === b.opts.pips &&
      a.opts.aging === b.opts.aging &&
      a.opts.compact === b.opts.compact &&
      a.opts.cue === b.opts.cue &&
      a.opts.me === b.opts.me &&
      a.opts.lastSeen === b.opts.lastSeen &&
      a.opts.onPerson === b.opts.onPerson
);
