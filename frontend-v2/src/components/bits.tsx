import { forwardRef, useEffect, useState } from 'react';
import type { ButtonHTMLAttributes, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import type { Status, Weight } from '../../../shared/model/status';
import { githubUrl, shortRepo } from '../../../shared/format';
import { getSettings } from '../settings';
import { Icon, type LucideComponent } from './Icon';
import { Popover } from './Popover';

/**
 * The board's small generic scraps: status label/dot vocabulary, weight
 * words, corner badges, buttons, diff sizes, the title link + repo ref, and
 * the plain form controls (Segmented, Switch, EmptyState). The three domain
 * systems that used to share this file — author identity (the silhouette
 * and the star), the age ruler, and the sign-off/CI pip family — moved to
 * identity.tsx, age.tsx, and pips.tsx.
 */

export const STATUS_LABEL: Record<Status, string> = {
   ready: 'Ready to merge',
   // only at the ready gate: fully signed off, CI is the one thing left.
   // 'CI running' would lie — a needs-CR pull can have CI running too — so
   // the badge names the WAIT, not the machinery.
   ci_pending: 'Waiting on CI',
   needs_recr: 'Needs re-CR',
   needs_qa: 'Needs QA',
   needs_cr: 'Needs CR',
   // the old "Blocked" wore one badge for three opposite situations; each
   // now says whose move it is
   dev_block: 'Dev blocked',
   deploy_block: 'Deploy block',
   unmergeable: 'Can’t merge',
   ci_red: 'CI failing',
   draft: 'Draft',
};

/**
 * The house text-input recipe: the plain-bordered field shape every board
 * name/search/number field shares. Callers append their own width, margin,
 * and horizontal padding (a search box's icon inset differs from a plain
 * name field's).
 */
export const textInputClass = 'h-8 rounded-lg border border-line bg-surface text-[13px]';

/**
 * Grows a rail hairline into a real tap target without shifting row height:
 * a negative vertical margin matched by the same vertical padding, borderless
 * and transparent so the mark inside is unaffected, plus the hover wash every
 * rail trigger reveals on and `hit`'s widened click/tap target. Callers
 * append their own sizing (width, gap, flex, horizontal padding) and any
 * state-dependent classes.
 */
export const railTriggerClass =
   'hit -my-2 rounded border-0 bg-transparent py-2 hover:bg-secondary/60';

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
 * radius or hover tweak lands everywhere. sm = inline row actions (hide,
 * show), md = standalone panel actions. tone='brand' for the affirmative
 * variant ("Show for me").
 */
/**
 * The corner count/state badge the filter triggers and lens tabs share:
 * absolutely positioned, so appearing or changing NEVER moves its host —
 * data landing mid-load can't reflow the bar. 1–3 characters (a count, a
 * lone weight's letters, a −count for an exclusion). 'brand' = something of
 * yours or a narrowing you chose; 'quiet' = standing info (the hidden
 * ledger's count). aria-hidden: the host's aria-label carries the words.
 */
export function CornerBadge({ text, tone = 'brand' }: { text: string; tone?: 'brand' | 'quiet' }) {
   return (
      <span
         aria-hidden
         className={`absolute -top-1 -right-1 min-w-[15px] rounded-full px-1 text-center text-[10px] font-semibold leading-[15px] ${
            tone === 'brand' ? 'bg-brand-50 text-brand-700' : 'bg-secondary text-ink-2'
         }`}
      >
         {text}
      </span>
   );
}

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
 * The 8×8 bordered-square header icon button — Legend, Settings, and
 * NotificationPanel's three trigger buttons, one recipe instead of three
 * hand-copies. `ref`/`onClick`/`aria-*` spread through via `...rest` so it
 * still works as a Popover trigger (Legend, NotificationPanel spread `t`
 * straight onto it) or a plain ref+onClick pair (Settings' portal drawer).
 * `title` defaults to `label` (most callers' hover text repeats their
 * aria-label verbatim); pass it explicitly when they diverge (NotificationPanel's
 * title stays "recent nudges" while the aria-label grows an unseen count).
 * `className`/`children` extend the recipe for NotificationPanel's `relative`
 * positioning and count badge overlay.
 */
export const HeaderIconButton = forwardRef<
   HTMLButtonElement,
   ButtonHTMLAttributes<HTMLButtonElement> & {
      icon: LucideComponent;
      /** the button's accessible name */
      label: string;
      /** hover title text; defaults to `label` */
      title?: string;
      children?: ReactNode;
   }
>(function HeaderIconButton({ icon, label, title, className = '', children, ...rest }, ref) {
   return (
      <button
         ref={ref}
         type="button"
         aria-label={label}
         title={title ?? label}
         className={`pressable inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-ink-3 hover:text-brand ${className}`.trim()}
         {...rest}
      >
         <Icon icon={icon} size={16} />
         {children}
      </button>
   );
});

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
 * Additions and deletions, colored green/red in the weight popover — the
 * GitHub-familiar read the owner asked for. Contained to that one popover call
 * site: the board's rows still reserve red for broken CI and green for a live
 * sign-off, so this detail-panel count borrows the hues without teaching the
 * eye to tune them out on a row. Hidden when the wire didn't send a size.
 */
export function DiffSize({ additions, deletions }: { additions: number; deletions: number }) {
   return (
      <span className="whitespace-nowrap tabular-nums" title={`+${additions} −${deletions} lines`}>
         <span className="text-[var(--ok)]">+{additions}</span>{' '}
         <span className="text-[var(--bad)]">−{deletions}</span>
      </span>
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
