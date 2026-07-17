import { memo, useState } from 'react';
import type { DerivedPull } from '../model/status';
import { isIterating } from '../model/status';
import { ago, pullKey } from '../format';
import { ackPull, isFresh, refreshPull } from '../store';
import { AgeStamp, Avatar, PullTitleLink, RepoRef, SigPips, StatusBadge, WeightChip } from './bits';
import { CardShell } from './Card';

export interface RowOptions {
   /** hide the status badge when the lane already says it */
   badge?: boolean;
   /** show the open-Nd flag on starved pulls */
   aging?: boolean;
   /**
    * Column mode (Classic): the title owns the space. Drops the cue line,
    * weight chip, and hover actions — a full row's anatomy crushes titles
    * to two letters inside a 340px column. Warning flags stay: conflicts
    * and holds change who acts, and columns are where deployers look.
    */
   compact?: boolean;
   /** suppress the cue line when the view says the same thing beside the row */
   cue?: boolean;
   me: string;
   lastSeen: number;
   /** pull keys opened this session (their fresh dots are cleared) */
   acked: ReadonlySet<string>;
   onPerson?: (login: string) => void;
}

/**
 * A fresh row is a brand-new PR (solid dot) or an updated one (ring), and
 * opening it clears the mark for the session.
 */
function freshKind(p: DerivedPull, opts: RowOptions): 'new' | 'updated' | null {
   if (!isFresh(p.data, opts.lastSeen, opts.acked)) return null;
   return Date.parse(p.data.created_at) / 1000 > opts.lastSeen ? 'new' : 'updated';
}

// The background flash runs once per pull per session, not on every lens
// switch that remounts the row. Recording during render is deliberate: memo
// keeps re-renders rare, and a double-record is harmless.
const flashed = new Set<string>();
function flashOnce(key: string, fresh: boolean): boolean {
   if (!fresh || flashed.has(key)) return false;
   flashed.add(key);
   return true;
}

function cue(p: DerivedPull, me: string): string | null {
   const d = p.data;
   if (p.status === 'needs_recr' && p.recrBy.length) {
      const who = p.recrBy.includes(me) ? 'you' : p.recrBy.join(', ');
      const wait = p.headPushedAt ? ` · fix pushed ${ago(p.headPushedAt)} ago` : '';
      return `CR’d by ${who}${wait}`;
   }
   if (p.status === 'ready') {
      const idle = p.signedOffAt ? `signed off ${ago(p.signedOffAt)} ago, ` : '';
      return `${idle}${d.user.login === me ? 'you' : d.user.login} can merge`;
   }
   if (p.status === 'needs_qa') {
      if (p.qaingBy) return `${p.qaingBy} is QAing`;
      if (p.reqaBy.length) {
         const who = p.reqaBy.includes(me) ? 'your QA stamp' : `${p.reqaBy.join(', ')}’s QA stamp`;
         return `${who} was invalidated by a push`;
      }
      return 'CR done, needs a QA stamp';
   }
   if (p.status === 'ci_pending') return 'signed off, only CI left';
   if (p.status === 'ci_red' && p.ciFailing.length) return `red: ${p.ciFailing.join(', ')}`;
   if (p.status === 'dev_block' && p.devBlockedBy.length)
      return `changes requested by ${p.devBlockedBy.join(', ')}`;
   if (p.status === 'deploy_block' && p.deployBlockedBy.length)
      return `held from deploy by ${p.deployBlockedBy.join(', ')}`;
   if (p.status === 'unmergeable')
      return p.conflict
         ? 'signed off, but conflicts — the author rebases'
         : `based on ${d.base.ref}, lands with its parent`;
   return null;
}

/** Small warning flags that ride along regardless of lane. */
function WarnFlags({ pull, compact }: { pull: DerivedPull; compact?: boolean }) {
   return (
      <>
         {pull.conflict && pull.status !== 'unmergeable' && (
            <span className="flag-amber" role="img" aria-label="merge conflicts with the base branch" title="merge conflicts with the base branch">
               conflicts
            </span>
         )}
         {pull.dependent && pull.status !== 'unmergeable' && (
            <span
               className="flag-amber"
               title={`based on ${pull.data.base.ref}, lands with its parent`}
            >
               {compact ? 'dep' : 'dependent'}
            </span>
         )}
         {pull.deployBlockedBy.length > 0 && pull.status !== 'deploy_block' && (
            <span
               className="flag-amber"
               title={`deploy hold by ${pull.deployBlockedBy.join(', ')}: don't ship without asking`}
            >
               hold
            </span>
         )}
         {pull.mergeUnknown && pull.status === 'ready' && (
            <span className="flag-amber" title="GitHub hasn't confirmed this merges cleanly yet">
               mergeable?
            </span>
         )}
         {!compact && pull.ci === 'pending' && pull.status !== 'ci_pending' && (
            <span className="text-xs text-ink-3" title="CI is still running">
               CI…
            </span>
         )}
         {pull.externalBlock && (
            <span className="flag-amber" title="blocked on something outside the repo">
               {compact ? 'ext' : 'external'}
            </span>
         )}
         {pull.qaingBy && pull.status === 'needs_qa' && (
            <span
               className="flag-qaing"
               title={`${pull.qaingBy} is already testing this (the QAing label)`}
            >
               {compact ? `◉ ${pull.qaingBy}` : `QAing: ${pull.qaingBy}`}
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

/** The CR/QA/age cluster both row variants render, in identical geometry. */
function Ledger({ pull, me }: { pull: DerivedPull; me: string }) {
   const d = pull.data;
   return (
      <>
         <SigPips
            label="CR"
            have={pull.crHave}
            req={d.status.cr_req}
            by={pull.crBy}
            staleBy={pull.recrBy}
            me={me}
            sigs={d.status.allCR}
         />
         <SigPips
            label="QA"
            have={pull.qaHave}
            req={d.status.qa_req}
            by={pull.qaBy}
            staleBy={pull.reqaBy}
            me={me}
            sigs={d.status.allQA}
         />
         <AgeStamp
            ageDays={pull.ageDays}
            updatedAt={Date.parse(d.updated_at) / 1000}
            quiet={['draft', 'dev_block', 'deploy_block'].includes(pull.status)}
         />
      </>
   );
}

/**
 * Column card (Classic): two zones instead of one fought-over line.
 * Zone 1 is identity — avatar plus the title at full text width, so a long
 * title wraps twice instead of five times against a dead metadata column.
 * Zone 2 is one fact line — repo#number, flags, pips, age pushed to the
 * right edge so ages scan as a vertical column down the board.
 */
function CompactCard({ pull, opts }: { pull: DerivedPull; opts: RowOptions }) {
   const d = pull.data;
   const key = pullKey(d);
   const fresh = freshKind(pull, opts);
   return (
      <CardShell
         login={d.user.login}
         onPerson={opts.onPerson}
         repo={d.repo}
         number={d.number}
         title={d.title}
         fresh={fresh}
         onOpen={() => ackPull(key)}
         className={`pd-row ${flashOnce(key, !!fresh) ? 'row-fresh' : ''} transition-[background-color] duration-150 motion-reduce:transition-none`}
         right={
            <>
               <WarnFlags pull={pull} compact />
               <Ledger pull={pull} me={opts.me} />
            </>
         }
      />
   );
}

function RowImpl({ pull, opts }: { pull: DerivedPull; opts: RowOptions }) {
   const d = pull.data;
   const compact = opts.compact === true;
   if (compact) return <CompactCard pull={pull} opts={opts} />;
   const key = pullKey(d);
   const fresh = freshKind(pull, opts);

   const showWeight = pull.sizeKnown && ['needs_cr', 'needs_recr'].includes(pull.status);
   const line = opts.cue === false ? null : cue(pull, opts.me);

   return (
      <div
         className={`pd-row relative flex items-center gap-2.5 border-t border-secondary py-2 pr-3.5 pl-3.5 first:border-t-0 hover:bg-muted ${flashOnce(key, !!fresh) ? 'row-fresh' : ''} transition-[background-color] duration-150 motion-reduce:transition-none`}
      >
         {/* lives in the padding gutter: a changed row must not indent its content */}
         {fresh && (
            <span
               className={`${fresh === 'new' ? 'dot-fresh' : 'dot-updated'} absolute top-1/2 left-[3px] -translate-y-1/2`}
               role="img"
               aria-label={
                  fresh === 'new' ? 'new since your last look' : 'changed since your last look'
               }
               title={fresh === 'new' ? 'new since your last look' : 'changed since your last look'}
            />
         )}
         {opts.badge === false ? null : <StatusBadge status={pull.status} />}
         <Avatar login={d.user.login} onClick={opts.onPerson} />
         {/* the title is how a reviewer decides: never truncate it, wrap instead */}
         <span className="min-w-0 flex-1 text-sm break-words">
            <PullTitleLink
               repo={d.repo}
               number={d.number}
               title={d.title}
               onOpen={() => ackPull(key)}
            />
         </span>
         <RowActions pull={pull} />
         {isIterating(d) && (
            <span className="flag-amber" title="changed in the last 30 min, may still be moving">
               iterating
            </span>
         )}
         {opts.aging && pull.starved && (
            <span
               className="flag-amber"
               title={`open ${pull.ageDays} days without full CR (${pull.crHave} of ${d.status.cr_req})`}
            >
               open {pull.ageDays}d
            </span>
         )}
         <WarnFlags pull={pull} />
         {line && (
            <span
               className="hidden max-w-[300px] flex-none truncate text-xs text-ink-2 min-[860px]:inline"
               title={line}
            >
               {line}
            </span>
         )}
         <span className="flex flex-none items-center gap-2.5 text-xs text-ink-3">
            <RepoRef repo={d.repo} number={d.number} />
            {showWeight && <WeightChip weight={pull.weight} />}
            <Ledger pull={pull} me={opts.me} />
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
      a.opts.aging === b.opts.aging &&
      a.opts.compact === b.opts.compact &&
      a.opts.cue === b.opts.cue &&
      a.opts.me === b.opts.me &&
      a.opts.lastSeen === b.opts.lastSeen &&
      a.opts.acked === b.opts.acked &&
      a.opts.onPerson === b.opts.onPerson
);
