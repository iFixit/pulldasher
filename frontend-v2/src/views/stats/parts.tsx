import type { ReactNode } from 'react';
import { Avatar } from '../../components/bits';
import type { Weight } from '../../model/status';
import type { DayCount } from '../../model/stats';

/** the light→heavy color read every weight surface shares */
export const WEIGHT_RAMP: Record<Weight, string> = {
   XS: 'var(--ok)',
   S: 'var(--ok)',
   M: 'var(--ink-3)',
   L: 'var(--warn)',
   XL: 'var(--bad)',
};

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
 * A day-per-column mini chart: one rounded bar per day, height proportional
 * to the column max, today rightmost. Each column carries its date + count as
 * a tooltip; zero days keep a 2px stub so the timeline reads continuous.
 */
export function MiniColumns({
   days,
   color,
   unit,
}: {
   days: DayCount[];
   color: string;
   unit: string;
}) {
   const max = Math.max(...days.map(d => d.count), 1);
   return (
      <div className="flex h-16 items-end gap-1" role="img" aria-label={`${unit} per day`}>
         {days.map(d => (
            <div
               key={d.day}
               className="min-w-0 flex-1 rounded-t-[3px]"
               title={`${new Date(d.day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${d.count} ${unit}`}
               style={{
                  height: d.count ? `${Math.max((d.count / max) * 100, 8)}%` : '2px',
                  background: d.count ? color : 'var(--secondary)',
               }}
            />
         ))}
      </div>
   );
}

export interface Period {
   /** stable React key, e.g. "2026-07" or "2026-W29" */
   key: string;
   /** tooltip text */
   title: string;
   value: number;
   /** an optional secondary value (e.g. that period's max) drawn as a thin mark */
   marker?: number;
}

/** where to print an axis label, e.g. one per quarter on a 12-month chart */
export interface AxisTick {
   index: number;
   label: string;
}

function AxisLabels({ ticks, count }: { ticks?: AxisTick[]; count: number }) {
   if (!ticks?.length) return null;
   return (
      <div className="relative mt-1 h-3.5 text-[10px] text-ink-3">
         {ticks.map(t => (
            <span
               key={t.index}
               className="absolute -translate-x-1/2 whitespace-nowrap"
               style={{ left: `${((t.index + 0.5) / count) * 100}%` }}
            >
               {t.label}
            </span>
         ))}
      </div>
   );
}

/**
 * A month/week/day-per-column chart, like MiniColumns but for longer history
 * windows: each column carries a title tooltip and an optional thin marker
 * line (e.g. that period's max, above an avg bar) so an outlier doesn't
 * vanish inside a tame-looking average. Optional axis ticks label a subset of
 * columns (e.g. every quarter) since 12+ columns is too dense to label all of.
 */
export function PeriodColumns({
   periods,
   color,
   axisTicks,
}: {
   periods: Period[];
   color: string;
   axisTicks?: AxisTick[];
}) {
   const max = Math.max(...periods.map(p => Math.max(p.value, p.marker ?? 0)), 1);
   return (
      <div>
         <div className="flex h-16 gap-1">
            {periods.map(p => (
               <div key={p.key} className="relative min-w-0 flex-1" title={p.title}>
                  <div
                     className="absolute inset-x-0 bottom-0 rounded-t-[3px]"
                     style={{
                        height: p.value ? `${Math.max((p.value / max) * 100, 8)}%` : '2px',
                        background: p.value ? color : 'var(--secondary)',
                     }}
                  />
                  {p.marker != null && p.marker > 0 && (
                     <div
                        className="absolute inset-x-0 h-[2px] rounded-full"
                        style={{
                           bottom: `${Math.min((p.marker / max) * 100, 100)}%`,
                           background: 'var(--ink-3)',
                        }}
                     />
                  )}
               </div>
            ))}
         </div>
         <AxisLabels ticks={axisTicks} count={periods.length} />
      </div>
   );
}

export interface PairedPeriod {
   key: string;
   title: string;
   a: number;
   b: number;
}

/**
 * Two-series twin of {@link PeriodColumns} — a pair of adjacent bars per
 * column (e.g. opened vs merged per month) sharing one scale.
 */
export function PairedPeriodColumns({
   periods,
   colorA,
   colorB,
   axisTicks,
}: {
   periods: PairedPeriod[];
   colorA: string;
   colorB: string;
   axisTicks?: AxisTick[];
}) {
   const max = Math.max(...periods.map(p => Math.max(p.a, p.b)), 1);
   return (
      <div>
         <div className="flex h-16 gap-1">
            {periods.map(p => (
               <div key={p.key} className="flex min-w-0 flex-1 items-end gap-[2px]" title={p.title}>
                  <div
                     className="min-w-0 flex-1 rounded-t-[2px]"
                     style={{
                        height: p.a ? `${Math.max((p.a / max) * 100, 8)}%` : '2px',
                        background: p.a ? colorA : 'var(--secondary)',
                     }}
                  />
                  <div
                     className="min-w-0 flex-1 rounded-t-[2px]"
                     style={{
                        height: p.b ? `${Math.max((p.b / max) * 100, 8)}%` : '2px',
                        background: p.b ? colorB : 'var(--secondary)',
                     }}
                  />
               </div>
            ))}
         </div>
         <AxisLabels ticks={axisTicks} count={periods.length} />
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
