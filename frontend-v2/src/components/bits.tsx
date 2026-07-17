import type { Status, Weight } from '../model/status';
import { loginHue, shortRepo } from '../format';

export const STATUS_LABEL: Record<Status, string> = {
   ready: 'Ready to merge',
   // only at the ready gate: fully signed off, nothing left but a green build.
   // 'CI running' would lie — a needs-CR pull can have CI running too.
   ci_pending: 'Only CI left',
   needs_recr: 'Needs re-CR',
   needs_qa: 'Needs QA',
   needs_cr: 'Needs CR',
   blocked: 'Blocked',
   ci_red: 'CI red',
   draft: 'Draft',
};

const STATUS_CLASS: Record<Status, string> = {
   ready: 'badge-ready',
   ci_pending: 'badge-blocked',
   needs_recr: 'badge-recr',
   needs_qa: 'badge-qa',
   needs_cr: 'badge-cr',
   blocked: 'badge-blocked',
   ci_red: 'badge-red',
   draft: 'badge-draft',
};

export const STATUS_DOT: Record<Status, string> = {
   ready: 'var(--ok)',
   ci_pending: 'var(--warn)',
   needs_recr: 'var(--brand)',
   needs_qa: 'var(--violet)',
   needs_cr: 'var(--ink-3)',
   blocked: 'var(--warn)',
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
 * while outstanding, an amber slash when a push invalidated the stamp, and a
 * muted dash when nothing is required — the slot never collapses.
 */
export function Pips({
   label,
   have,
   req,
   stale,
}: {
   label: string;
   have: number;
   req: number;
   stale?: boolean;
}) {
   const none = !req && !have;
   const staleNote = stale && have === 0;
   const met = !none && have >= req;
   const aria = none
      ? `${label} not required`
      : `${label} ${have} of ${req}${staleNote ? ', earlier stamp invalidated by a push' : met ? ', done' : ''}`;
   return (
      <span className="inline-flex items-baseline gap-1" aria-label={aria}>
         <span aria-hidden className="w-[18px] text-[11px] font-medium text-ink-3">
            {label}
         </span>
         {none ? (
            <span aria-hidden className="w-[26px] text-xs text-ink-3 opacity-60">
               –
            </span>
         ) : staleNote ? (
            <span
               aria-hidden
               className="w-[26px] text-xs font-semibold"
               style={{ color: 'var(--warn)' }}
               title="stamp invalidated by a push"
            >
               ⊘
            </span>
         ) : met ? (
            <span
               aria-hidden
               className="w-[26px] text-xs font-semibold"
               style={{ color: 'var(--ok)' }}
            >
               ✓
            </span>
         ) : (
            <span aria-hidden className="w-[26px] text-xs text-ink-2 tabular-nums">
               {have}/{req}
            </span>
         )}
      </span>
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
