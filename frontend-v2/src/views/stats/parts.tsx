import { type PointerEvent as ReactPointerEvent, type ReactNode, useState } from 'react';
import { Avatar } from '../../components/identity';
import type { Weight } from '../../model/status';

/**
 * The light→heavy color read every weight surface shares. Weight/effort is
 * always neutral ink — never a hue — so heaviness reads as opacity of one
 * token instead of borrowing colors that mean something else (--ok, --warn,
 * --bad) on the board.
 */
export const WEIGHT_RAMP: Record<Weight, string> = {
   XS: 'color-mix(in oklab, var(--ink-3) 35%, transparent)',
   S: 'color-mix(in oklab, var(--ink-3) 50%, transparent)',
   M: 'color-mix(in oklab, var(--ink-3) 65%, transparent)',
   L: 'color-mix(in oklab, var(--ink-3) 82%, transparent)',
   XL: 'var(--ink-3)',
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
 * A {@link BarRow} whose fill carries a highlighted inner segment — a
 * subset's share of the row's OWN total (e.g. how much of a repo's pile is
 * still awaiting CR) — instead of trailing it as text the reader has to
 * cross-reference against the bar.
 */
export function SplitBarRow({
   lead,
   pct,
   splitPct,
   color,
   splitColor,
   trail,
   title,
}: {
   lead: ReactNode;
   /** 0–100, the row's total as a share of the column max */
   pct: number;
   /** 0–100, the highlighted subset as a share of THIS row's own total */
   splitPct: number;
   color: string;
   splitColor: string;
   trail?: ReactNode;
   title?: string;
}) {
   return (
      <div className="flex items-center gap-2 text-[13px]" title={title}>
         {lead}
         <div className="h-2 flex-1 overflow-hidden rounded bg-secondary">
            <div
               className="relative h-full rounded"
               style={{ width: `${pct}%`, background: color }}
            >
               {splitPct > 0 && (
                  <div
                     className="absolute inset-y-0 right-0"
                     style={{ width: `${splitPct}%`, background: splitColor }}
                  />
               )}
            </div>
         </div>
         {trail}
      </div>
   );
}

/**
 * Two thin bars stacked in one row, sharing one scale — a person's "given"
 * over their "received" (or any other two-series-per-entity comparison)
 * where both numbers need to read as comparably sized, not one bar plus
 * trailing text.
 */
export function PairedBarRow({
   lead,
   aPct,
   bPct,
   colorA,
   colorB,
   aTrail,
   bTrail,
   title,
}: {
   lead: ReactNode;
   aPct: number;
   bPct: number;
   colorA: string;
   colorB: string;
   aTrail?: ReactNode;
   bTrail?: ReactNode;
   title?: string;
}) {
   return (
      <div className="flex items-center gap-2 text-[13px]" title={title}>
         {lead}
         <div className="flex flex-1 flex-col gap-[3px]">
            <div className="flex h-[7px] items-center gap-1.5">
               <div className="h-full flex-1 overflow-hidden rounded bg-secondary">
                  <div
                     className="h-full rounded"
                     style={{ width: `${aPct}%`, background: colorA }}
                  />
               </div>
               {aTrail}
            </div>
            <div className="flex h-[7px] items-center gap-1.5">
               <div className="h-full flex-1 overflow-hidden rounded bg-secondary">
                  <div
                     className="h-full rounded"
                     style={{ width: `${bPct}%`, background: colorB }}
                  />
               </div>
               {bTrail}
            </div>
         </div>
      </div>
   );
}

/**
 * A single thin fill bar with no label — the shared-max glyph under a
 * standalone number tile (Debt's 2×2 grid) where a full {@link BarRow}'s
 * lead/trail row layout doesn't fit.
 */
export function MiniMeter({ pct, color }: { pct: number; color: string }) {
   return (
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
         <div
            className="h-full rounded-full"
            style={{ width: `${Math.max(pct, 0)}%`, background: color }}
         />
      </div>
   );
}

export interface LineSeries {
   label: string;
   color: string;
   values: number[];
   /** which y-axis this series scales against; default 'left' */
   axis?: 'left' | 'right';
   dashed?: boolean;
   /** low-opacity fill from the line down to the zero baseline — reserve for one primary series */
   area?: boolean;
}

export interface BarSeries {
   label: string;
   color: string;
   values: number[];
   axis?: 'left' | 'right';
}

export interface LineChartBand {
   /** index into `series` for the two lines to shade the area between */
   a: number;
   b: number;
   color?: string;
}

const CHART_W = 600;

function axisExtent(values: number[]): { min: number; max: number } {
   const min = Math.min(0, ...values, 0);
   const max = Math.max(...values, 1);
   return { min, max: max <= min ? min + 1 : max };
}

function scaleY(v: number, min: number, max: number, top: number, bottom: number): number {
   if (max === min) return bottom;
   return bottom - ((v - min) / (max - min)) * (bottom - top);
}

/**
 * An inline multi-series SVG line chart — hand-rolled to the same "component
 * with hard-coded scale math" style as {@link PeriodColumns}, since no
 * charting library is a dependency here. Supports an optional bar series
 * underlay (for a bars-vs-line "volume vs speed" panel), a dual left/right
 * axis, a low-opacity area fill under one primary line, and a shaded band
 * between two lines (e.g. opened vs merged, so backlog growth/shrink reads
 * at a glance). Handles zero, one, or short series without throwing — an
 * empty chart just renders its gridlines.
 */
export function LineChart({
   series,
   bars,
   axisTicks,
   band,
   pointLabels,
   height = 120,
   ariaLabel,
}: {
   series: LineSeries[];
   bars?: BarSeries[];
   axisTicks?: AxisTick[];
   band?: LineChartBand;
   /** one label per x-position for the hover tooltip's header (a date, week,
    * or month) — the sparse axisTicks can't name every point */
   pointLabels?: string[];
   /** chart height in px; width always fills the container */
   height?: number;
   ariaLabel: string;
}) {
   // click a legend entry to hide its series/bar (and rescale to what's left);
   // hover the plot for a crosshair + a per-point value tooltip. Both are
   // hand-rolled here rather than pulling in a charting dependency — the data
   // is tiny and the SVG already themes through CSS vars for free.
   const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
   const [hover, setHover] = useState<number | null>(null);
   const toggle = (label: string) =>
      setHidden(h => {
         const next = new Set(h);
         if (next.has(label)) next.delete(label);
         else next.add(label);
         return next;
      });

   const allBars = bars ?? [];
   const n = Math.max(0, ...series.map(s => s.values.length), ...allBars.map(b => b.values.length));
   const pad = 6;
   const top = 8;
   const bottom = height - 8;
   // hiding a series rescales the axes to what's left — the point of isolating
   // one line to read its own trend without the others' range swamping it
   const visSeries = series.filter(s => !hidden.has(s.label));
   const visBars = allBars.filter(b => !hidden.has(b.label));
   const leftValues = [
      ...visSeries.filter(s => s.axis !== 'right').flatMap(s => s.values),
      ...visBars.filter(b => b.axis !== 'right').flatMap(b => b.values),
   ];
   const rightValues = [
      ...visSeries.filter(s => s.axis === 'right').flatMap(s => s.values),
      ...visBars.filter(b => b.axis === 'right').flatMap(b => b.values),
   ];
   const left = axisExtent(leftValues);
   const right = axisExtent(rightValues);
   const x = (i: number) => (n <= 1 ? CHART_W / 2 : pad + (i * (CHART_W - 2 * pad)) / (n - 1));
   const yFor = (v: number, axis?: 'left' | 'right') =>
      axis === 'right'
         ? scaleY(v, right.min, right.max, top, bottom)
         : scaleY(v, left.min, left.max, top, bottom);
   const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => top + f * (bottom - top));
   const slot = n > 0 ? (CHART_W - 2 * pad) / n : 0;
   const hasLegend = series.length > 0 || allBars.length > 0;

   const bandVisible =
      band != null &&
      series[band.a] != null &&
      series[band.b] != null &&
      !hidden.has(series[band.a].label) &&
      !hidden.has(series[band.b].label) &&
      n > 1;

   const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
      if (n === 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const frac = (e.clientX - rect.left) / rect.width;
      const i = n <= 1 ? 0 : Math.round((frac * CHART_W - pad) / ((CHART_W - 2 * pad) / (n - 1)));
      setHover(Math.max(0, Math.min(n - 1, i)));
   };
   const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
   const hoverFrac = hover != null ? x(hover) / CHART_W : 0;
   // flip the tooltip to the left of the crosshair once it's past ~60% so it
   // never runs off the right edge
   const flip = hoverFrac > 0.6;

   return (
      <div className="relative">
         <svg
            viewBox={`0 0 ${CHART_W} ${height}`}
            preserveAspectRatio="none"
            className="w-full"
            // pan-y (not none): vertical page-scroll stays native on touch,
            // only horizontal drags feed the hover scrub — the crosshair's
            // one axis. touchAction:none blocked scrolling a finger over a chart
            style={{ height, touchAction: 'pan-y' }}
            role="img"
            aria-label={ariaLabel}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
         >
            <title>{ariaLabel}</title>
            {gridLines.map(y => (
               <line
                  key={y}
                  x1={0}
                  x2={CHART_W}
                  y1={y}
                  y2={y}
                  stroke="var(--border)"
                  strokeWidth={1}
               />
            ))}
            {visBars.map(b => {
               const barW = Math.max(slot * 0.55, 1.5);
               return (
                  <g key={b.label}>
                     {b.values.map((v, i) => {
                        const y0 = yFor(0, b.axis);
                        const y1 = yFor(v, b.axis);
                        return (
                           <rect
                              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length positional series, order never changes
                              key={i}
                              x={x(i) - barW / 2}
                              y={Math.min(y0, y1)}
                              width={barW}
                              height={Math.max(Math.abs(y0 - y1), v !== 0 ? 1 : 0)}
                              fill={b.color}
                              opacity={0.85}
                              rx={1}
                           />
                        );
                     })}
                  </g>
               );
            })}
            {bandVisible && band && series[band.a] && series[band.b] && (
               <polygon
                  points={[
                     ...series[band.a].values.map(
                        (v, i) => `${x(i)},${yFor(v, series[band.a].axis)}`
                     ),
                     ...[...series[band.b].values]
                        .map((v, i) => `${x(i)},${yFor(v, series[band.b].axis)}`)
                        .reverse(),
                  ].join(' ')}
                  fill={band.color ?? series[band.a].color}
                  opacity={0.12}
               />
            )}
            {visSeries.map(s => {
               if (s.values.length === 0) return null;
               const pts = s.values.map((v, i) => [x(i), yFor(v, s.axis)] as const);
               const path = pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px},${py}`).join(' ');
               const [lastX, lastY] = pts[pts.length - 1];
               const baseline = yFor(0, s.axis);
               return (
                  <g key={s.label}>
                     {s.area && pts.length > 1 && (
                        <polygon
                           points={`${pts.map(([px, py]) => `${px},${py}`).join(' ')} ${lastX},${baseline} ${pts[0][0]},${baseline}`}
                           fill={s.color}
                           opacity={0.12}
                        />
                     )}
                     {pts.length > 1 && (
                        <path
                           d={path}
                           fill="none"
                           stroke={s.color}
                           strokeWidth={2}
                           strokeDasharray={s.dashed ? '4 3' : undefined}
                           strokeLinecap="round"
                           strokeLinejoin="round"
                        />
                     )}
                     <circle cx={lastX} cy={lastY} r={3} fill={s.color} />
                  </g>
               );
            })}
            {hover != null && (
               <g aria-hidden pointerEvents="none">
                  <line
                     x1={x(hover)}
                     x2={x(hover)}
                     y1={top}
                     y2={bottom}
                     stroke="var(--ink-3)"
                     strokeWidth={1}
                     strokeDasharray="3 3"
                     opacity={0.55}
                  />
                  {visBars.map(b =>
                     b.values[hover] != null ? (
                        <circle
                           key={`hb-${b.label}`}
                           cx={x(hover)}
                           cy={yFor(b.values[hover], b.axis)}
                           r={2.5}
                           fill={b.color}
                        />
                     ) : null
                  )}
                  {visSeries.map(s =>
                     s.values[hover] != null ? (
                        <circle
                           key={`hs-${s.label}`}
                           cx={x(hover)}
                           cy={yFor(s.values[hover], s.axis)}
                           r={3}
                           fill={s.color}
                           stroke="var(--surface)"
                           strokeWidth={1}
                        />
                     ) : null
                  )}
               </g>
            )}
         </svg>
         {hover != null && (
            <div
               className="pointer-events-none absolute z-10 rounded-md border border-line bg-surface px-2 py-1 text-[11px] shadow-sm"
               style={{
                  left: `${hoverFrac * 100}%`,
                  top: 2,
                  transform: flip ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
               }}
            >
               {pointLabels?.[hover] && (
                  <div className="mb-0.5 font-semibold text-ink">{pointLabels[hover]}</div>
               )}
               {visBars.map(b =>
                  b.values[hover] != null ? (
                     <div
                        key={b.label}
                        className="flex items-center gap-1.5 whitespace-nowrap text-ink-2"
                     >
                        <span
                           aria-hidden
                           className="inline-block h-2 w-2 rounded-[2px]"
                           style={{ background: b.color }}
                        />
                        <span>{b.label}</span>
                        <b className="ml-auto pl-3 font-semibold text-ink tabular-nums">
                           {fmt(b.values[hover])}
                        </b>
                     </div>
                  ) : null
               )}
               {visSeries.map(s =>
                  s.values[hover] != null ? (
                     <div
                        key={s.label}
                        className="flex items-center gap-1.5 whitespace-nowrap text-ink-2"
                     >
                        <span
                           aria-hidden
                           className="inline-block h-[2px] w-3"
                           style={{ background: s.color, opacity: s.dashed ? 0.6 : 1 }}
                        />
                        <span>{s.label}</span>
                        <b className="ml-auto pl-3 font-semibold text-ink tabular-nums">
                           {fmt(s.values[hover])}
                        </b>
                     </div>
                  ) : null
               )}
            </div>
         )}
         <AxisLabels ticks={axisTicks} count={n} />
         {hasLegend && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-3">
               {series.map(s => {
                  const off = hidden.has(s.label);
                  return (
                     <button
                        key={s.label}
                        type="button"
                        onClick={() => toggle(s.label)}
                        aria-pressed={!off}
                        title={off ? `show ${s.label}` : `hide ${s.label} — isolate the rest`}
                        className={`pressable inline-flex items-center gap-1.5 ${
                           off ? 'text-ink-3 line-through opacity-50' : 'hover:text-ink'
                        }`}
                     >
                        <span
                           aria-hidden
                           className="inline-block h-[2px] w-3"
                           style={{ background: s.color, opacity: s.dashed ? 0.6 : 1 }}
                        />
                        {s.label}
                     </button>
                  );
               })}
               {allBars.map(b => {
                  const off = hidden.has(b.label);
                  return (
                     <button
                        key={b.label}
                        type="button"
                        onClick={() => toggle(b.label)}
                        aria-pressed={!off}
                        title={off ? `show ${b.label}` : `hide ${b.label} — isolate the rest`}
                        className={`pressable inline-flex items-center gap-1.5 ${
                           off ? 'text-ink-3 line-through opacity-50' : 'hover:text-ink'
                        }`}
                     >
                        <span
                           aria-hidden
                           className="inline-block h-2 w-2 rounded-[2px]"
                           style={{ background: b.color }}
                        />
                        {b.label}
                     </button>
                  );
               })}
            </div>
         )}
      </div>
   );
}

export interface DonutSlice {
   label: string;
   value: number;
   color: string;
}

/**
 * A compact part-to-whole donut for a mutually-exclusive set (e.g. the five
 * weight buckets summing to the open total) — a center total plus a compact
 * legend. Not for categories that can overlap (friction, debt): those stay
 * bars, since a donut implies the slices sum to the whole.
 */
export function Donut({
   slices,
   size = 84,
   thickness = 12,
   centerSub,
   ariaLabel,
}: {
   slices: DonutSlice[];
   size?: number;
   thickness?: number;
   /** small caption under the center total, e.g. "open" */
   centerSub?: string;
   ariaLabel: string;
}) {
   const total = slices.reduce((a, s) => a + s.value, 0);
   const r = (size - thickness) / 2;
   const c = 2 * Math.PI * r;
   const cx = size / 2;
   const cy = size / 2;
   let offset = 0;

   return (
      <div className="flex items-center gap-3">
         <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            role="img"
            aria-label={ariaLabel}
            className="flex-none"
         >
            <title>{ariaLabel}</title>
            <circle
               cx={cx}
               cy={cy}
               r={r}
               fill="none"
               stroke="var(--secondary)"
               strokeWidth={thickness}
            />
            {total > 0 &&
               slices
                  .filter(s => s.value > 0)
                  .map(s => {
                     const frac = s.value / total;
                     const dash = frac * c;
                     const el = (
                        <circle
                           key={s.label}
                           cx={cx}
                           cy={cy}
                           r={r}
                           fill="none"
                           stroke={s.color}
                           strokeWidth={thickness}
                           strokeDasharray={`${dash} ${c - dash}`}
                           strokeDashoffset={-offset}
                           transform={`rotate(-90 ${cx} ${cy})`}
                        />
                     );
                     offset += dash;
                     return el;
                  })}
            <text
               x={cx}
               y={cy - (centerSub ? 4 : 0)}
               textAnchor="middle"
               dominantBaseline="middle"
               style={{ fill: 'var(--ink)' }}
               className="text-[15px] font-semibold tabular-nums"
            >
               {total}
            </text>
            {centerSub && (
               <text
                  x={cx}
                  y={cy + 12}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ fill: 'var(--ink-3)' }}
                  className="text-[8px]"
               >
                  {centerSub}
               </text>
            )}
         </svg>
         <ul className="flex flex-col gap-1 text-[11px] text-ink-2">
            {slices.map(s => (
               <li key={s.label} className="flex items-center gap-1.5">
                  <span
                     aria-hidden
                     className="h-2 w-2 flex-none rounded-[2px]"
                     style={{ background: s.color }}
                  />
                  <span className="flex-1 whitespace-nowrap">{s.label}</span>
                  <span className="font-medium text-ink tabular-nums">{s.value}</span>
               </li>
            ))}
         </ul>
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
         {/* min-w-0 + truncate, not flex-none: a long GitHub login (up to 39
             chars) must yield to the bar/trail instead of overflowing the card
             into page-level horizontal scroll on a phone */}
         <span className="min-w-0 flex-1 truncate font-semibold text-ink" title={login}>
            {mine ? <span className="text-brand">{login}</span> : login}
            {mine && <span className="ml-1 text-ink-3">you</span>}
         </span>
      </>
   );
}
