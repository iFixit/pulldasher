import { memo, useState, type ReactNode } from 'react';
import type { DerivedPull } from '../model/status';
import { isIterating } from '../model/status';
import { ago, pullKey } from '../format';
import { ackPull, isFresh, refreshPull } from '../store';
import { AgeStamp, DiffSize, FreshTag, RepoRef, SigPips, StatusBadge, WeightMeter } from './bits';
import { CardShell } from './Card';

export interface RowOptions {
   /** hide the status badge when the lane already says it */
   badge?: boolean;
   /** show the open-Nd flag on starved pulls */
   aging?: boolean;
   /** suppress the cue line when the view says the same thing beside the row */
   cue?: boolean;
   me: string;
   lastSeen: number;
   /** pull keys opened this session (their fresh dots are cleared) */
   acked: ReadonlySet<string>;
   onPerson?: (login: string) => void;
   /** age-color thresholds from user settings (fall back to the model's) */
   ageWarnDays?: number;
   ageRotDays?: number;
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

/** A login that can't blow out the meta line. */
function Who({ login }: { login: string }) {
   return (
      <span className="inline-block max-w-[10ch] truncate align-bottom" title={login}>
         {login}
      </span>
   );
}

/** Small warning flags that ride along regardless of lane. */
function WarnFlags({ pull }: { pull: DerivedPull }) {
   return (
      <>
         {pull.conflict && pull.status !== 'unmergeable' && (
            <span
               className="flag-amber"
               role="img"
               aria-label="merge conflicts with the base branch"
               title="merge conflicts with the base branch"
            >
               conflicts
            </span>
         )}
         {pull.dependent && pull.status !== 'unmergeable' && (
            <span
               className="flag-amber"
               title={`based on ${pull.data.base.ref}, lands with its parent`}
            >
               dependent
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
         {pull.ci === 'pending' && pull.status !== 'ci_pending' && (
            <span className="text-ink-3" title="CI is still running">
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
               className="flag-qaing inline-flex items-center gap-0.5"
               title={`${pull.qaingBy} is already testing this (the QAing label)`}
            >
               QAing: <Who login={pull.qaingBy} />
            </span>
         )}
      </>
   );
}

/** Hover/focus actions: copy the branch name, re-fetch from GitHub. */
function RowActions({ pull }: { pull: DerivedPull }) {
   const [copied, setCopied] = useState(false);
   return (
      <span className="row-actions hidden flex-none items-center gap-1 min-[720px]:inline-flex">
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
               <span style={{ color: 'var(--ok)' }}>copied</span>
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
 * The metric rail every row ends on, in one order everywhere: how heavy to
 * review, then the CR and QA sign-off pips, then age. Right-anchored and
 * fixed-geometry, so it reads as vertical columns down any lens. Raised above
 * the card's click layer so the sign-off popovers still open.
 */
function MetricRail({ pull, opts }: { pull: DerivedPull; opts: RowOptions }) {
   const d = pull.data;
   const me = opts.me;
   return (
      <span className="pd-raise ml-auto flex flex-none items-center gap-2.5">
         <RowActions pull={pull} />
         <WeightMeter weight={pull.weight} known={pull.sizeKnown} />
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
            createdAt={Date.parse(d.created_at) / 1000}
            updatedAt={Date.parse(d.updated_at) / 1000}
            quiet={['draft', 'dev_block', 'deploy_block'].includes(pull.status)}
            warnDays={opts.ageWarnDays}
            rotDays={opts.ageRotDays}
         />
      </span>
   );
}

function RowImpl({
   pull,
   opts,
   note,
   noteTone,
}: {
   pull: DerivedPull;
   opts: RowOptions;
   /** a lane-supplied phrase for the context slot (verb, or who to nudge) */
   note?: ReactNode;
   /** 'do' = your action (brand), 'wait' = a nudge note (muted) */
   noteTone?: 'do' | 'wait';
}) {
   const d = pull.data;
   const key = pullKey(d);
   const fresh = freshKind(pull, opts);
   const context = note ?? (opts.cue === false ? null : cue(pull, opts.me));

   return (
      <CardShell
         login={d.user.login}
         onPerson={opts.onPerson}
         repo={d.repo}
         number={d.number}
         title={d.title}
         onOpen={() => ackPull(key)}
         className={`${flashOnce(key, !!fresh) ? 'row-fresh' : ''} transition-[background-color] duration-150 motion-reduce:transition-none`}
         meta={
            <>
               {fresh && <FreshTag kind={fresh} />}
               {opts.badge === false ? null : <StatusBadge status={pull.status} inline />}
               <RepoRef repo={d.repo} number={d.number} />
               {pull.sizeKnown && (
                  <DiffSize additions={d.additions ?? 0} deletions={d.deletions ?? 0} />
               )}
               {context != null && (
                  <span
                     className={`max-w-[38ch] truncate ${
                        noteTone === 'do' ? 'font-semibold text-brand-700' : 'text-ink-2'
                     }`}
                     title={typeof context === 'string' ? context : undefined}
                  >
                     {context}
                  </span>
               )}
               {isIterating(d) && (
                  <span
                     className="flag-amber"
                     title="changed in the last 30 min, may still be moving"
                  >
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
               <MetricRail pull={pull} opts={opts} />
            </>
         }
      />
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
      a.note === b.note &&
      a.noteTone === b.noteTone &&
      a.opts.badge === b.opts.badge &&
      a.opts.aging === b.opts.aging &&
      a.opts.cue === b.opts.cue &&
      a.opts.me === b.opts.me &&
      a.opts.lastSeen === b.opts.lastSeen &&
      a.opts.acked === b.opts.acked &&
      a.opts.onPerson === b.opts.onPerson &&
      a.opts.ageWarnDays === b.opts.ageWarnDays &&
      a.opts.ageRotDays === b.opts.ageRotDays
);
