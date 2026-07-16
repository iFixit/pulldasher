import type { Status, Weight } from '../model/status';
import { loginHue } from '../format';

export const STATUS_LABEL: Record<Status, string> = {
   ready: 'Ready',
   needs_recr: 'Re-stamp',
   needs_qa: 'Needs QA',
   needs_cr: 'Needs CR',
   blocked: 'Blocked',
   ci_red: 'CI red',
   draft: 'Draft',
};

const STATUS_CLASS: Record<Status, string> = {
   ready: 'badge-ready',
   needs_recr: 'badge-recr',
   needs_qa: 'badge-qa',
   needs_cr: 'badge-cr',
   blocked: 'badge-blocked',
   ci_red: 'badge-red',
   draft: 'badge-draft',
};

export const STATUS_DOT: Record<Status, string> = {
   ready: 'var(--ok)',
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
   const style = {
      background: `hsl(${loginHue(login)} 45% 45%)`,
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
         title={login}
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
      <span className={`chip-w chip-w-${weight}`} title="review weight">
         {weight}
      </span>
   );
}

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
   const total = Math.max(req, have);
   return (
      <span className="inline-flex items-center gap-[3px]">
         <span className="text-[11px] font-medium text-ink-3">{label}</span>
         {have === 0 && stale ? (
            <i className="pip pip-stale" title="stamp invalidated by a push" />
         ) : (
            Array.from({ length: total }, (_, i) => (
               <i key={i} className={`pip ${i < have ? 'pip-full' : ''}`} />
            ))
         )}
      </span>
   );
}

export function Heat({ days }: { days: number }) {
   const n = Math.min(5, Math.ceil((days + 1) / 7));
   const tone = days >= 28 ? 'heat-hot' : days >= 14 ? 'heat-warm' : '';
   return (
      <span className="inline-flex gap-[2px]" title={`${days}d old`}>
         {Array.from({ length: 5 }, (_, i) => (
            <i
               key={i}
               className={`heat-bar ${i < n ? tone : ''}`}
               style={i >= n ? { opacity: 0.25 } : undefined}
            />
         ))}
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
