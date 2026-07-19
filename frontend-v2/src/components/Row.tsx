import { memo, useState } from 'react';
import type { DerivedPull } from '../model/status';
import { isIterating, lastPushEpoch } from '../model/status';
import { rowNote } from '../model/actions';
import { ago, epoch, pullKey } from '../format';
import { ackPull, isFresh, refreshPull, snoozePull } from '../store';
import { AgeStamp, DiffSize, FreshTag, RepoRef, SigPips, StatusBadge, WeightMeter } from './bits';
import { CardShell } from './Card';
import { Popover } from './Popover';

export interface RowOptions {
   /** show the open-Nd flag on starved pulls */
   aging?: boolean;
   /** compact density: one-line rows, smaller avatar, tighter spacing */
   compact?: boolean;
   /** rows a lane shows before folding; 0 = no cap. Falls back to the lane's
    * own default when unset (old saved settings). */
   laneCap?: number;
   me: string;
   lastSeen: number;
   /** pull key → epoch secs it was opened (clears the fresh dot until the
    * pull changes again; persisted per-browser) */
   acked: Readonly<Record<string, number>>;
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
   return epoch(p.data.created_at) > opts.lastSeen ? 'new' : 'updated';
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

interface Flag {
   key: string;
   /** 'warn' = act on it (amber); 'note' = a neutral fact (muted) */
   tone: 'warn' | 'note';
   label: string;
   detail: string;
}

/**
 * The row's secondary annotations, gathered in one place: conflicts, stacked,
 * holds, in-flight CI, iterating, aging. They're not the status (the badge is)
 * and not your action (the note is), so they read as quiet colored labels,
 * not badges — amber only for the ones you act on, muted gray for plain facts.
 */
function rowFlags(pull: DerivedPull, showIterating: boolean, aging: boolean): Flag[] {
   const p = pull;
   const flags: Flag[] = [];
   if (p.conflict && p.status !== 'unmergeable')
      flags.push({
         key: 'conflicts',
         tone: 'warn',
         label: 'conflicts',
         detail: 'Merge conflicts with the base branch — the author needs to rebase.',
      });
   if (p.deployBlockedBy.length > 0 && p.status !== 'deploy_block')
      flags.push({
         key: 'deploy-block',
         tone: 'warn',
         label: 'deploy block',
         detail: `${p.deployBlockedBy.join(', ')} put a deploy block on it; don’t ship without asking.`,
      });
   if (p.externalBlock)
      flags.push({
         key: 'external',
         tone: 'warn',
         label: 'external',
         detail: 'Blocked on something outside this repo.',
      });
   if (aging) {
      // the server ships discussion aggregates (newer servers only): an aging
      // PR nobody has even discussed is a different neglect than one debated
      // for a week — say which this is
      const commentCount = p.data.status.comment_count;
      const lastCommentAt = p.data.status.last_comment_at;
      const quiet =
         commentCount == null
            ? ''
            : commentCount === 0
              ? ' No discussion yet.'
              : lastCommentAt
                ? ` Last comment ${ago(epoch(lastCommentAt))} ago.`
                : '';
      flags.push({
         key: 'aging',
         tone: 'warn',
         label: `open ${p.ageDays}d`,
         detail: `Open ${p.ageDays} days without full CR (${p.crHave} of ${p.data.status.cr_req}).${quiet}`,
      });
   }
   if (p.dependent && p.status !== 'unmergeable')
      flags.push({
         key: 'stacked',
         tone: 'note',
         label: 'stacked',
         detail: `Based on ${p.data.base.ref}, not the main branch; it lands with its parent.`,
      });
   if (p.mergeUnknown && p.status === 'ready')
      flags.push({
         key: 'merge',
         tone: 'note',
         label: 'merge check',
         detail: 'GitHub hasn’t confirmed this merges cleanly yet.',
      });
   if (p.ci === 'pending' && p.status !== 'ci_pending')
      flags.push({ key: 'ci', tone: 'note', label: 'CI…', detail: 'CI is still running.' });
   if (showIterating) {
      const pushedAt = lastPushEpoch(p);
      flags.push({
         key: 'iterating',
         tone: 'note',
         label: 'recent changes',
         detail: `Pushed ${ago(pushedAt)} ago; it may still be moving, so hold off.`,
      });
   }
   return flags;
}

/**
 * The flag cluster's drill-down: labels inline for scanning, the plain-
 * English meaning one hover away — the same pattern the CR/QA pips use, so
 * no flag hides its meaning behind a native tooltip. Both densities show the
 * full label list (compact wraps rather than abbreviating); with no flags
 * there's nothing to explain and no trigger to show.
 */
function RowDetails({ flags }: { flags: Flag[] }) {
   if (!flags.length) return null;
   return (
      <Popover
         label="What these flags mean"
         side="right"
         hover
         rootClass="relative inline-flex"
         width="w-max max-w-[300px]"
         panelClass="p-1.5 text-xs"
         trigger={t => (
            <button
               {...t}
               type="button"
               aria-label={`row details: ${flags.map(f => f.label).join(', ')}`}
               className="pd-raise pressable -my-2 inline-flex cursor-default flex-wrap items-center gap-x-2 gap-y-1 rounded px-0.5 py-2 hover:bg-secondary/60"
            >
               {flags.map(f => (
                  <span
                     key={f.key}
                     className={`whitespace-nowrap ${f.tone === 'warn' ? 'flag-warn' : 'flag-note'}`}
                  >
                     {f.label}
                  </span>
               ))}
            </button>
         )}
      >
         {flags.map(f => (
            <span key={f.key} className="flex items-start gap-1.5 px-1 py-[3px]">
               <span
                  aria-hidden
                  className="mt-[5px] h-1.5 w-1.5 flex-none rounded-full"
                  style={{ background: f.tone === 'warn' ? 'var(--warn)' : 'var(--ink-3)' }}
               />
               <span className="text-ink-2">
                  <b className="font-medium text-ink">{f.label}</b> {f.detail}
               </span>
            </span>
         ))}
      </Popover>
   );
}

/**
 * Hover/focus actions: copy the branch name, snooze, re-fetch from GitHub.
 * `overlay` (compact) floats them over the row's tail instead of reserving
 * rail width — .row-actions hides them with visibility, which still takes
 * layout space, and in a narrow column that standing ~70px tax comes straight
 * out of the title.
 */
function RowActions({ pull, overlay }: { pull: DerivedPull; overlay?: boolean }) {
   const [copied, setCopied] = useState(false);
   const [spinning, setSpinning] = useState(false);
   return (
      <span
         className={`row-actions hidden items-center gap-1 min-[720px]:inline-flex ${
            overlay
               ? 'absolute right-full top-1/2 z-10 mr-1 -translate-y-1/2 rounded-md bg-muted px-1'
               : 'flex-none'
         }`}
      >
         <button
            type="button"
            aria-label={`copy branch name ${pull.data.head.ref}`}
            title={`copy branch: ${pull.data.head.ref}`}
            className="pressable rounded border-0 bg-transparent px-1 text-xs text-ink-3 hover:text-brand"
            onClick={() => {
               void navigator.clipboard.writeText(pull.data.head.ref);
               setCopied(true);
               setTimeout(() => setCopied(false), 1200);
            }}
         >
            {copied ? (
               <span className="chip-in" style={{ color: 'var(--ok)' }}>
                  copied
               </span>
            ) : (
               <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 fill-current">
                  <path d="M5 1a1 1 0 0 0-1 1v1H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1a1 1 0 0 0 1-1V4.4L11.6 1H5Zm6 11v1H3V4h1v7a1 1 0 0 0 1 1h6Zm2-2H5V2h5v3h3v5Z" />
               </svg>
            )}
         </button>
         <button
            type="button"
            aria-label="snooze: hide until tomorrow or until it changes"
            title="snooze: hide until tomorrow or until it changes"
            className="pressable rounded border-0 bg-transparent px-1 text-xs text-ink-3 hover:text-brand"
            onClick={() => snoozePull(pullKey(pull.data))}
         >
            <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 fill-current">
               <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm-.75 2v4.06l3.1 1.86.77-1.28-2.37-1.42V4.5h-1.5Z" />
            </svg>
         </button>
         <button
            type="button"
            aria-label="re-fetch this PR from GitHub"
            title="re-fetch this PR from GitHub"
            className="pressable rounded border-0 bg-transparent px-1 text-xs text-ink-3 hover:text-brand"
            onClick={() => {
               refreshPull(pull.data.repo, pull.data.number);
               setSpinning(true);
               setTimeout(() => setSpinning(false), 600);
            }}
         >
            <svg
               viewBox="0 0 16 16"
               aria-hidden
               className={`h-3.5 w-3.5 fill-current ${spinning ? 'spin-once' : ''}`}
            >
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
      <span
         className={`pd-rail pd-raise ml-auto flex flex-none items-center gap-2.5 ${
            opts.compact ? 'relative' : ''
         }`}
      >
         <RowActions pull={pull} overlay={!!opts.compact} />
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
            createdAt={epoch(d.created_at)}
            updatedAt={epoch(d.updated_at)}
            quiet={['draft', 'dev_block', 'deploy_block'].includes(pull.status)}
            warnDays={opts.ageWarnDays}
            rotDays={opts.ageRotDays}
         />
      </span>
   );
}

function RowImpl({ pull, opts }: { pull: DerivedPull; opts: RowOptions }) {
   const d = pull.data;
   const key = pullKey(d);
   const fresh = freshKind(pull, opts);
   // the one action/context line, the same in every lens (model/actions.ts)
   const note = rowNote(pull, opts.me);
   // "iterating" and a "fix pushed …" note say the same thing — don't say it twice
   const showIterating = isIterating(pull) && !note?.text.includes('pushed');
   return (
      <CardShell
         login={d.user.login}
         onPerson={opts.onPerson}
         repo={d.repo}
         number={d.number}
         title={d.title}
         onOpen={() => ackPull(key)}
         compact={opts.compact}
         className={`${flashOnce(key, !!fresh) ? 'row-fresh' : ''} transition-[background-color] duration-150 ease-out motion-reduce:transition-none`}
         meta={
            // the same untruncated meta in both densities — the shell wraps
            // instead of clipping, so no chip ever costs the title its text
            <>
               {fresh && <FreshTag kind={fresh} />}
               {/* your move: the imperative IS the signal, so it leads and the
                   badge (which would only echo it) steps aside. Otherwise the
                   badge names the state and any note just adds who/when. */}
               {note?.tone === 'do' ? (
                  <span className="badge-do">{note.text}</span>
               ) : (
                  <StatusBadge status={pull.status} inline />
               )}
               <RepoRef repo={d.repo} number={d.number} />
               {pull.sizeKnown && (
                  <DiffSize additions={d.additions ?? 0} deletions={d.deletions ?? 0} />
               )}
               {note?.tone === 'wait' && <span className="text-ink-2">{note.text}</span>}
               <RowDetails flags={rowFlags(pull, showIterating, !!opts.aging && pull.starved)} />
            </>
         }
         rail={<MetricRail pull={pull} opts={opts} />}
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
      a.opts.aging === b.opts.aging &&
      a.opts.compact === b.opts.compact &&
      a.opts.me === b.opts.me &&
      a.opts.lastSeen === b.opts.lastSeen &&
      a.opts.acked === b.opts.acked &&
      a.opts.onPerson === b.opts.onPerson &&
      a.opts.ageWarnDays === b.opts.ageWarnDays &&
      a.opts.ageRotDays === b.opts.ageRotDays
);
