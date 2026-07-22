import { useState } from 'react';
import type { ButtonHTMLAttributes, KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
   type DerivedPull,
   headStatuses,
   ROT_DAYS,
   STARVE_DAYS,
   type Status,
   type Weight,
   weightRank,
} from '../model/status';
import type { CommitStatus, Signature } from '../types';
import {
   ago,
   epoch,
   githubAvatarUrl,
   githubProfileUrl,
   githubUrl,
   loginHue,
   n,
   shortRepo,
   signatureUrl,
} from '../format';
import { getSettings } from '../settings';
import { Popover } from './Popover';

export const STATUS_LABEL: Record<Status, string> = {
   ready: 'Ready to merge',
   // only at the ready gate: fully signed off, nothing left but a green build.
   // 'CI running' would lie — a needs-CR pull can have CI running too.
   ci_pending: 'Only CI left',
   needs_recr: 'Needs re-CR',
   needs_qa: 'Needs QA',
   needs_cr: 'Needs CR',
   // the old "Blocked" wore one badge for three opposite situations; each
   // now says whose move it is
   dev_block: 'Dev blocked',
   deploy_block: 'Deploy block',
   unmergeable: 'Can’t merge',
   ci_red: 'CI red',
   draft: 'Draft',
};

// ci_pending / dev_block / unmergeable used to share amber, which made
// "only CI left" (benign, nearly done) look as urgent as "dev blocked" (you
// owe feedback). Three distinct tones now: calm slate for the CI wait, amber
// for the action-owed dev block, gray for the git-conflict rebase.
const STATUS_CLASS: Record<Status, string> = {
   ready: 'badge-ready',
   ci_pending: 'badge-slate',
   needs_recr: 'badge-recr',
   needs_qa: 'badge-qa',
   needs_cr: 'badge-cr',
   dev_block: 'badge-blocked',
   deploy_block: 'badge-hold',
   unmergeable: 'badge-hold',
   ci_red: 'badge-red',
   draft: 'badge-draft',
};

export const STATUS_DOT: Record<Status, string> = {
   ready: 'var(--ok)',
   ci_pending: 'var(--slate)',
   needs_recr: 'var(--brand)',
   needs_qa: 'var(--violet)',
   needs_cr: 'var(--ink-3)',
   dev_block: 'var(--warn)',
   deploy_block: 'var(--ink-3)',
   unmergeable: 'var(--ink-3)',
   ci_red: 'var(--bad)',
   draft: 'var(--border)',
};

/**
 * The quiet outlined button the settings surfaces share — one definition so a
 * radius or hover tweak lands everywhere. sm = inline row actions (mute,
 * unmute), md = standalone panel actions. tone='brand' for the affirmative
 * variant ("Show for me").
 */
export function QuietButton({
   size = 'sm',
   tone = 'default',
   ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
   size?: 'sm' | 'md';
   tone?: 'default' | 'brand';
}) {
   const shape =
      size === 'sm'
         ? 'rounded-md px-2 py-0.5 text-xs'
         : 'inline-flex h-8 items-center rounded-lg px-3 text-[13px]';
   const text = tone === 'brand' ? 'text-brand' : 'text-ink-2';
   return (
      <button
         type="button"
         className={`hit pressable border border-line bg-surface font-medium disabled:opacity-40 ${shape} ${text} hover:text-brand`}
         {...props}
      />
   );
}

export function StatusBadge({ status, inline }: { status: Status; inline?: boolean }) {
   return (
      <span className={`badge ${STATUS_CLASS[status]} ${inline ? 'badge-inline' : ''}`}>
         {STATUS_LABEL[status]}
      </span>
   );
}

/**
 * Merged/closed state as a pill, in the same badge vocabulary StatusBadge uses
 * for every open state — so a closed pull reads with the same grammar as an
 * open one instead of the ad-hoc colored text the board used to show.
 */
export function ClosedBadge({ merged, inline }: { merged: boolean; inline?: boolean }) {
   return (
      <span
         className={`badge ${merged ? 'badge-ready' : 'badge-cr'} ${inline ? 'badge-inline' : ''}`}
         title={merged ? 'merged' : 'closed without merging'}
      >
         {merged ? 'Merged' : 'Closed'}
      </span>
   );
}

/**
 * The "changed since your last look" marker, spelled out instead of left as a
 * gutter dot you had to decode: a solid brand chip for a brand-new PR, a brand
 * outline for one that merely changed. Opening the PR clears it for the
 * session.
 */
export function FreshTag({ kind }: { kind: 'new' | 'updated' }) {
   const isNew = kind === 'new';
   return (
      <span
         className={`chip-in flex-none rounded-lg px-[7px] py-[2px] text-[11px] font-semibold ${
            isNew ? 'bg-brand text-white' : 'text-brand-700 shadow-[inset_0_0_0_1px_var(--brand)]'
         }`}
         title={isNew ? 'new since your last look' : 'updated since your last look'}
      >
         {isNew ? 'new' : 'updated'}
      </span>
   );
}

export function Avatar({
   login,
   size = 22,
   onClick,
}: {
   login: string;
   size?: number;
   onClick?: (login: string) => void;
}) {
   // OKLCH holds perceived lightness constant across the hue wheel — the
   // old hsl(h 45% 45%) made yellow-green logins illegible under white text
   const style = {
      background: `oklch(0.48 0.09 ${loginHue(login)})`,
      width: size,
      height: size,
      fontSize: Math.round(size * 0.42),
   };
   const cls =
      'inline-flex flex-none items-center justify-center rounded-full font-semibold uppercase text-white transition-[scale] duration-150 ease-out motion-reduce:transition-none';
   return onClick ? (
      <button
         type="button"
         // .hit: the circle is 16-22px, under the 24px target floor everywhere
         className={`${cls} hit cursor-pointer border-0 p-0 hover:scale-115`}
         style={style}
         aria-label={`${login}: view their PRs`}
         title={`${login} · view their PRs`}
         onClick={() => onClick(login)}
      >
         {login.slice(0, 2)}
      </button>
   ) : (
      <span className={cls} style={style} title={login}>
         {login.slice(0, 2)}
      </span>
   );
}

const WEIGHT_WORD: Record<Weight, string> = {
   XS: 'very light',
   S: 'light',
   M: 'medium',
   L: 'heavy',
   XL: 'very heavy',
};

/**
 * Review effort as a horizontal RATIO strip under the whole sign-off
 * section (CR and QA — weight is how heavy the REVIEW is, both halves), not
 * its own rail slot. The long shared extent gives the exponential fill real
 * resolution, and the fill doubles per class — 6/13/25/50/100% — because review
 * effort roughly doubles per class, so the lengths separate honestly without
 * color carrying anything. Faded whole when the wire didn't send a size; the
 * hover popover has the word and exact +/− lines.
 */
export function WeightMeter({
   weight,
   known = true,
   wide = false,
}: {
   weight: Weight;
   known?: boolean;
   /** stretch the track across the container (the rail's whole CR+QA cell);
    * default is a fixed 36px track for standalone uses (deal card, legend) */
   wide?: boolean;
}) {
   const rank = weightRank(weight);
   const word = WEIGHT_WORD[weight];
   const label = known ? `review effort: ${word}` : `review effort: ${word} (size estimated)`;
   const ratio = [6, 13, 25, 50, 100][rank];
   return (
      <span
         role="img"
         aria-label={label}
         title={`${label}, from diff size`}
         className={`flex h-[4px] overflow-hidden rounded-full ${wide ? 'w-full' : 'w-9'}`}
         style={{ background: 'var(--secondary)', opacity: known ? 1 : 0.5 }}
      >
         <span
            aria-hidden
            className="rounded-full"
            style={{ width: `${ratio}%`, background: 'var(--ink-3)', opacity: 0.55 }}
         />
      </span>
   );
}

/**
 * The concrete diff size beside the abstract weight letter: +added −deleted,
 * so the exact number is there when the letter chip isn't precise enough.
 * Neutral ink, not GitHub's green/red: a line count is a routine metric on
 * every healthy PR, and painting it with the broken/done hues taught the eye
 * to ignore red — the glyphs already say which side is which. Hidden when the
 * wire didn't send a size.
 */
export function DiffSize({ additions, deletions }: { additions: number; deletions: number }) {
   return (
      <span
         className="whitespace-nowrap text-ink-2 tabular-nums"
         title={`+${additions} −${deletions} lines`}
      >
         +{additions} −{deletions}
      </span>
   );
}

const CI_STATE_META: Record<
   CommitStatus['data']['state'],
   { icon: string; color: string; word: string }
> = {
   success: { icon: '✓', color: 'var(--ok)', word: 'passed' },
   failure: { icon: '✗', color: 'var(--bad)', word: 'failed' },
   error: { icon: '✗', color: 'var(--bad)', word: 'errored' },
   pending: { icon: '•', color: 'var(--slate)', word: 'running' },
};

const isRedCheck = (s: CommitStatus) => s.data.state === 'failure' || s.data.state === 'error';

// failures first, then the still-running ones, then the greens; alphabetical
// within a tier so the list is stable run to run
function ciRank(s: CommitStatus): number {
   return isRedCheck(s) ? 0 : s.data.state === 'pending' ? 1 : 2;
}

/** completed − started, when both timestamps are known, as a terse "45s"/"6m". */
function ciDuration(s: CommitStatus): string | null {
   const { started_at, completed_at } = s.data;
   if (started_at == null || completed_at == null) return null;
   const secs = Math.max(0, completed_at - started_at);
   return secs < 60 ? `${Math.round(secs)}s` : `${Math.round(secs / 60)}m`;
}

/**
 * CI as a rail chip: a small proportional bar (red-failing / slate-pending /
 * quiet-green-passing) opening a per-check list — state, name, how long it
 * took, and a link to each — the panel v1 had and v2 flattened to a single
 * "CI: red" word. All-green stays a whisper (a single pale fill), not a
 * checkmark — v1 users only ever "saw green on hover". A fixed-width
 * placeholder (not null) stands in for a pull with no checks to show (ci
 * 'none' / empty), so the rail's other slots don't shift column-to-column.
 */
export function CiStatus({ pull }: { pull: DerivedPull }) {
   const checks =
      pull.ci === 'none'
         ? []
         : [...headStatuses(pull.data)].sort(
              (a, b) => ciRank(a) - ciRank(b) || a.data.context.localeCompare(b.data.context)
           );
   if (!checks.length) return <span aria-hidden className="inline-block w-8" />;

   const failing = checks.filter(isRedCheck).length;
   const passing = checks.filter(c => c.data.state === 'success').length;
   const pendingCount = checks.filter(c => c.data.state === 'pending').length;
   const pending = pendingCount > 0;
   const summary = failing
      ? `CI: ${failing} of ${checks.length} failing`
      : pending
        ? `CI running · ${passing} of ${checks.length} passed`
        : `CI passed · ${n(checks.length, 'check')}`;
   // failing, then pending, then passing. Passed is invisible until you hover
   // the bar (no news is good news — an all-green board shows NO bar at rest,
   // and a mixed bar shows only its red/slate trouble); each segment's share
   // of the bar is its own count, with a 3px floor so one failure among
   // twenty checks stays visible
   const segments = [
      { count: failing, background: 'var(--bad)' },
      { count: pendingCount, background: 'var(--slate)' },
      { count: passing, background: 'var(--ok)', quiet: true },
   ].filter(s => s.count > 0);

   return (
      <Popover
         label="CI checks"
         side="right"
         hover
         rootClass="relative inline-flex"
         width="w-max min-w-[200px] max-w-[320px]"
         panelClass="p-2 text-xs"
         trigger={t => (
            <button
               {...t}
               type="button"
               aria-label={summary}
               title={summary}
               // -my-2/py-2: a real tap target without changing the rail's height.
               // `group`: the passed segments key their hover-reveal off it below
               className="group pressable -my-2 inline-flex items-center gap-1 rounded border-0 bg-transparent px-0 py-2 hover:bg-secondary/60"
            >
               <span aria-hidden className="flex h-[9px] w-8 gap-px overflow-hidden rounded-[3px]">
                  {segments.map((s, i) => (
                     <span
                        key={i}
                        className={
                           s.quiet
                              ? 'opacity-0 transition-opacity duration-150 group-hover:opacity-30 group-focus-visible:opacity-30 motion-reduce:transition-none'
                              : undefined
                        }
                        style={{ flexGrow: s.count, minWidth: 3, background: s.background }}
                     />
                  ))}
               </span>
               {failing > 0 && (
                  <span
                     className="text-[11px] font-medium tabular-nums"
                     style={{ color: 'var(--bad)' }}
                  >
                     {failing}
                  </span>
               )}
            </button>
         )}
      >
         <span className="block px-1 pb-1 font-semibold text-ink">
            CI checks
            <span className="ml-1 font-normal text-ink-3 tabular-nums">
               · {passing} of {checks.length} passed
            </span>
         </span>
         {checks.map(c => {
            const meta = CI_STATE_META[c.data.state];
            const dur = ciDuration(c);
            const inner = (
               <>
                  <span
                     aria-hidden
                     className="w-3 flex-none text-center"
                     style={{ color: meta.color }}
                  >
                     {meta.icon}
                  </span>
                  <b className="min-w-0 font-medium break-all text-ink">{c.data.context}</b>
                  <span className="flex-none text-ink-3">{meta.word}</span>
                  {dur && (
                     <span className="ml-auto flex-none pl-2 whitespace-nowrap text-ink-3 tabular-nums">
                        {dur}
                     </span>
                  )}
               </>
            );
            return c.data.target_url ? (
               <a
                  key={c.data.context}
                  href={c.data.target_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`open ${c.data.context} on GitHub`}
                  className="flex items-center gap-1.5 rounded px-1 py-[3px] transition-[background-color] duration-150 ease-out hover:bg-muted motion-reduce:transition-none"
               >
                  {inner}
               </a>
            ) : (
               <span key={c.data.context} className="flex items-center gap-1.5 px-1 py-[3px]">
                  {inner}
               </span>
            );
         })}
      </Popover>
   );
}

/**
 * Sign-off state as a circle-check meter: one mark per required stamp, in a
 * fixed-width slot so CR, QA, and weight land at the same x down a board.
 * One mark, three standings (see styles.css .pip): a solid disc = an
 * approval that stands, the same mark drained to an outline = it stood once
 * but a push lapsed it (the most actionable state on the board), an empty
 * ring = still needed, a muted dash = nothing required. A dotted underline
 * marks a slot you personally stamped. No enclosing chip at all: the marks
 * are confident enough to stand bare beside their label — every box, wash,
 * and hairline this slot has worn turned out to be scaffolding (the earlier
 * colored squares and tinted backgrounds were a private code that sent eyes
 * to the rail instead of the titles).
 */
export function Pips({
   label,
   have,
   req,
   by = [],
   staleBy = [],
   me,
   titled = true,
}: {
   label: string;
   have: number;
   req: number;
   /** users with a live stamp */
   by?: string[];
   /** users whose stamp a push invalidated */
   staleBy?: string[];
   me?: string;
   /** false when a hover popover wraps these pips (SigPips): the popover
    * carries the same facts, and a native title would stack the browser
    * tooltip under it — the same double-tooltip AgeStamp solved by switching
    * to aria-label. The bare-pips fallback keeps its title. */
   titled?: boolean;
}) {
   const none = !req && !have && !staleBy.length;
   const met = !none && have >= req;
   const mine = me != null && by.includes(me);
   const owedByMe = me != null && staleBy.includes(me);
   const on = Math.min(have, req);
   const stale = Math.max(0, Math.min(staleBy.length, req - on));
   const off = Math.max(0, req - on - stale);
   const aria = none
      ? `${label} not required`
      : `${label} ${have} of ${req}` +
        (met ? ', done' : '') +
        (mine ? ', including yours' : '') +
        (staleBy.length
           ? owedByMe
              ? ', your stamp was invalidated by a push'
              : `, ${staleBy.join(', ')}'s stamp was invalidated by a push`
           : '');
   const title = none
      ? `${label} not required`
      : staleBy.length
        ? `${staleBy.join(', ')} stamped an earlier version; a push invalidated it`
        : met
          ? mine
             ? `${label} done, including your stamp`
             : `${label} done`
          : `${label}: ${have} of ${req}`;
   // No chip-level tint at all: a filled wash — however muted — out-competed
   // the section headers and titles the eye should scan first (salience is
   // about form, not volume). The re-stamp-owed signal lives on the stale pip
   // itself instead: a thin amber halo confined to its own 8px square (see
   // .pip-stale). The word-group header and the pip-mine underline already
   // say whose move it is; the hover title spells out who and when.
   return (
      <span
         className="inline-flex items-center gap-1"
         aria-label={aria}
         title={titled ? title : undefined}
      >
         <span aria-hidden className="w-[18px] text-[11px] font-medium text-ink-3">
            {label}
         </span>
         {none ? (
            <span
               aria-hidden
               className="flex min-w-[31px] justify-start text-xs text-ink-3 opacity-60"
            >
               –
            </span>
         ) : (
            // min-width sized to the COMMON case (two marks), not the 3-mark
            // maximum — a fixed 3-wide slot left dead air before QA on almost
            // every row; the rare 3-required pull just grows
            <span
               aria-hidden
               className={`flex min-w-[31px] items-center justify-start gap-[3px] ${
                  mine || owedByMe ? 'pip-mine' : ''
               }`}
            >
               {/* keyed by fixed slot, not by fill kind, so a pip that flips
                   off→on (stamp lands) or on→stale (a push invalidates it) is
                   the same node easing its color, not a fresh mount */}
               {[
                  ...Array.from({ length: on }, () => 'on'),
                  ...Array.from({ length: stale }, () => 'stale'),
                  ...Array.from({ length: off }, () => 'off'),
               ].map((kind, i) => (
                  <span key={i} className={`pip pip-${kind}`} />
               ))}
            </span>
         )}
      </span>
   );
}

/**
 * The ledger slot as a drill-down: click to see who signed, who went stale,
 * and when — the answer v1 kept in per-signer bubbles and v2's counts lost.
 * Falls back to the plain ledger when there's nothing to list.
 */
export function SigPips({
   label,
   have,
   req,
   by = [],
   staleBy = [],
   me,
   sigs,
}: {
   label: string;
   have: number;
   req: number;
   by?: string[];
   staleBy?: string[];
   me?: string;
   sigs: Signature[];
}) {
   // bare pips (the no-signatures fallback) keep their native title; inside
   // the hover popover below it would just stack a browser tooltip on top
   if (!sigs.length)
      return <Pips label={label} have={have} req={req} by={by} staleBy={staleBy} me={me} />;
   const pips = (
      <Pips label={label} have={have} req={req} by={by} staleBy={staleBy} me={me} titled={false} />
   );

   // latest signature per user, live stamps first, then invalidated ones
   const latest = new Map<string, Signature>();
   for (const s of sigs) {
      const prev = latest.get(s.data.user.login);
      if (!prev || s.data.created_at > prev.data.created_at) latest.set(s.data.user.login, s);
   }
   const rows = [...latest.values()].sort(
      (a, b) =>
         Number(b.data.active) - Number(a.data.active) ||
         (a.data.created_at < b.data.created_at ? 1 : -1)
   );

   return (
      <Popover
         label={`${label} signatures`}
         side="right"
         hover
         rootClass="relative inline-flex"
         // bounded: an unbounded w-max panel + a long login could grow past
         // the viewport's left edge (side=right anchors the right edge)
         width="w-max min-w-[190px] max-w-[300px]"
         panelClass="p-2 text-xs"
         trigger={t => (
            <button
               {...t}
               type="button"
               // no native title: the popover itself opens on this same hover
               // py+negative-my: a real tap target (the marks are ~10px glyphs)
               // without moving anything in the rail's layout
               className="pressable -my-2 cursor-pointer rounded border-0 bg-transparent px-0 py-2 text-left hover:bg-secondary/60"
            >
               {pips}
            </button>
         )}
      >
         {/* restate the fraction: the trigger's hover title is mouse-only,
             and a tap-opened panel must carry the "how many still needed" */}
         <span className="block px-1 pb-1 font-semibold text-ink">
            {label} stamps
            {req > 0 && (
               <span className="ml-1 font-normal text-ink-3 tabular-nums">
                  · {have} of {req}
               </span>
            )}
         </span>
         {rows.map(s => (
            <a
               key={s.data.user.login}
               href={signatureUrl(s)}
               target="_blank"
               rel="noopener noreferrer"
               title="open this stamp’s comment on GitHub"
               className="flex items-center gap-1.5 rounded px-1 py-[3px] text-ink-2 transition-[background-color] duration-150 ease-out hover:bg-muted motion-reduce:transition-none"
            >
               <Avatar login={s.data.user.login} size={16} />
               <b className="min-w-0 font-medium break-all text-ink">{s.data.user.login}</b>
               {s.data.user.login === me && <span className="text-ink-3">(you)</span>}
               <span className="ml-auto pl-3 whitespace-nowrap text-ink-3 tabular-nums">
                  {ago(epoch(s.data.created_at))} ago
               </span>
               {s.data.active ? (
                  <span className="pip pip-on" title="active stamp" />
               ) : (
                  <span className="pip pip-stale" title="invalidated by a later push" />
               )}
            </a>
         ))}
      </Popover>
   );
}

/**
 * The age slot: hours under a day, then days, with an urgency ramp (amber
 * past STARVE_DAYS, red past ROT_DAYS) and both clocks in the tooltip — a
 * 30-day pull pushed an hour ago is hot, and the flat gray number hid
 * that. Hours matter here: in three months of real history, 62% of pulls
 * merged same-day, so "0d" was a dead signal for most of the live board.
 */
export function AgeStamp({
   ageDays,
   createdAt,
   updatedAt,
   quiet,
   warnDays = STARVE_DAYS,
   rotDays = ROT_DAYS,
   inline,
}: {
   ageDays: number;
   /** epoch secs the pull opened */
   createdAt: number;
   /** epoch secs of the last activity */
   updatedAt: number;
   /** drafts and holds age on purpose: no urgency color */
   quiet?: boolean;
   /** amber at/after this many days (user setting; defaults to the model's) */
   warnDays?: number;
   /** red at/after this many days */
   rotDays?: number;
   /** true when it's embedded in a flowing meta line rather than the rail's
    * fixed-width column — drops the w-7/text-right slot in favor of plain
    * inline text. */
   inline?: boolean;
}) {
   const hot = quiet
      ? null
      : ageDays >= rotDays
        ? 'var(--bad)'
        : ageDays >= warnDays
          ? 'var(--warn)'
          : null;
   const text = ageDays === 0 ? ago(createdAt) : `${ageDays}d`;
   // a popover, not a title: the second clock (last activity) exists nowhere
   // else on the row, and a native tooltip is mouse-only — this way touch
   // taps it and keyboard reads it from the aria-label
   return (
      <Popover
         label="Age"
         side="right"
         hover
         rootClass="relative inline-flex"
         width="w-max"
         panelClass="p-2 text-xs whitespace-nowrap"
         trigger={t => (
            <button
               {...t}
               type="button"
               aria-label={`opened ${ago(createdAt)} ago, last activity ${ago(updatedAt)} ago`}
               className="hit -my-2 rounded border-0 bg-transparent px-0 py-2 text-inherit hover:bg-secondary/60"
            >
               <span
                  aria-hidden
                  className={`tabular-nums ${inline ? '' : 'block w-7 text-right'} ${hot ? 'font-medium' : ''}`}
                  style={hot ? { color: hot } : undefined}
               >
                  {text}
               </span>
            </button>
         )}
      >
         <span className="block px-1 text-ink-2">
            opened <b className="font-medium text-ink">{ago(createdAt)} ago</b>
         </span>
         <span className="mt-0.5 block px-1 text-ink-2">
            last activity <b className="font-medium text-ink">{ago(updatedAt)} ago</b>
         </span>
      </Popover>
   );
}

/**
 * The full-title GitHub link every row variant renders — never truncated.
 * With `stretch`, its click target covers the whole positioned row (see
 * .pd-link): the entire card opens the PR, while raised children stay
 * clickable. The visible title still underlines on hover so it reads as the
 * link, and j/k / middle-click still land on this anchor.
 */
export function PullTitleLink({
   repo,
   number,
   title,
   onOpen,
   stretch,
}: {
   repo: string;
   number: number;
   title: string;
   /** fired when the user opens the PR — the row's natural "seen" ack */
   onOpen?: () => void;
   /** cover the whole row as one click target */
   stretch?: boolean;
}) {
   // The whole-card click honors your "open PRs in a new tab" setting so the
   // hub stays put behind you (the default) or navigates in place if you'd
   // rather. Read non-reactively: the row that renders this already subscribes
   // to settings, so a toggle re-renders it and this picks up the new value.
   const newTab = getSettings().openPrsNewTab;
   return (
      <a
         className={`font-medium hover:underline hover:underline-offset-2 ${stretch ? 'pd-link' : ''}`}
         href={githubUrl(repo, number)}
         {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
         onClick={onOpen}
         onAuxClick={onOpen}
      >
         {title}
      </a>
   );
}

/**
 * The number is what you say out loud; the repo is ambient context. Split
 * them typographically so the identifier steps forward and the repo whispers.
 */
export function RepoRef({ repo, number }: { repo: string; number: number }) {
   return (
      <span className="whitespace-nowrap">
         <span className="text-ink-3">{shortRepo(repo)}</span>{' '}
         <span className="font-medium text-ink-2 tabular-nums">#{number}</span>
      </span>
   );
}

/**
 * A pill segmented control — the house pattern for a small closed choice
 * (default view, density, Mine/All drafts). One radiogroup, so it reads as
 * "pick exactly one" to a screen reader instead of a row of toggle buttons.
 */
export function Segmented<T extends string>({
   value,
   options,
   onChange,
   ariaLabel,
}: {
   value: T;
   options: [T, string][];
   onChange: (next: T) => void;
   ariaLabel: string;
}) {
   // role=radio sets the APG expectation: one Tab stop for the group, arrows
   // move the selection. Without this the role announces a contract ("radio
   // 1 of 3, use arrows") the control doesn't honor.
   const hasSelection = options.some(([v]) => v === value);
   const moveSelection = (e: ReactKeyboardEvent<HTMLButtonElement>, from: number) => {
      const delta =
         e.key === 'ArrowRight' || e.key === 'ArrowDown'
            ? 1
            : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
              ? -1
              : 0;
      const next =
         e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? options.length - 1
              : delta
                ? (from + delta + options.length) % options.length
                : null;
      if (next == null) return;
      e.preventDefault();
      onChange(options[next][0]);
      (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
   };
   return (
      <div
         role="radiogroup"
         aria-label={ariaLabel}
         className="inline-flex flex-wrap gap-0.5 rounded-lg border border-line bg-muted p-0.5"
      >
         {options.map(([val, label], i) => (
            <button
               key={val}
               type="button"
               role="radio"
               aria-checked={value === val}
               tabIndex={value === val || (!hasSelection && i === 0) ? 0 : -1}
               onClick={() => onChange(val)}
               onKeyDown={e => moveSelection(e, i)}
               className={`pressable rounded-md px-2.5 py-1 text-xs font-medium ${
                  value === val ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-brand'
               }`}
            >
               {label}
            </button>
         ))}
      </div>
   );
}

/** A compact on/off switch — a track with a sliding knob. Used where a full
 * Segmented (On/Off) would be too heavy, e.g. a long list of per-item toggles. */
export function Switch({
   checked,
   onChange,
   ariaLabel,
   disabled,
}: {
   checked: boolean;
   onChange: (next: boolean) => void;
   ariaLabel: string;
   disabled?: boolean;
}) {
   return (
      <button
         type="button"
         role="switch"
         aria-checked={checked}
         aria-label={ariaLabel}
         disabled={disabled}
         onClick={() => onChange(!checked)}
         className={`pressable inline-flex h-[18px] w-8 flex-none items-center rounded-full transition-colors disabled:opacity-40 ${
            checked ? 'bg-brand' : 'bg-secondary'
         }`}
      >
         <span
            className={`h-3.5 w-3.5 rounded-full bg-surface shadow-sm transition-transform ${
               checked ? 'translate-x-[16px]' : 'translate-x-[2px]'
            }`}
         />
      </button>
   );
}

export function EmptyState({ title, sub }: { title: string; sub: string }) {
   return (
      <div className="flex flex-col items-center gap-2.5 px-6 py-10 text-center text-[13px] text-ink-3">
         <svg viewBox="0 0 36 36" fill="none" aria-hidden className="h-9 w-9">
            <circle cx="18" cy="18" r="16" stroke="var(--ok)" strokeWidth="2" />
            <path
               className="draw-check"
               d="M11 18.5l5 5 9-11"
               stroke="var(--ok)"
               strokeWidth="2.5"
               strokeLinecap="round"
               strokeLinejoin="round"
            />
         </svg>
         <span className="text-sm font-semibold text-ink-2">{title}</span>
         <span>{sub}</span>
      </div>
   );
}
