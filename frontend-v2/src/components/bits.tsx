import type { Status, Weight } from '../model/status';
import type { Signature } from '../types';
import { ago, githubUrl, loginHue, shortRepo } from '../format';
import { usePopover } from './usePopover';

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
   deploy_block: 'Deploy hold',
   unmergeable: "Can't merge",
   ci_red: 'CI red',
   draft: 'Draft',
};

const STATUS_CLASS: Record<Status, string> = {
   ready: 'badge-ready',
   ci_pending: 'badge-blocked',
   needs_recr: 'badge-recr',
   needs_qa: 'badge-qa',
   needs_cr: 'badge-cr',
   dev_block: 'badge-blocked',
   deploy_block: 'badge-hold',
   unmergeable: 'badge-blocked',
   ci_red: 'badge-red',
   draft: 'badge-draft',
};

export const STATUS_DOT: Record<Status, string> = {
   ready: 'var(--ok)',
   ci_pending: 'var(--warn)',
   needs_recr: 'var(--brand)',
   needs_qa: 'var(--violet)',
   needs_cr: 'var(--ink-3)',
   dev_block: 'var(--warn)',
   deploy_block: 'var(--ink-3)',
   unmergeable: 'var(--warn)',
   ci_red: 'var(--bad)',
   draft: 'var(--border)',
};

export function StatusBadge({ status }: { status: Status }) {
   return <span className={`badge ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>;
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
      'inline-flex flex-none items-center justify-center rounded-full font-semibold uppercase text-white transition-[scale] duration-150 motion-reduce:transition-none';
   return onClick ? (
      <button
         type="button"
         className={`${cls} cursor-pointer border-0 p-0 hover:scale-115`}
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

export function WeightChip({ weight }: { weight: Weight }) {
   return (
      <span className={`chip-w chip-w-${weight}`} title="estimated review effort, from diff size">
         {weight}
      </span>
   );
}

/**
 * Sign-off state as a fixed-slot ledger: label and value each hold a constant
 * width so CR, QA, and age land at the same x on every row and read as
 * vertical columns down a board. A green check when satisfied, a fraction
 * while outstanding — with an amber slash appended whenever any stamp was
 * invalidated by a push (partial staleness is the single most actionable
 * state on the board; it must never hide inside a plain fraction) — and a
 * muted dash when nothing is required. The slot never collapses. A dotted
 * underline marks the slot you personally stamped.
 */
export function Pips({
   label,
   have,
   req,
   by = [],
   staleBy = [],
   me,
}: {
   label: string;
   have: number;
   req: number;
   /** users with a live stamp */
   by?: string[];
   /** users whose stamp a push invalidated */
   staleBy?: string[];
   me?: string;
}) {
   const none = !req && !have && !staleBy.length;
   const met = !none && have >= req;
   const mine = me != null && by.includes(me);
   const owedByMe = me != null && staleBy.includes(me);
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
   return (
      <span className="inline-flex items-baseline gap-1" aria-label={aria}>
         <span aria-hidden className="w-[18px] text-[11px] font-medium text-ink-3">
            {label}
         </span>
         {none ? (
            <span aria-hidden className="w-[34px] text-xs text-ink-3 opacity-60">
               –
            </span>
         ) : met ? (
            <span
               aria-hidden
               className={`w-[34px] text-xs font-semibold ${mine ? 'underline decoration-dotted underline-offset-2' : ''}`}
               style={{ color: 'var(--ok)' }}
               title={mine ? 'done — including your stamp' : 'done'}
            >
               ✓
            </span>
         ) : (
            <span
               aria-hidden
               className={`w-[34px] text-xs tabular-nums ${
                  mine || owedByMe ? 'underline decoration-dotted underline-offset-2' : ''
               } ${staleBy.length ? '' : 'text-ink-2'}`}
               style={staleBy.length ? { color: 'var(--warn)' } : undefined}
               title={
                  staleBy.length
                     ? `${staleBy.join(', ')} stamped an earlier version; a push invalidated it`
                     : mine
                       ? 'your stamp counts here'
                       : undefined
               }
            >
               {have}/{req}
               {staleBy.length > 0 && <span className="font-semibold">⊘</span>}
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
   const pop = usePopover<HTMLSpanElement, HTMLButtonElement>();
   const pips = <Pips label={label} have={have} req={req} by={by} staleBy={staleBy} me={me} />;
   if (!sigs.length) return pips;

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
      <span className="relative inline-flex" ref={pop.rootRef}>
         <button
            ref={pop.triggerRef}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={pop.open}
            title={`who ${label}’d this — click for details`}
            onClick={() => pop.setOpen(o => !o)}
            className="cursor-pointer rounded border-0 bg-transparent p-0 text-left hover:bg-secondary/60"
         >
            {pips}
         </button>
         {pop.open && (
            <span
               ref={pop.panelRef}
               tabIndex={-1}
               role="dialog"
               aria-label={`${label} signatures`}
               className="popover absolute top-full right-0 z-50 mt-1 block w-max min-w-[190px] rounded-lg border border-line bg-surface p-2 text-xs whitespace-nowrap shadow-md outline-none"
            >
               <span className="block px-1 pb-1 font-semibold text-ink">{label} stamps</span>
               {rows.map(s => (
                  <span
                     key={s.data.user.login}
                     className="flex items-center gap-1.5 px-1 py-[3px] text-ink-2"
                  >
                     <Avatar login={s.data.user.login} size={16} />
                     <b className="font-medium text-ink">{s.data.user.login}</b>
                     {s.data.user.login === me && <span className="text-ink-3">(you)</span>}
                     <span className="ml-auto pl-3 text-ink-3 tabular-nums">
                        {ago(Date.parse(s.data.created_at) / 1000)} ago
                     </span>
                     {s.data.active ? (
                        <span className="font-semibold" style={{ color: 'var(--ok)' }}>
                           ✓
                        </span>
                     ) : (
                        <span
                           className="font-semibold"
                           style={{ color: 'var(--warn)' }}
                           title="invalidated by a later push"
                        >
                           ⊘
                        </span>
                     )}
                  </span>
               ))}
            </span>
         )}
      </span>
   );
}

/**
 * The age slot: open-days with an urgency ramp (quiet under a week, amber
 * past STARVE_DAYS, red past two) and both clocks in the tooltip — a 30-day
 * pull pushed an hour ago is hot, and the flat gray number hid that.
 */
export function AgeStamp({
   ageDays,
   updatedAt,
   quiet,
}: {
   ageDays: number;
   /** epoch secs of the last activity */
   updatedAt: number;
   /** drafts and holds age on purpose: no urgency color */
   quiet?: boolean;
}) {
   const hot = quiet ? null : ageDays >= 14 ? 'var(--bad)' : ageDays >= 7 ? 'var(--warn)' : null;
   return (
      <span
         className={`w-7 text-right tabular-nums ${hot ? 'font-medium' : ''}`}
         style={hot ? { color: hot } : undefined}
         title={`opened ${ageDays} ${ageDays === 1 ? 'day' : 'days'} ago · last activity ${ago(updatedAt)} ago`}
      >
         {ageDays}d
      </span>
   );
}

/** The full-title GitHub link every row variant renders — never truncated. */
export function PullTitleLink({
   repo,
   number,
   title,
   onOpen,
}: {
   repo: string;
   number: number;
   title: string;
   /** fired when the user opens the PR — the row's natural "seen" ack */
   onOpen?: () => void;
}) {
   return (
      <a
         className="font-medium hover:underline hover:underline-offset-2"
         href={githubUrl(repo, number)}
         target="_blank"
         rel="noopener noreferrer"
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
