import type { ReactNode } from 'react';
import {
   Area,
   AreaChart,
   Bar,
   BarChart,
   CartesianGrid,
   ReferenceArea,
   ResponsiveContainer,
   Tooltip,
   XAxis,
   YAxis,
   type TooltipContentProps,
} from 'recharts';
import type { DayPoint, WeekPoint, WindowCounts } from '../../../../shared/model/projects';
import { dayWords } from '../../model/projectData';

/**
 * The Projects tab's charts, on Recharts. It draws SVG, so every color here
 * is a CSS variable from styles.css and dark mode costs no redraw, the same
 * rule the hand-drawn Stats charts follow. This module is loaded lazily with
 * the views that chart, so the review board never downloads it.
 *
 * Color vocabulary, shared with the Stats tab: ink for opened, green for
 * merged or finished, brand for what is still open, a lighter ink for closed
 * without merging. No chart animates: on this board motion means something
 * changed.
 */

const axisTick = { fill: 'var(--ink-3)', fontSize: 10 };
const grid = <CartesianGrid stroke="var(--secondary)" vertical={false} />;

type DayRange = { start: string; end: string };

/**
 * A veil over the days before the picked range: a chart draws at least 90
 * days so a short range still shows its trend, and the range the numbers
 * cover stays the bright part. On bars the veil stops at the day before the
 * range (each day is a band); on areas it runs to the range's first point.
 */
function veilBefore(days: { date: string }[], picked: DayRange | undefined, bands: boolean) {
   const firstIn = picked ? days.findIndex(d => d.date >= picked.start) : -1;
   if (firstIn <= 0) return null;
   return (
      <ReferenceArea
         x1={days[0].date}
         x2={days[bands ? firstIn - 1 : firstIn].date}
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

/**
 * The backlog chart Sterling asked for: each day, the PRs merged or closed so
 * far, with the PRs still open stacked on top. The top edge is everything
 * that arrived (the starting backlog plus what opened since), so the height
 * of the blue band is the backlog on that day.
 */
export function BacklogFlowChart({
   days,
   picked,
   height = 200,
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
            lines={[
               ['Open at the end of the day', d.backlog, 'var(--brand)'],
               ['Merged or closed so far', d.departed, 'var(--ok)'],
               ['Arrived so far, with the backlog', d.arrived, 'var(--ink-3)'],
            ]}
         />
      );
   };
   return (
      <div
         role="img"
         aria-label="PRs merged or closed so far, with the PRs still open stacked on top, one point per day"
      >
         <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={days} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
               {grid}
               <XAxis
                  dataKey="date"
                  tickFormatter={dayWords}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  minTickGap={24}
               />
               <YAxis
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  allowDecimals={false}
               />
               <Tooltip content={tip} cursor={{ stroke: 'var(--ring)', strokeDasharray: '3 3' }} />
               <Area
                  type="monotone"
                  dataKey="departed"
                  stackId="flow"
                  stroke="var(--ok)"
                  fill="var(--ok)"
                  fillOpacity={0.18}
                  isAnimationActive={false}
               />
               <Area
                  type="monotone"
                  dataKey="backlog"
                  stackId="flow"
                  stroke="var(--brand)"
                  fill="var(--brand)"
                  fillOpacity={0.22}
                  isAnimationActive={false}
               />
               {veilBefore(days, picked, false)}
            </AreaChart>
         </ResponsiveContainer>
      </div>
   );
}

/** Axis labels have a fixed width; a longer name ends in an ellipsis and
 * the tooltip gives it whole. */
function clip(name: string, max: number): string {
   return name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name;
}

export interface BarRowData {
   key: string;
   name: string;
   w: WindowCounts;
}

/**
 * One horizontal bar per project: what merged, what closed without merging,
 * and what was still open at the end, stacked so the bar's length is
 * everything the project touched. Click a bar for the project's page.
 */
export function ProjectBars({
   rows,
   onPick,
}: {
   rows: BarRowData[];
   onPick?: (key: string) => void;
}) {
   const data = rows.map(r => ({
      key: r.key,
      name: r.name,
      merged: r.w.merged,
      closed: r.w.closed,
      open: r.w.backlog_end,
   }));
   type Row = typeof data[number];
   const tip = ({ active, payload }: TooltipContentProps) => {
      const d = payload?.[0]?.payload as Row | undefined;
      if (!active || !d) return null;
      return (
         <TipCard
            title={d.name}
            lines={[
               ['Merged', d.merged, 'var(--ok)'],
               ['Closed without merging', d.closed, 'var(--ink-3)'],
               ['Still open at the end', d.open, 'var(--brand)'],
            ]}
         />
      );
   };
   const pick = onPick
      ? (entry: { payload?: Row }) => entry.payload && onPick(entry.payload.key)
      : undefined;
   return (
      <div role="img" aria-label="Per project: PRs merged, closed without merging, and still open">
         <ResponsiveContainer width="100%" height={Math.max(80, data.length * 26 + 24)}>
            <BarChart
               data={data}
               layout="vertical"
               margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
            >
               <CartesianGrid stroke="var(--secondary)" horizontal={false} />
               <XAxis
                  type="number"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
               />
               <YAxis
                  type="category"
                  dataKey="name"
                  width={176}
                  tickFormatter={(name: string) => clip(name, 28)}
                  tick={{ ...axisTick, fontSize: 11, fill: 'var(--ink-2)' }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
               />
               <Tooltip content={tip} cursor={{ fill: 'var(--muted)' }} />
               <Bar
                  dataKey="merged"
                  stackId="p"
                  fill="var(--ok)"
                  isAnimationActive={false}
                  onClick={pick}
                  cursor={onPick ? 'pointer' : undefined}
               />
               <Bar
                  dataKey="closed"
                  stackId="p"
                  fill="var(--ink-3)"
                  fillOpacity={0.45}
                  isAnimationActive={false}
                  onClick={pick}
                  cursor={onPick ? 'pointer' : undefined}
               />
               <Bar
                  dataKey="open"
                  stackId="p"
                  fill="var(--brand)"
                  fillOpacity={0.7}
                  isAnimationActive={false}
                  onClick={pick}
                  cursor={onPick ? 'pointer' : undefined}
               />
            </BarChart>
         </ResponsiveContainer>
      </div>
   );
}

/** One pair of bars per person: PRs opened and PRs merged in the range. */
export function PeopleBars({ rows }: { rows: BarRowData[] }) {
   const data = rows.map(r => ({ name: r.name, opened: r.w.opened, merged: r.w.merged }));
   type Row = typeof data[number];
   const tip = ({ active, payload }: TooltipContentProps) => {
      const d = payload?.[0]?.payload as Row | undefined;
      if (!active || !d) return null;
      return (
         <TipCard
            title={d.name}
            lines={[
               ['Opened', d.opened, 'var(--ink-3)'],
               ['Merged', d.merged, 'var(--ok)'],
            ]}
         />
      );
   };
   return (
      <div role="img" aria-label="Per person: PRs opened and PRs merged">
         <ResponsiveContainer width="100%" height={Math.max(80, data.length * 30 + 24)}>
            <BarChart
               data={data}
               layout="vertical"
               margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
               barGap={1}
            >
               <CartesianGrid stroke="var(--secondary)" horizontal={false} />
               <XAxis
                  type="number"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
               />
               <YAxis
                  type="category"
                  dataKey="name"
                  width={130}
                  tickFormatter={(name: string) => clip(name, 20)}
                  tick={{ ...axisTick, fontSize: 11, fill: 'var(--ink-2)' }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
               />
               <Tooltip content={tip} cursor={{ fill: 'var(--muted)' }} />
               <Bar
                  dataKey="opened"
                  fill="var(--ink-3)"
                  fillOpacity={0.55}
                  isAnimationActive={false}
               />
               <Bar dataKey="merged" fill="var(--ok)" isAnimationActive={false} />
            </BarChart>
         </ResponsiveContainer>
      </div>
   );
}

/** "Sep 22": a week's label is its Monday. */
function weekWords(week: string): string {
   return dayWords(week);
}

/** Brand shades for the projects that get their own color, strongest first:
 * one hue for "a project", told apart by depth and the tooltip, rather than a
 * rainbow whose colors would each claim a meaning the board already uses. */
const PROJECT_SHADES = [1, 0.8, 0.64, 0.5, 0.38, 0.28];
const OTHER = '__other';
const NONE = '__none';

/**
 * Where the merged work went, week by week: the projects with the most merges
 * in the range each get a shade of blue, the rest pool into "other projects",
 * and PRs with no project label sit on top in gray. Click a project's segment
 * for its page.
 */
export function AllocationChart({
   weeks,
   nameOf,
   onPick,
   height = 220,
}: {
   weeks: WeekPoint[];
   nameOf: (slug: string) => string;
   onPick?: (slug: string) => void;
   height?: number;
}) {
   const totals = new Map<string, number>();
   for (const w of weeks)
      for (const [slug, n] of Object.entries(w.merged_by_project))
         if (slug) totals.set(slug, (totals.get(slug) ?? 0) + n);
   const leaders = [...totals]
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .slice(0, PROJECT_SHADES.length)
      .map(([slug]) => slug);
   const data = weeks.map(w => {
      const row: Record<string, number | string> = { week: w.week, [OTHER]: 0, [NONE]: 0 };
      for (const slug of leaders) row[slug] = 0;
      for (const [slug, n] of Object.entries(w.merged_by_project)) {
         const key = slug === '' ? NONE : leaders.includes(slug) ? slug : OTHER;
         row[key] = (row[key] as number) + n;
      }
      return row;
   });
   const series: [string, string, string, number][] = [
      ...leaders.map((slug, i): [string, string, string, number] => [
         slug,
         nameOf(slug),
         'var(--brand)',
         PROJECT_SHADES[i],
      ]),
      [OTHER, 'Other projects', 'var(--brand)', 0.16],
      [NONE, 'Not in a project', 'var(--ink-3)', 0.35],
   ];
   const tip = ({ active, payload, label }: TooltipContentProps) => {
      const row = payload?.[0]?.payload as Record<string, number> | undefined;
      if (!active || !row) return null;
      const lines = series
         .filter(([key]) => row[key])
         .map(([key, name, color]): [string, number, string] => [name, row[key], color]);
      return <TipCard title={`Week of ${weekWords(String(label))}`} lines={lines} />;
   };
   return (
      <div>
         <div role="img" aria-label="Merged PRs each week, split by project">
            <ResponsiveContainer width="100%" height={height}>
               <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  {grid}
                  <XAxis
                     dataKey="week"
                     tickFormatter={weekWords}
                     tick={axisTick}
                     tickLine={false}
                     axisLine={{ stroke: 'var(--border)' }}
                     minTickGap={16}
                  />
                  <YAxis
                     tick={axisTick}
                     tickLine={false}
                     axisLine={false}
                     width={40}
                     allowDecimals={false}
                  />
                  <Tooltip content={tip} cursor={{ fill: 'var(--muted)' }} />
                  {series.map(([key, , color, opacity]) => (
                     <Bar
                        key={key}
                        dataKey={key}
                        stackId="w"
                        fill={color}
                        fillOpacity={opacity}
                        stroke="var(--surface)"
                        strokeWidth={1}
                        isAnimationActive={false}
                        cursor={onPick && key !== OTHER && key !== NONE ? 'pointer' : undefined}
                        onClick={
                           onPick && key !== OTHER && key !== NONE ? () => onPick(key) : undefined
                        }
                     />
                  ))}
               </BarChart>
            </ResponsiveContainer>
         </div>
         <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-[11px] text-ink-2">
            {series
               .filter(([key]) => key === OTHER || key === NONE || totals.has(key))
               .map(([key, name, color, opacity]) => (
                  <li key={key} className="inline-flex items-center gap-1.5">
                     <span
                        aria-hidden
                        className="h-2.5 w-2.5 rounded-sm"
                        style={{ background: color, opacity }}
                     />
                     {name}
                  </li>
               ))}
         </ul>
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
   ariaLabel,
   height = 160,
}: {
   weeks: WeekPoint[];
   /** the week's two numbers: developers' first, non-developers' second */
   pick: (w: WeekPoint) => [number, number];
   labels: [string, string];
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
            <ResponsiveContainer width="100%" height={height}>
               <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  {grid}
                  <XAxis
                     dataKey="week"
                     tickFormatter={weekWords}
                     tick={axisTick}
                     tickLine={false}
                     axisLine={{ stroke: 'var(--border)' }}
                     minTickGap={16}
                  />
                  <YAxis
                     tick={axisTick}
                     tickLine={false}
                     axisLine={false}
                     width={40}
                     allowDecimals={false}
                  />
                  <Tooltip content={tip} cursor={{ fill: 'var(--muted)' }} />
                  <Bar
                     dataKey="a"
                     stackId="s"
                     fill={GROUP_COLORS.developers}
                     fillOpacity={0.75}
                     isAnimationActive={false}
                  />
                  <Bar
                     dataKey="b"
                     stackId="s"
                     fill={GROUP_COLORS.non_developers}
                     fillOpacity={0.55}
                     isAnimationActive={false}
                  />
               </BarChart>
            </ResponsiveContainer>
         </div>
         <ul className="m-0 mt-2 flex list-none gap-x-3 p-0 text-[11px] text-ink-2">
            {labels.map((name, i) => (
               <li key={name} className="inline-flex items-center gap-1.5">
                  <span
                     aria-hidden
                     className="h-2.5 w-2.5 rounded-sm"
                     style={{
                        background: i ? GROUP_COLORS.non_developers : GROUP_COLORS.developers,
                        opacity: i ? 0.55 : 0.75,
                     }}
                  />
                  {name}
               </li>
            ))}
         </ul>
      </div>
   );
}
