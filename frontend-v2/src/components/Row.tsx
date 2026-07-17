import { useState } from 'react';
import type { DerivedPull } from '../model/status';
import { isIterating } from '../model/status';
import { ago, githubUrl, shortRepo } from '../format';
import { refreshPull } from '../store';
import { Avatar, Heat, Pips, StatusBadge, WeightChip } from './bits';

export interface RowOptions {
   /** hide the status badge when the lane already says it */
   badge?: boolean;
   pips?: 'cr' | 'qa' | 'both' | 'none';
   /** show the waiting-Nd flag on starved pulls */
   aging?: boolean;
   /** skip the cooldown dimming (own PRs, folded sections) */
   noDim?: boolean;
   me: string;
   lastSeen: number;
   onPerson?: (login: string) => void;
}

function cue(p: DerivedPull, me: string): string | null {
   const d = p.data;
   if (p.status === 'needs_recr' && p.recrBy.length) {
      const who = p.recrBy.includes(me) ? 'you' : p.recrBy.join(', ');
      const wait = p.headPushedAt ? ` · fix waiting ${ago(p.headPushedAt)}` : '';
      return `CR’d by ${who}${wait}`;
   }
   if (p.status === 'ready')
      return `CR✓ QA✓ green: ${d.user.login === me ? 'your' : `${d.user.login}’s`} merge button`;
   if (p.status === 'needs_qa')
      return p.qaingBy ? `${p.qaingBy} is QAing` : 'CR✓, author drives QA';
   if (p.status === 'ci_pending') return 'signed off, waiting on CI';
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
            <span className="flag-qaing" title={`${pull.qaingBy} is already testing this`}>
               ◉ {pull.qaingBy}
            </span>
         )}
      </>
   );
}

/** Hover actions: re-fetch from GitHub, copy the branch name. */
function RowActions({ pull }: { pull: DerivedPull }) {
   const [copied, setCopied] = useState(false);
   return (
      <span className="row-actions hidden flex-none items-center gap-1 min-[860px]:inline-flex">
         <button
            type="button"
            title={`copy branch: ${pull.data.head.ref}`}
            className="rounded border-0 bg-transparent px-1 text-xs text-ink-3 hover:text-brand"
            onClick={() => {
               void navigator.clipboard.writeText(pull.data.head.ref);
               setCopied(true);
               setTimeout(() => setCopied(false), 1200);
            }}
         >
            {copied ? '✓' : '⎘'}
         </button>
         <button
            type="button"
            title="re-fetch this pull from GitHub"
            className="rounded border-0 bg-transparent px-1 text-xs text-ink-3 hover:text-brand"
            onClick={() => refreshPull(pull.data.repo, pull.data.number)}
         >
            ↻
         </button>
      </span>
   );
}

export function Row({ pull, opts }: { pull: DerivedPull; opts: RowOptions }) {
   const d = pull.data;
   const iterating = isIterating(d);
   const fresh = Date.parse(d.updated_at) / 1000 > opts.lastSeen;
   const pips = opts.pips ?? 'both';
   const showWeight = ['needs_cr', 'needs_recr'].includes(pull.status);
   const staleCr = pull.recrBy.length > 0;
   const line = cue(pull, opts.me);

   return (
      <div
         className={`pd-row flex items-center gap-2.5 border-t border-secondary border-l-[3px] border-l-transparent py-2 pr-3.5 pl-[11px] first:border-t-0 hover:bg-muted ${fresh ? 'row-fresh' : ''} ${iterating && !opts.noDim ? 'opacity-60' : ''} transition-[background-color,opacity] duration-150 motion-reduce:transition-none`}
      >
         {opts.badge === false ? null : <StatusBadge status={pull.status} />}
         <Avatar login={d.user.login} onClick={opts.onPerson} />
         <span className="min-w-0 flex-1 truncate text-sm">
            <span className="mr-1.5 text-xs text-ink-3">
               {shortRepo(d.repo)}#{d.number}
            </span>
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
         {iterating && (
            <span
               className="flag-amber"
               title="author active in the last 30 min, may still be pushing"
            >
               iterating
            </span>
         )}
         {opts.aging && pull.starved && <span className="flag-amber">waiting {pull.ageDays}d</span>}
         <WarnFlags pull={pull} />
         {line && (
            <span className="hidden max-w-[300px] flex-none truncate text-xs text-ink-2 min-[860px]:inline">
               {line}
            </span>
         )}
         <span className="flex flex-none items-center gap-2.5 text-xs text-ink-3">
            {showWeight && <WeightChip weight={pull.weight} />}
            {(pips === 'cr' || pips === 'both') && (
               <Pips label="CR" have={pull.crHave} req={d.status.cr_req} stale={staleCr} />
            )}
            {(pips === 'qa' || pips === 'both') && (
               <Pips label="QA" have={pull.qaHave} req={d.status.qa_req} />
            )}
            <span className="tabular-nums">
               <span className="text-ok">+{d.additions ?? '?'}</span>{' '}
               <span className="text-bad">−{d.deletions ?? '?'}</span>
            </span>
            <Heat days={pull.ageDays} />
         </span>
      </div>
   );
}
