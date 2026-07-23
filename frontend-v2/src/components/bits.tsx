import { useEffect, useState } from 'react';
import type {
   ButtonHTMLAttributes,
   CSSProperties,
   KeyboardEvent as ReactKeyboardEvent,
   ReactNode,
} from 'react';
import { Check, CircleDot, Star, X } from 'lucide-react';
import {
   type DerivedPull,
   headStatuses,
   ROT_DAYS,
   STARVE_DAYS,
   type Status,
   type Weight,
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
import { Icon } from './Icon';
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

export const STATUS_DOT: Record<Status, string> = {
   ready: 'var(--ok)',
   ci_pending: 'var(--slate)',
   // a lapsed stamp is owed work, amber by doctrine — reaches the screen via
   // Stats' status bar
   needs_recr: 'var(--warn)',
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

/**
 * Merged/closed state as a pill — the one badge left on the board; open pulls
 * are badge-less and carry state via section position + the state popover.
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
            isNew ? '' : 'text-brand-700 shadow-[inset_0_0_0_1px_var(--brand)]'
         }`}
         style={
            isNew
               ? { background: 'var(--badge-brand-bg)', color: 'var(--badge-brand-fg)' }
               : undefined
         }
         title={isNew ? 'new since you cleared' : 'updated since you cleared'}
      >
         {isNew ? 'new' : 'updated'}
      </span>
   );
}

/**
 * The circle itself: the GitHub picture over the deterministic-hue initials.
 * The initials sit underneath and show through the instant the image 404s
 * (bots, deleted accounts, an offline CDN) — so we always render something,
 * never a broken-image glyph.
 */
/**
 * The you-coin: what stands in the identity slot when the pull is the
 * viewer's own — v1's blue star, minted. A brand ring (the coin's edge)
 * around a filled brand star, same mass as a face, so the row rhythm holds
 * while yours reads at a glance. The star vocabulary is one concept, people
 * who matter to you: a corner star on someone you starred, the full coin
 * for its limit case — you.
 */
export function YouCoin({ size = 22 }: { size?: number }) {
   return (
      <span
         role="img"
         aria-label="your PR"
         title="your PR"
         className="inline-flex flex-none items-center justify-center rounded-full text-brand"
         style={{ width: size, height: size, boxShadow: '0 0 0 1.5px var(--brand)' }}
      >
         <Star size={Math.round(size * 0.55)} fill="currentColor" aria-hidden />
      </span>
   );
}

function AvatarFace({ login, size }: { login: string; size: number }) {
   const [broken, setBroken] = useState(false);
   // OKLCH holds perceived lightness constant across the hue wheel — the old
   // hsl(h 45% 45%) made yellow-green logins illegible under white text
   const style = {
      background: `oklch(0.48 0.09 ${loginHue(login)})`,
      width: size,
      height: size,
      fontSize: Math.round(size * 0.42),
   };
   return (
      <span
         className="relative inline-flex flex-none items-center justify-center overflow-hidden rounded-full font-semibold uppercase text-white"
         style={style}
      >
         {login.slice(0, 2)}
         {!broken && (
            <img
               src={githubAvatarUrl(login, size)}
               alt=""
               aria-hidden
               loading="lazy"
               className="absolute inset-0 h-full w-full object-cover"
               onError={() => setBroken(true)}
            />
         )}
      </span>
   );
}

/** The hover card behind a clickable avatar: the picture bigger, the handle,
 * and a jump to their GitHub profile. (A real name would need a server-side
 * user fetch — it isn't on our wire — so we show the handle we have.) */
function PersonCard({ login }: { login: string }) {
   return (
      <div className="flex items-center gap-2.5 text-[13px]">
         <AvatarFace login={login} size={40} />
         <div className="min-w-0">
            <a
               href={githubProfileUrl(login)}
               target="_blank"
               rel="noopener noreferrer"
               className="block truncate font-semibold text-ink hover:underline"
               title={`@${login} on GitHub`}
            >
               {login}
            </a>
            <a
               href={githubProfileUrl(login)}
               target="_blank"
               rel="noopener noreferrer"
               className="text-[11px] text-ink-3 hover:text-brand hover:underline"
            >
               GitHub profile ↗
            </a>
         </div>
      </div>
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
   if (!onClick) {
      return (
         <span title={login} className="inline-flex">
            <AvatarFace login={login} size={size} />
         </span>
      );
   }
   // A clickable avatar keeps its one-click "filter to this person" gesture
   // (the trigger's own onClick), and grows a hover preview card on top — the
   // same hover-open/pin discipline AgeStamp and the ledger use. Hover is a
   // supplement (the picture bigger + a GitHub link); the click action stays
   // fully keyboard- and touch-reachable.
   return (
      <Popover
         label={login}
         hover
         side="left"
         rootClass="relative inline-flex"
         width="w-[220px]"
         panelClass="p-2.5"
         trigger={t => (
            <button
               {...t}
               type="button"
               // .hit: the circle is 16-22px, under the 24px target floor
               className="hit pressable cursor-pointer border-0 p-0 transition-[scale] duration-150 ease-out hover:scale-115 motion-reduce:transition-none"
               aria-label={`${login}: view their PRs`}
               // click filters to this person; the hover card is the extra
               onClick={() => onClick(login)}
            >
               <AvatarFace login={login} size={size} />
            </button>
         )}
      >
         <PersonCard login={login} />
      </Popover>
   );
}

/**
 * The one star mark every "primary repo" / "starred person" toggle shares
 * (Row's kebab menu, RepoFilter, PeopleFilter, RepoManager): filled when on,
 * outline when off, same lucide glyph everywhere instead of five hand-rolled
 * ★/☆ copies.
 */
export function StarMark({ on, size = 14 }: { on: boolean; size?: number }) {
   return <Icon icon={Star} size={size} fill={on ? 'currentColor' : 'none'} />;
}

export const WEIGHT_WORD: Record<Weight, string> = {
   XS: 'very light',
   S: 'light',
   M: 'medium',
   L: 'heavy',
   XL: 'very heavy',
};

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
   { icon: typeof Check; color: string; word: string }
> = {
   success: { icon: Check, color: 'var(--ok)', word: 'passed' },
   failure: { icon: X, color: 'var(--bad)', word: 'failed' },
   error: { icon: X, color: 'var(--bad)', word: 'errored' },
   pending: { icon: CircleDot, color: 'var(--slate)', word: 'running' },
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
 * CI in the sign-off family: the machine is a reviewer, so it wears the same
 * label + circle-mark anatomy as CR and QA. Only a failure earns ink at rest
 * (a red X disc plus the failing count); a passing or still-running check
 * renders in a reserved, invisible slot and is revealed on row hover — the
 * same "green only on hover" physics the old segmented bar had, now in one
 * vocabulary. The trigger opens the per-check list: state, name, duration,
 * and a link for each. A fixed-width placeholder (not null) stands in for a
 * pull with no checks, so the rail's other slots don't shift row-to-row.
 */
export function CiStatus({ pull }: { pull: DerivedPull }) {
   const checks =
      pull.ci === 'none'
         ? []
         : [...headStatuses(pull.data)].sort(
              (a, b) => ciRank(a) - ciRank(b) || a.data.context.localeCompare(b.data.context)
           );
   if (!checks.length)
      return <span aria-hidden className="pd-ci-slot inline-block w-[36px]" />;

   const failing = checks.filter(isRedCheck).length;
   const passing = checks.filter(c => c.data.state === 'success').length;
   const pendingCount = checks.filter(c => c.data.state === 'pending').length;
   const pending = pendingCount > 0;
   const summary = failing
      ? `CI: ${failing} of ${checks.length} failing`
      : pending
        ? `CI running · ${passing} of ${checks.length} passed`
        : `CI passed · ${n(checks.length, 'check')}`;
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
               // Quiet states keep their full content at opacity 0 so the reveal
               // can never reflow the line, and CR/QA never shift beside them.
               // One fixed slot width in every state (sized to the failing
               // cluster, the widest), so the rail — and the age numeral's
               // right edge in the meta line — stays one column down a lane.
               className={`pd-ci-slot pressable -my-2 inline-flex w-[36px] items-center gap-1 rounded border-0 bg-transparent px-0 py-2 hover:bg-secondary/60 ${
                  failing > 0 || pending
                     ? ''
                     : 'pd-ci-quiet opacity-0 transition-opacity duration-150 hover:opacity-100 focus-visible:opacity-100 [.pd-row:hover_&]:opacity-100 motion-reduce:transition-none'
               }`}
            >
               <span aria-hidden className="w-[18px] text-left text-[11px] font-medium text-ink-3">
                  CI
               </span>
               {/* one circle, no glyphs (styles.css .ci-ring/.ci-fail): a
                   red ring with a center dot = failing (the fraction lives
                   in the popover; a 1-of-25 failure must read as loudly as
                   25-of-25), the slate ring sweeping closed = running (the
                   sweep is the completed share, v1's grey section reborn),
                   and a closed green ring revealed on row hover = passed
                   (no draw-on-reveal: animation means a state CHANGED, and
                   hovering isn't a change). Check glyphs stay reserved for
                   human stamps. */}
               {failing > 0 ? (
                  <span aria-hidden className="ci-fail" />
               ) : pending ? (
                  <span
                     aria-hidden
                     className="ci-ring ci-ring-run"
                     style={
                        {
                           '--sweep': `${Math.round(((checks.length - pendingCount) / checks.length) * 360)}deg`,
                        } as CSSProperties
                     }
                  />
               ) : (
                  <span aria-hidden className="ci-ring ci-ring-pass" />
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
                  <span className="w-3 flex-none text-center" style={{ color: meta.color }}>
                     <Icon icon={meta.icon} size={12} />
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
 * fixed-width slot so CR, QA, CI, and the weight letter land at the same x
 * down a board. One mark, three standings (see styles.css .pip): a solid disc
 * = an approval that stands, the same mark drained to an outline = it stood
 * once but a push lapsed it (the most actionable state on the board), an
 * empty ring = still needed, a muted dash = nothing required. A dotted
 * underline marks a slot you personally stamped. No enclosing chip at all:
 * the marks are confident enough to stand bare beside their label — every
 * box, wash, and hairline this slot has worn turned out to be scaffolding
 * (the earlier colored squares and tinted backgrounds were a private code
 * that sent eyes to the rail instead of the titles).
 *
 * `label` only feeds the aria/title strings ("CR 2 of 2…") — it renders
 * nothing here. The visible "CR"/"QA" glyph is the caller's (Row.tsx), the
 * same fixed-width slot the CI label and weight letter use, so a caller can
 * slot something else (the weight letter) between the label and these marks
 * without it ending up inside this component's own hover/click surface.
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
         {none ? (
            <span
               aria-hidden
               className="flex min-w-[48px] justify-start text-xs text-ink-3 opacity-60"
            >
               –
            </span>
         ) : (
            // min-width sized to the 3-mark case, not the common two: the
            // rail is right-anchored, so a slot that hugged two marks made a
            // 3-required pull grow the rail leftward and knock the age
            // numeral off its right-edge column in the meta line. The air
            // this reserves before the next label matches what the CI slot
            // already reserves for its failing cluster — one rail width,
            // every row. A 4-required pull (unseen in practice) still grows.
            <span
               aria-hidden
               className={`flex min-w-[48px] items-center justify-start gap-[3px] ${
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
   lead,
   panelExtra,
}: {
   label: string;
   have: number;
   req: number;
   by?: string[];
   staleBy?: string[];
   me?: string;
   sigs: Signature[];
   /** rendered inside the trigger before the pips — the cluster's text label
    * (and, for CR, the weight letter), so the words are part of the door */
   lead?: ReactNode;
   /** an extra panel section under the signer rows (CR carries the weight
    * drill-down here — one popover for the whole cluster) */
   panelExtra?: ReactNode;
}) {
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
               aria-label={`${label} stamps: ${have} of ${req}`}
               // no native title: the popover itself opens on this same hover
               // py+negative-my: a real tap target (the marks are ~10px glyphs)
               // without moving anything in the rail's layout
               className="pressable -my-2 inline-flex cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-0 py-2 text-left hover:bg-secondary/60"
            >
               {lead}
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
         {rows.length === 0 && (
            <span className="block px-1 py-[3px] text-ink-3">No stamps yet.</span>
         )}
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
         {/* the mark vocabulary, keyed right where the marks are read — the
             legend stays a conventions card, not a per-mark decoder */}
         <span className="mt-1 flex items-center gap-1 border-t border-secondary px-1 pt-1.5 text-[11px] text-ink-3">
            <span className="pip pip-on" /> stands
            <span className="pip pip-stale ml-1.5" /> staled by a push
            <span className="pip pip-off ml-1.5" /> needed
         </span>
         {panelExtra}
      </Popover>
   );
}

/**
 * The age popover's body: "opened X ago", "last activity Y ago", and (only
 * when the row's age line is actually drawn) the line's own relative-to-
 * the-oldest explanation. Shared by AgeStamp (the numeral, every row) and
 * AgeBaseline (the hoverable band, only aging rows) so the two doors into
 * the same fact can never drift apart — one copy, two triggers.
 */
function AgePopoverBody({
   createdAt,
   updatedAt,
   explainLine,
}: {
   /** epoch secs the pull opened */
   createdAt: number;
   /** epoch secs of the last activity */
   updatedAt: number;
   /** the caller decides: the numeral shows on every row and only adds this
    * once its own age crosses warnDays, the band only ever renders once
    * that's already true, so it always passes it. */
   explainLine: boolean;
}) {
   return (
      <>
         <span className="block px-1 text-ink-2">
            opened <b className="font-medium text-ink">{ago(createdAt)} ago</b>
         </span>
         <span className="mt-0.5 block px-1 text-ink-2">
            last activity <b className="font-medium text-ink">{ago(updatedAt)} ago</b>
         </span>
         {explainLine && (
            <span className="mt-0.5 block max-w-[220px] px-1 whitespace-normal text-ink-3">
               the grey line under this row is its age, relative to the board’s oldest open pull
            </span>
         )}
      </>
   );
}

/**
 * Age as the row's own baseline: a 1px hairline along the bottom edge — a
 * tinted stretch of the divider the row already has, not a drawn bar.
 * RELATIVE, not thresholded: the board's longest-open pull sets the full
 * track and every row is a fraction of it, so the line answers "how long
 * has this waited, relative to what waiting looks like here." The tint
 * deepens with that same fraction, ultra-light ink for the merely-aging
 * through full ink-3 for the oldest — age is a quiet fact in grey, never
 * a colored alarm (an amber version shipped for an hour and was the
 * loudest thing on the board; urgency belongs to the queue's ranking and
 * the numeral's weight). Silent below the aging threshold — a healthy
 * young row draws nothing.
 *
 * The line is also a door now, not pure geometry: a 10px invisible hit strip
 * (`.pd-age-track`/`.pd-age-hit` in styles.css), sized to the SAME fraction
 * as the visible line so a 1px target doesn't need pixel-hunting, opens the
 * same age popover the numeral shows on hover or focus and grows the line to
 * an 8px band while it's open. At rest it's pixel-identical to the old
 * static hairline.
 */
export function AgeBaseline({
   ageDays,
   createdAt,
   updatedAt,
   warnDays = STARVE_DAYS,
   maxAgeDays = 1,
   quiet,
}: {
   ageDays: number;
   /** epoch secs the pull opened — feeds the shared age popover body */
   createdAt: number;
   /** epoch secs of the last activity — feeds the shared age popover body */
   updatedAt: number;
   warnDays?: number;
   /** the board's longest-open pull — the 100% mark of the track */
   maxAgeDays?: number;
   /** drafts and holds age on purpose: draw nothing */
   quiet?: boolean;
}) {
   if (quiet || ageDays < warnDays) return null;
   const t = Math.min(ageDays / Math.max(maxAgeDays, 1), 1);
   // tint rides the same fraction as length: ~30% border-grey at the
   // gate, the full border color on the board's oldest (owner call: the
   // ink ramp read too dark against the row divider it extends)
   const inkPct = Math.round(30 + 70 * t);
   return (
      // the percentage width lives on this outer track (not the line itself,
      // see styles.css): the line and its taller hit area both fill 100% of
      // it, so hovering anywhere along the row's actual age fraction — never
      // past it — opens the door.
      <span className="pd-age-track" style={{ width: `${(t * 100).toFixed(1)}%` }}>
         <Popover
            label="Age"
            side="left"
            hover
            rootClass="block h-full w-full"
            width="w-max"
            panelClass="p-2 text-xs whitespace-nowrap"
            trigger={t2 => (
               <button
                  {...t2}
                  type="button"
                  aria-label={`age: opened ${ago(createdAt)} ago`}
                  // pd-age-hit: the hover/focus hook that grows .pd-age-line
                  // (styles.css) — border/bg reset only, no positioning of its
                  // own, since the track above already placed this box.
                  className="pd-age-hit block h-full w-full border-0 bg-transparent p-0"
               >
                  <span
                     aria-hidden
                     className="pd-age-line"
                     style={{
                        background: `color-mix(in oklab, var(--border) ${inkPct}%, transparent)`,
                     }}
                  />
               </button>
            )}
         >
            <AgePopoverBody createdAt={createdAt} updatedAt={updatedAt} explainLine />
         </Popover>
      </span>
   );
}

/**
 * The age slot: hours under a day, then days, with both clocks in the
 * popover. Hours matter here: in three months of real history, 62% of
 * pulls merged same-day, so "0d" was a dead signal for most of the live
 * board. It rides at the rail's far right, capping the row — and it
 * WHISPERS: its resting color is the age line's own border tint, rising to
 * ink on row hover (see styles.css .pd-age-num). Age's salience is carried
 * once, by the baseline built for continuous gradation; the numeral is the
 * label you consult, not a second alarm. Font weight still steps at the
 * warn/rot thresholds so the hover read carries the urgency.
 *
 * `display` picks the clock the numeral shows (opened vs last update); the
 * urgency weight always follows the OPENED clock — how long a pull has been
 * open is the truth the board ranks by, whichever number the user prefers
 * to read.
 */
export function AgeStamp({
   ageDays,
   createdAt,
   updatedAt,
   quiet,
   warnDays = STARVE_DAYS,
   rotDays = ROT_DAYS,
   inline,
   display = 'opened',
}: {
   ageDays: number;
   /** epoch secs the pull opened */
   createdAt: number;
   /** epoch secs of the last activity */
   updatedAt: number;
   /** drafts and holds age on purpose: no urgency weight */
   quiet?: boolean;
   /** heavier type at/after this many days (user setting; defaults to the model's) */
   warnDays?: number;
   /** heaviest type at/after this many days */
   rotDays?: number;
   /** true when it's embedded in a flowing meta line rather than the rail's
    * fixed-width column — drops the w-7/text-right slot in favor of plain
    * inline text. */
   inline?: boolean;
   /** which clock the numeral shows (settings.ageDisplay) */
   display?: 'opened' | 'updated';
}) {
   const heft = quiet
      ? ''
      : ageDays >= rotDays
        ? 'font-semibold'
        : ageDays >= warnDays
          ? 'font-medium'
          : '';
   const shownEpoch = display === 'updated' ? updatedAt : createdAt;
   const shownDays =
      display === 'updated'
         ? Math.max(0, Math.floor((Date.now() / 1000 - updatedAt) / 86400))
         : ageDays;
   const text = shownDays === 0 ? ago(shownEpoch) : `${shownDays}d`;
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
                  className={`pd-age-num tabular-nums ${inline ? '' : 'block w-7 text-right'} ${heft}`}
               >
                  {text}
               </span>
            </button>
         )}
      >
         <AgePopoverBody
            createdAt={createdAt}
            updatedAt={updatedAt}
            explainLine={!quiet && ageDays >= warnDays}
         />
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
   body,
   stretch,
}: {
   repo: string;
   number: number;
   title: string;
   /** the PR description; when present, hovering the visible title previews
    * it rendered — the "can I act on this?" read without leaving the board */
   body?: string;
   /** cover the whole row as one click target */
   stretch?: boolean;
}) {
   // The whole-card click honors your "open PRs in a new tab" setting so the
   // hub stays put behind you (the default) or navigates in place if you'd
   // rather. Read non-reactively: the row that renders this already subscribes
   // to settings, so a toggle re-renders it and this picks up the new value.
   const newTab = getSettings().openPrsNewTab;
   // no door where there's nothing behind it: an empty description gets no
   // popover, so the hover promise is always kept
   const preview = body?.trim() ? body : null;
   return (
      <a
         className={`font-medium hover:underline hover:underline-offset-2 ${stretch ? 'pd-link' : ''}`}
         href={githubUrl(repo, number)}
         {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
         {preview ? (
            // hoverTriggerOnly scopes the hover door to the visible words: the
            // anchor's stretched hit layer covers the whole row, and a preview
            // that opened from anywhere on the card would be a popover storm
            <Popover
               label={`description of #${number}`}
               hover
               hoverTriggerOnly
               rootClass="relative inline"
               width="w-[440px] max-w-[90vw]"
               panelClass="p-3 max-h-[420px] overflow-auto"
               // no click-pin: a click on the title means "open the PR", and
               // pinning a preview behind the tab you just opened is noise.
               // pd-raise lifts the words above the anchor's stretched hit
               // layer (z 0) — without it the pointer hit-tests the ::after,
               // the span never sees mouseenter, and the door never opens;
               // still inside the anchor, so a click navigates as before
               trigger={({ onClick: _pin, ...t }) => (
                  <span {...t} className="pd-raise">
                     {title}
                  </span>
               )}
            >
               <DescriptionBody md={preview} />
            </Popover>
         ) : (
            title
         )}
      </a>
   );
}

/** The rendered PR description inside the title's hover preview. Markdown
 * tooling (marked + DOMPurify) loads as its own chunk on the first hover —
 * board startup never pays for it. */
function DescriptionBody({ md }: { md: string }) {
   const [html, setHtml] = useState<string | null>(null);
   useEffect(() => {
      let live = true;
      void import('../markdown').then(m => {
         if (live) setHtml(m.renderMarkdown(md));
      });
      return () => {
         live = false;
      };
   }, [md]);
   if (html == null) return <div className="px-1 text-xs text-ink-3">Loading…</div>;
   // sanitized in renderMarkdown; the description is author-authored remote
   // content and never lands in the DOM unsanitized
   return <div className="md-prose text-[13px]" dangerouslySetInnerHTML={{ __html: html }} />;
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
