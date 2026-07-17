import type { ReactNode } from 'react';
import { Avatar } from '../../components/bits';

/**
 * The shared chrome every Stats card wore by hand: a rounded surface panel
 * with an optional title + muted subtitle. Cards with a bespoke header (the
 * status breakdown's big count) pass no title and render their own.
 */
export function StatsCard({
   title,
   sub,
   children,
}: {
   title?: string;
   sub?: ReactNode;
   children: ReactNode;
}) {
   return (
      <section className="rounded-2xl border border-line bg-surface p-4">
         {title && (
            <h3 className="m-0 text-sm font-semibold text-ink">
               {title}
               {sub && <span className="ml-2 text-xs text-ink-3">{sub}</span>}
            </h3>
         )}
         {children}
      </section>
   );
}

/**
 * One horizontal bar in a stats card: a leading label, a fill proportional to
 * the row's share, and a trailing value. The pct-of-max math and the fill
 * color stay with the caller, since each card ramps color its own way.
 */
export function BarRow({
   lead,
   pct,
   color,
   trail,
   title,
}: {
   lead: ReactNode;
   /** 0–100, the caller's value as a share of the column max */
   pct: number;
   color: string;
   trail?: ReactNode;
   title?: string;
}) {
   return (
      <div className="flex items-center gap-2 text-[13px]" title={title}>
         {lead}
         <div className="h-2 flex-1 overflow-hidden rounded bg-secondary">
            <div className="h-full rounded" style={{ width: `${pct}%`, background: color }} />
         </div>
         {trail}
      </div>
   );
}

/**
 * Avatar + login, the current user tinted brand and tagged "you" — the leading
 * cell the leaderboard and starvation cards render the same way.
 */
export function PersonCell({
   login,
   me,
   onPerson,
}: {
   login: string;
   me?: string;
   onPerson?: (login: string) => void;
}) {
   const mine = login === me;
   return (
      <>
         <Avatar login={login} size={20} onClick={onPerson} />
         <span className="flex-none font-semibold text-ink">
            {mine ? <span className="text-brand">{login}</span> : login}
            {mine && <span className="ml-1 text-ink-3">you</span>}
         </span>
      </>
   );
}
