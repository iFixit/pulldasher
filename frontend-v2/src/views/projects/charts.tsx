import type { ReactNode } from 'react';
import {
   Area,
   AreaChart,
   Bar,
   BarChart,
   CartesianGrid,
   Cell,
   ReferenceArea,
   ResponsiveContainer,
   Tooltip,
   XAxis,
   YAxis,
   type TooltipContentProps,
} from 'recharts';
import type { DayPoint, WeekPoint } from '../../../../shared/model/projects';
import { dayWords } from '../../model/projectData';

/**
 * The Projects tab's charts, on Recharts. It draws SVG, so every color here
 * is a CSS variable from styles.css and dark mode costs no redraw, the same
 * rule the hand-drawn Stats charts follow. This module is loaded lazily with
 * the views that chart, so the review board never downloads it.
 *
 * Every chart says what it counts: the unit sits over the y-axis, the
 * x-axis names the days or weeks, and hovering a mark gives its exact
 * numbers. Color vocabulary, shared with the Stats tab: ink for opened,
 * green for merged, brand for what is still open. No chart animates: on
 * this board motion means something changed.
 */

const axisTick = { fill: 'var(--ink-3)', fontSize: 10 };
const grid = <CartesianGrid stroke="var(--secondary)" vertical={false} />;
const xAxisProps = {
   tick: axisTick,
   tickLine: false,
   axisLine: { stroke: 'var(--border)' },
} as const;
const yAxisProps = {
   tick: axisTick,
   tickLine: false,
   axisLine: false,
   width: 40,
   allowDecimals: false,
} as const;

type DayRange = { start: string; end: string };

/** What a chart's y-axis counts, said over it where the eye starts. */
function Unit({ children }: { children: ReactNode }) {
   return <div className="mb-1 pl-1 text-[11px] font-medium text-ink-3">{children}</div>;
}

/** A chart's key, for two or more series: a swatch and a name each. */
function Key({ series }: { series: [string, string, number][] }) {
   return (
      <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-[11px] text-ink-2">
         {series.map(([name, color, opacity]) => (
            <li key={name} className="inline-flex items-center gap-1.5">
               <span
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ background: color, opacity }}
               />
               {name}
            </li>
         ))}
      </ul>
   );
}

/**
 * A veil over the days before the picked range: a chart draws at least 90
 * days so a short range still shows its trend, and the range the numbers
 * cover stays the bright part. (A bar chart fades its early bars instead,
 * since Recharts draws a veil under bars.)
 */
function veilBefore(days: DayPoint[], picked: DayRange | undefined) {
   const firstIn = picked ? days.findIndex(d => d.date >= picked.start) : -1;
   if (firstIn <= 0) return null;
   return (
      <ReferenceArea
         x1={days[0].date}
         x2={days[firstIn].date}
         fill="var(--surface)"
         fillOpacity={0.7}
         strokeOpacity={0}
      />
   );
}

/** The one tooltip look: the point's title, then a dot, a name and a number per line. */
function TipCard({ title, lines }: { title: ReactNode; lines: [string, number, string][] }) {
   return (
      <div className="rounded-lg border border-line bg-surface px-2.5 py-2 text-xs text-ink-2 shadow-sm">
         <div className="mb-1 font-semibold text-ink">{title}</div>
         {lines.map(([name, value, color]) => (
            <div key={name} className="flex items-center gap-2">
               <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color }} />
               {name}
               <b className="ml-auto pl-4 font-semibold text-ink tabular-nums">{value}</b>
            </div>
         ))}
      </div>
   );
}

/** A YYYY-MM-DD day plus some days. */
function addDays(day: string, days: number): string {
   return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);
}

/** "Sep 22": a week's label is its Monday. */
function weekWords(week: string): string {
   return dayWords(week);
}

/**
 * The backlog, one point per day: the PRs still open at the end of each day.
 * One line answers "is it growing?" without anyone having to subtract.
 */
export function OpenPrsChart({
   days,
   picked,
   height = 180,
}: {
   days: DayPoint[];
   /** the range the page's numbers cover; the days before it are veiled */
   picked?: DayRange;
   height?: number;
}) {
   const tip = ({ active, payload, label }: TooltipContentProps) => {
      const d = payload?.[0]?.payload as DayPoint | undefined;
      if (!active || !d) return null;
      return (
         <TipCard
            title={dayWords(String(label))}
            lines={[['Open at the end of the day', d.backlog, 'var(--brand)']]}
         />
      );
   };
   return (
      <div role="img" aria-label="Open PRs at the end of each day">
         <Unit>Open PRs</Unit>
         <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={days} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
               {grid}
               <XAxis dataKey="date" tickFormatter={dayWords} minTickGap={24} {...xAxisProps} />
               <YAxis {...yAxisProps} />
               <Tooltip content={tip} cursor={{ stroke: 'var(--ring)', strokeDasharray: '3 3' }} />
               <Area
                  type="monotone"
                  dataKey="backlog"
                  stroke="var(--brand)"
                  strokeWidth={2}
                  fill="var(--brand)"
                  fillOpacity={0.1}
                  isAnimationActive={false}
               />
               {veilBefore(days, picked)}
            </AreaChart>
         </ResponsiveContainer>
      </div>
   );
}

/**
 * What arrived and what left, week by week: PRs opened beside PRs merged.
 * Merging fewer than arrive is what makes the backlog grow.
 */
export function FlowWeeksChart({
   weeks,
   picked,
   height = 160,
}: {
   weeks: WeekPoint[];
   picked?: DayRange;
   height?: number;
}) {
   const data = weeks.map(w => ({
      week: w.week,
      opened: w.opened.developers + w.opened.non_developers,
      merged: w.merged.developers + w.merged.non_developers,
      // a week that ends before the picked range is faded, not hidden
      before: !!picked && addDays(w.week, 6) < picked.start,
   }));
   const tip = ({ active, payload, label }: TooltipContentProps) => {
      const row = payload?.[0]?.payload as typeof data[number] | undefined;
      if (!active || !row) return null;
      return (
         <TipCard
            title={`Week of ${weekWords(String(label))}`}
            lines={[
               ['Opened', row.opened, 'var(--ink-3)'],
               ['Merged', row.merged, 'var(--ok)'],
            ]}
         />
      );
   };
   return (
      <div>
         <div role="img" aria-label="PRs opened and PRs merged, each week">
            <Unit>PRs each week</Unit>
            <ResponsiveContainer width="100%" height={height}>
               <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barGap={2}>
                  {grid}
                  <XAxis dataKey="week" tickFormatter={weekWords} minTickGap={16} {...xAxisProps} />
                  <YAxis {...yAxisProps} />
                  <Tooltip content={tip} cursor={{ fill: 'var(--muted)' }} />
                  <Bar
                     dataKey="opened"
                     fill="var(--ink-3)"
                     radius={[4, 4, 0, 0]}
                     isAnimationActive={false}
                  >
                     {data.map(d => (
                        <Cell key={d.week} fillOpacity={d.before ? 0.2 : 0.55} />
                     ))}
                  </Bar>
                  <Bar
                     dataKey="merged"
                     fill="var(--ok)"
                     radius={[4, 4, 0, 0]}
                     isAnimationActive={false}
                  >
                     {data.map(d => (
                        <Cell key={d.week} fillOpacity={d.before ? 0.3 : 1} />
                     ))}
                  </Bar>
               </BarChart>
            </ResponsiveContainer>
         </div>
         <Key
            series={[
               ['Opened', 'var(--ink-3)', 0.55],
               ['Merged', 'var(--ok)', 1],
            ]}
         />
      </div>
   );
}

/**
 * Developer-days each week, writing stacked under reviewing, for Look back:
 * the shape of the whole range, on the same weeks as the rows below it.
 */
export function DaysWeeksChart({
   weeks,
   writing,
   reviewing,
   height = 150,
}: {
   /** each week's Monday */
   weeks: string[];
   writing: number[];
   reviewing: number[];
   height?: number;
}) {
   const round = (d: number) => Math.round(d * 10) / 10;
   const data = weeks.map((week, i) => ({
      week,
      writing: round(writing[i]),
      reviewing: round(reviewing[i]),
   }));
   const tip = ({ active, payload, label }: TooltipContentProps) => {
      const row = payload?.[0]?.payload as typeof data[number] | undefined;
      if (!active || !row) return null;
      return (
         <TipCard
            title={`Week of ${weekWords(String(label))}`}
            lines={[
               ['Writing', row.writing, 'var(--brand)'],
               ['Reviewing', row.reviewing, 'color-mix(in oklab, var(--brand) 40%, transparent)'],
            ]}
         />
      );
   };
   return (
      <div>
         <div role="img" aria-label="Developer-days each week, writing and reviewing">
            <Unit>Developer-days each week</Unit>
            <ResponsiveContainer width="100%" height={height}>
               <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  {grid}
                  <XAxis dataKey="week" tickFormatter={weekWords} minTickGap={16} {...xAxisProps} />
                  <YAxis {...yAxisProps} />
                  <Tooltip content={tip} cursor={{ fill: 'var(--muted)' }} />
                  <Bar
                     dataKey="writing"
                     stackId="d"
                     fill="var(--brand)"
                     stroke="var(--surface)"
                     strokeWidth={2}
                     isAnimationActive={false}
                  />
                  <Bar
                     dataKey="reviewing"
                     stackId="d"
                     fill="var(--brand)"
                     fillOpacity={0.4}
                     stroke="var(--surface)"
                     strokeWidth={2}
                     radius={[4, 4, 0, 0]}
                     isAnimationActive={false}
                  />
               </BarChart>
            </ResponsiveContainer>
         </div>
         <Key
            series={[
               ['Writing, on their own PRs', 'var(--brand)', 1],
               ['Reviewing, on others’', 'var(--brand)', 0.4],
            ]}
         />
      </div>
   );
}

/** The two groups every people chart splits by, and their one color each:
 * blue for developers' work, gray for everyone else's. */
export const GROUP_COLORS = { developers: 'var(--brand)', non_developers: 'var(--ink-3)' };

/**
 * Two stacked series per week, e.g. PRs opened by developers and by
 * non-developers, or reviews given on each group's PRs.
 */
export function SplitWeeksChart({
   weeks,
   pick,
   labels,
   unit,
   ariaLabel,
   height = 160,
}: {
   weeks: WeekPoint[];
   /** the week's two numbers: developers' first, non-developers' second */
   pick: (w: WeekPoint) => [number, number];
   labels: [string, string];
   /** what the y-axis counts, e.g. "PRs opened each week" */
   unit: string;
   ariaLabel: string;
   height?: number;
}) {
   const data = weeks.map(w => {
      const [a, b] = pick(w);
      return { week: w.week, a, b };
   });
   const tip = ({ active, payload, label }: TooltipContentProps) => {
      const row = payload?.[0]?.payload as { a: number; b: number } | undefined;
      if (!active || !row) return null;
      return (
         <TipCard
            title={`Week of ${weekWords(String(label))}`}
            lines={[
               [labels[0], row.a, GROUP_COLORS.developers],
               [labels[1], row.b, GROUP_COLORS.non_developers],
            ]}
         />
      );
   };
   return (
      <div>
         <div role="img" aria-label={ariaLabel}>
            <Unit>{unit}</Unit>
            <ResponsiveContainer width="100%" height={height}>
               <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  {grid}
                  <XAxis dataKey="week" tickFormatter={weekWords} minTickGap={16} {...xAxisProps} />
                  <YAxis {...yAxisProps} />
                  <Tooltip content={tip} cursor={{ fill: 'var(--muted)' }} />
                  <Bar
                     dataKey="a"
                     stackId="s"
                     fill={GROUP_COLORS.developers}
                     fillOpacity={0.75}
                     stroke="var(--surface)"
                     strokeWidth={2}
                     isAnimationActive={false}
                  />
                  <Bar
                     dataKey="b"
                     stackId="s"
                     fill={GROUP_COLORS.non_developers}
                     fillOpacity={0.55}
                     stroke="var(--surface)"
                     strokeWidth={2}
                     radius={[4, 4, 0, 0]}
                     isAnimationActive={false}
                  />
               </BarChart>
            </ResponsiveContainer>
         </div>
         <Key
            series={[
               [labels[0], GROUP_COLORS.developers, 0.75],
               [labels[1], GROUP_COLORS.non_developers, 0.55],
            ]}
         />
      </div>
   );
}
