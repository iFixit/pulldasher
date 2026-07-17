import { ROT_DAYS, STARVE_DAYS, type Status, type Weight, weightRank } from '../model/status';
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

export function StatusBadge({ status, inline }: { status: Status; inline?: boolean }) {
   return (
      <span className={`badge ${STATUS_CLASS[status]} ${inline ? 'badge-inline' : ''}`}>
         {STATUS_LABEL[status]}
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

const WEIGHT_WORD: Record<Weight, string> = {
   XS: 'very light',
   S: 'light',
   M: 'medium',
   L: 'heavy',
   XL: 'very heavy',
};
// green for the cheap ones, gray at medium, amber then red as effort climbs —
// the same light→heavy read the old XS–XL colors carried, now as fill height
const WEIGHT_FILL = ['var(--ok)', 'var(--ok)', 'var(--ink-3)', 'var(--warn)', 'var(--bad)'];

/**
 * Review effort as a five-segment meter: how heavy this is to review, filled
 * by weight class and color-ramped. Always present, so the rightmost column
 * of every row answers "can I fit this in the time I have" at a glance. A
 * cheap prior from diff size; humans override by reading (dimmed when the
 * wire didn't send additions/deletions).
 */
export function WeightMeter({ weight, known = true }: { weight: Weight; known?: boolean }) {
   const fill = weightRank(weight) + 1;
   const color = WEIGHT_FILL[weightRank(weight)];
   const word = WEIGHT_WORD[weight];
   const label = known ? `review effort: ${word}` : `review effort: ${word} (size estimated)`;
   return (
      <span
         className="wt"
         role="img"
         aria-label={label}
         title={`${label}, from diff size`}
         style={{ opacity: known ? 1 : 0.45 }}
      >
         {[0, 1, 2, 3, 4].map(i => (
            <i key={i} style={i < fill ? { background: color } : undefined} />
         ))}
      </span>
   );
}

/**
 * Sign-off state as a pip meter: one square per required stamp, in a
 * fixed-width slot so CR, QA, and age land at the same x down a board. Filled
 * green = a live stamp; amber = a stamp a push invalidated, so a re-stamp is
 * owed (the single most actionable state on the board — it can't hide inside
 * a fraction); hollow = still needed; a muted dash = nothing required. A
 * dotted underline marks a slot you personally stamped. No check, no slash —
 * the fill is the whole vocabulary.
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
   return (
      <span className="inline-flex items-center gap-1" aria-label={aria} title={title}>
         <span aria-hidden className="w-[18px] text-[11px] font-medium text-ink-3">
            {label}
         </span>
         {none ? (
            <span aria-hidden className="flex w-[30px] justify-end text-xs text-ink-3 opacity-60">
               –
            </span>
         ) : (
            <span
               aria-hidden
               className={`flex w-[30px] items-center justify-end gap-1 ${
                  mine || owedByMe ? 'pip-mine' : ''
               }`}
            >
               {Array.from({ length: on }, (_, i) => (
                  <span key={`on${i}`} className="pip pip-on" />
               ))}
               {Array.from({ length: stale }, (_, i) => (
                  <span key={`st${i}`} className="pip pip-stale" />
               ))}
               {Array.from({ length: off }, (_, i) => (
                  <span key={`off${i}`} className="pip pip-off" />
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
                        <span className="pip pip-on" title="active stamp" />
                     ) : (
                        <span
                           className="pip pip-stale"
                           title="invalidated by a later push — a re-stamp is owed"
                        />
                     )}
                  </span>
               ))}
            </span>
         )}
      </span>
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
}: {
   ageDays: number;
   /** epoch secs the pull opened */
   createdAt: number;
   /** epoch secs of the last activity */
   updatedAt: number;
   /** drafts and holds age on purpose: no urgency color */
   quiet?: boolean;
}) {
   const hot = quiet
      ? null
      : ageDays >= ROT_DAYS
        ? 'var(--bad)'
        : ageDays >= STARVE_DAYS
          ? 'var(--warn)'
          : null;
   const text = ageDays === 0 ? ago(createdAt) : `${ageDays}d`;
   return (
      <span
         className={`w-7 text-right tabular-nums ${hot ? 'font-medium' : ''}`}
         style={hot ? { color: hot } : undefined}
         title={`opened ${ago(createdAt)} ago · last activity ${ago(updatedAt)} ago`}
      >
         {text}
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
   return (
      <a
         className={`font-medium hover:underline hover:underline-offset-2 ${stretch ? 'pd-link' : ''}`}
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
