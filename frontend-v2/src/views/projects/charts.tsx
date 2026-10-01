import { useState, type KeyboardEvent, type ReactNode } from 'react';
import {
   Area,
   AreaChart,
   Bar,
   BarChart,
   CartesianGrid,
   Cell,
   LabelList,
   ReferenceArea,
   ResponsiveContainer,
   Text,
   Tooltip,
   XAxis,
   YAxis,
   type TooltipContentProps,
} from 'recharts';
import { n } from '../../../../shared/format';
import type { DayPoint, WeekPoint } from '../../../../shared/model/projects';
import { dayWords } from '../../model/projectData';
import { chartWeek, type ChartWeek } from '../../model/retro';
import { yTicks } from './LoadChart';

/**
 * The Projects tab's charts, on Recharts. It draws SVG, so every color here
 * is a CSS variable from styles.css and dark mode costs no redraw, the same
 * rule the hand-drawn Stats charts follow. This module is loaded lazily with
 * the views that chart, so the review board never downloads it.
 *
 * Every chart says what it counts: the unit sits over the y-axis, the
 * x-axis names the days or weeks, and hovering a mark gives its exact
 * numbers; a screen reader gets the same numbers as a table. Color
 * vocabulary, shared with the Stats tab: ink for opened, green for merged,
 * brand for what is still open; anything else (Look back's days, who
 * opened what) is ink, so brand never means two things on one page. A week
 * before the picked range is drawn paler, and a week the chart's days cut
 * off says how many of its days count. No chart animates: on this board
 * motion means something changed.
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

/** Look back's two kinds of day: writing in the ink a count wears, reviewing
 * in a paler ink that still clears 3:1 against the card in both themes. */
const WRITING = 'var(--ink-2)';
const REVIEWING = 'color-mix(in oklab, var(--ink-2) 62%, var(--surface))';
/** how much of its color a week before the picked range keeps */
const BEFORE = 0.35;

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

/** A chart's numbers as a table only a screen reader reads: the picture
 * can't say them, and a hover can't be heard. */
function SrTable({
   caption,
   head,
   rows,
}: {
   caption: string;
   head: string[];
   rows: (string | number)[][];
}) {
   // the wrapper hides it: a table won't shrink to sr-only's 1px itself, and
   // its full width would push the page sideways on a phone
   return (
      <div className="sr-only">
         <table>
            <caption>{caption}</caption>
            <thead>
               <tr>
                  {head.map(h => (
                     <th key={h} scope="col">
                        {h}
                     </th>
                  ))}
               </tr>
            </thead>
            <tbody>
               {rows.map(([first, ...rest]) => (
                  <tr key={String(first)}>
                     <th scope="row">{first}</th>
                     {rest.map((value, i) => (
                        <td key={head[i + 1]}>{value}</td>
                     ))}
                  </tr>
               ))}
            </tbody>
         </table>
      </div>
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

/** "Week of Sep 28", with how many of its days count when it's cut off. */
function weekTitle(w: ChartWeek): string {
   return `Week of ${dayWords(w.week)}${w.days < 7 ? `, ${w.days} of 7 days` : ''}`;
}

/** What Recharts hands a custom tick; it sends more, and these are all we read. */
interface TickProps {
   x?: number | string;
   y?: number | string;
   width?: number | string;
   payload?: { value?: unknown };
}

/**
 * The x-axis tick for a week: its Monday and, under a week of the range the
 * chart's days cut off (this one so far, or the first of a long range), how
 * many of its days count, so a short bar at either end doesn't read as a
 * slow week. Such a week sits at an end, so its words anchor to that edge of
 * the plot instead of running off it.
 */
function weekTick(weeks: readonly ChartWeek[]) {
   return function WeekTick({ x = 0, y = 0, width = 0, payload }: TickProps) {
      const i = weeks.findIndex(w => w.week === payload?.value);
      if (i < 0) return <g />;
      const w = weeks[i];
      // a paler week before the range is context, not a slow week to explain
      const cut = w.days < 7 && !w.before;
      const half = Number(width) / weeks.length / 2;
      const anchor = !cut
         ? 'middle'
         : i === 0
         ? 'start'
         : i === weeks.length - 1
         ? 'end'
         : 'middle';
      const at = Number(x) + (anchor === 'start' ? -half : anchor === 'end' ? half : 0);
      return (
         <text x={at} y={Number(y)} textAnchor={anchor} fill="var(--ink-3)" fontSize={10}>
            <tspan x={at} dy="0.71em">
               {dayWords(w.week)}
            </tspan>
            {cut && (
               <tspan x={at} dy="1.3em">
                  {w.days} of 7 days
               </tspan>
            )}
         </text>
      );
   };
}

/** The x-axis every weekly chart shares: the first and last weeks always
 * labeled, since those are the ones a cut can shorten. */
function weekAxis(weeks: readonly ChartWeek[]) {
   return (
      <XAxis
         dataKey="week"
         {...xAxisProps}
         tickFormatter={dayWords}
         tick={weekTick(weeks)}
         interval="preserveStartEnd"
         minTickGap={16}
         height={32}
      />
   );
}

/** A week's row in a chart's screen-reader table. */
function srWeek(w: ChartWeek): string {
   return `${weekTitle(w)}${w.before ? ', before the range' : ''}`;
}

/**
 * The backlog, one point per day: the PRs still open at the end of each day.
 * One line answers "is it growing?" without anyone having to subtract. It's
 * drawn straight from day to day: a smoothed curve turned a one-day blip
 * into a hump that spread over the days around it.
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
   const first = days[0];
   const last = days[days.length - 1];
   const most = days.reduce<DayPoint | undefined>(
      (m, d) => (!m || d.backlog > m.backlog ? d : m),
      undefined
   );
   return (
      <div>
         <Unit>Open PRs</Unit>
         <ResponsiveContainer width="100%" height={height}>
            <AreaChart
               data={days}
               margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
               role="img"
               title="Open PRs at the end of each day"
            >
               {grid}
               <XAxis dataKey="date" tickFormatter={dayWords} minTickGap={24} {...xAxisProps} />
               <YAxis {...yAxisProps} />
               <Tooltip content={tip} cursor={{ stroke: 'var(--ring)', strokeDasharray: '3 3' }} />
               <Area
                  type="linear"
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
         {first && last && most && (
            <p className="sr-only">
               Open PRs at the end of each day: {first.backlog} on {dayWords(first.date)},{' '}
               {last.backlog} on {dayWords(last.date)}, and at most {most.backlog}, on{' '}
               {dayWords(most.date)}.
            </p>
         )}
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
   shown,
   height = 160,
}: {
   weeks: WeekPoint[];
   /** the range the page's numbers cover; the weeks before it are paler */
   picked?: DayRange;
   /** the days the weeks were counted over, so a week they cut off says so */
   shown?: DayRange;
   height?: number;
}) {
   const facts = weeks.map(w => chartWeek(w.week, shown, picked));
   const data = weeks.map((w, i) => ({
      ...facts[i],
      opened: w.opened.developers + w.opened.non_developers,
      merged: w.merged.developers + w.merged.non_developers,
   }));
   const tip = ({ active, payload }: TooltipContentProps) => {
      const row = payload?.[0]?.payload as typeof data[number] | undefined;
      if (!active || !row) return null;
      return (
         <TipCard
            title={weekTitle(row)}
            lines={[
               ['Opened', row.opened, 'var(--ink-3)'],
               ['Merged', row.merged, 'var(--ok)'],
            ]}
         />
      );
   };
   return (
      <div>
         <Unit>PRs each week</Unit>
         <ResponsiveContainer width="100%" height={height}>
            <BarChart
               data={data}
               margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
               barGap={2}
               role="img"
               title="PRs opened and PRs merged, each week"
            >
               {grid}
               {weekAxis(facts)}
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
         <Key
            series={[
               ['Opened', 'var(--ink-3)', 0.55],
               ['Merged', 'var(--ok)', 1],
            ]}
         />
         <SrTable
            caption="PRs opened and merged each week"
            head={['Week', 'Opened', 'Merged']}
            rows={data.map(d => [srWeek(d), d.opened, d.merged])}
         />
      </div>
   );
}

/**
 * Developer-days each week, writing stacked under reviewing, for Look back:
 * the shape of the whole range, on the same weeks as the rows below it. A
 * kind the page doesn't count is left out, bars and key both.
 */
export function DaysWeeksChart({
   weeks,
   writing,
   reviewing,
   height = 150,
}: {
   /** every week of the chart's days, oldest first */
   weeks: ChartWeek[];
   /** each week's days on people's own PRs; absent when they don't count */
   writing?: number[];
   /** each week's days on other people's PRs; absent when they don't count */
   reviewing?: number[];
   height?: number;
}) {
   const round = (d: number) => Math.round(d * 10) / 10;
   const data = weeks.map((w, i) => ({
      ...w,
      writing: round(writing?.[i] ?? 0),
      reviewing: round(reviewing?.[i] ?? 0),
   }));
   // each kind counted: its key, its name, its name in the key, its color
   const series = [
      writing && (['writing', 'Writing', 'Writing, on their own PRs', WRITING] as const),
      reviewing && (['reviewing', 'Reviewing', 'Reviewing, on others’', REVIEWING] as const),
   ].filter(s => !!s);
   const tip = ({ active, payload }: TooltipContentProps) => {
      const row = payload?.[0]?.payload as typeof data[number] | undefined;
      if (!active || !row) return null;
      return (
         <TipCard
            title={weekTitle(row)}
            lines={series.map(([key, name, , color]) => [name, row[key], color])}
         />
      );
   };
   return (
      <div>
         <Unit>Developer-days each week</Unit>
         <ResponsiveContainer width="100%" height={height}>
            <BarChart
               data={data}
               margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
               role="img"
               title="Developer-days each week"
            >
               {grid}
               {weekAxis(weeks)}
               <YAxis {...yAxisProps} />
               <Tooltip content={tip} cursor={{ fill: 'var(--muted)' }} />
               {series.map(([key, , , color], i) => (
                  <Bar
                     key={key}
                     dataKey={key}
                     stackId="d"
                     fill={color}
                     stroke="var(--surface)"
                     strokeWidth={2}
                     // the top of the stack is rounded, whichever kind it is
                     radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
                     isAnimationActive={false}
                  >
                     {data.map(d => (
                        <Cell key={d.week} fillOpacity={d.before ? BEFORE : 1} />
                     ))}
                  </Bar>
               ))}
            </BarChart>
         </ResponsiveContainer>
         {series.length > 1 && (
            <Key series={series.map(([, , keyName, color]) => [keyName, color, 1])} />
         )}
         <SrTable
            caption="Developer-days each week"
            head={['Week', ...series.map(([, name]) => name)]}
            rows={data.map(d => [srWeek(d), ...series.map(([key]) => d[key])])}
         />
      </div>
   );
}

/**
 * Two groups' weeks, such as PRs opened by developers and by everyone else:
 * one strip of bars per group, one over the other on the same scale and in
 * the same ink, each named over its own bars, so there's no key to learn.
 */
export function SplitWeeksChart({
   weeks,
   pick,
   labels,
   unit,
   ariaLabel,
   picked,
   shown,
   height = 160,
}: {
   weeks: WeekPoint[];
   /** the week's two numbers: developers' first, non-developers' second */
   pick: (w: WeekPoint) => [number, number];
   labels: [string, string];
   /** what the y-axis counts, e.g. "PRs opened each week" */
   unit: string;
   ariaLabel: string;
   /** the range the page's numbers cover; the weeks before it are paler */
   picked?: DayRange;
   /** the days the weeks were counted over, so a week they cut off says so */
   shown?: DayRange;
   height?: number;
}) {
   const facts = weeks.map(w => chartWeek(w.week, shown, picked));
   const data = weeks.map((w, i) => {
      const [a, b] = pick(w);
      return { ...facts[i], a, b };
   });
   // one scale for both strips, gridlines at round counts
   const top = Math.max(1, ...data.flatMap(d => [d.a, d.b]));
   const ticks = [0, ...yTicks(top)];
   const strip = Math.max(40, Math.round((height - 32) / 2));
   const tip = ({ active, payload }: TooltipContentProps) => {
      const row = payload?.[0]?.payload as typeof data[number] | undefined;
      if (!active || !row) return null;
      return (
         <TipCard
            title={weekTitle(row)}
            lines={[
               [labels[0], row.a, 'var(--ink-3)'],
               [labels[1], row.b, 'var(--ink-3)'],
            ]}
         />
      );
   };
   const bars = (key: 'a' | 'b', name: string, axis: boolean) => (
      <div>
         {/* the name sits over its own bars, where the plot starts */}
         <div className="pl-10 text-[11px] text-ink-2">{name}</div>
         <ResponsiveContainer width="100%" height={axis ? strip + 32 : strip}>
            <BarChart
               data={data}
               margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
               role="img"
               title={`${name}: ${unit}`}
            >
               {grid}
               {axis ? (
                  weekAxis(facts)
               ) : (
                  // the upper strip's baseline, its weeks named under the lower one
                  <XAxis
                     dataKey="week"
                     tick={false}
                     tickLine={false}
                     axisLine={{ stroke: 'var(--border)' }}
                     height={1}
                  />
               )}
               <YAxis {...yAxisProps} domain={[0, top]} ticks={ticks} />
               <Tooltip content={tip} cursor={{ fill: 'var(--muted)' }} />
               <Bar
                  dataKey={key}
                  fill="var(--ink-3)"
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
               >
                  {data.map(d => (
                     <Cell key={d.week} fillOpacity={d.before ? BEFORE : 1} />
                  ))}
               </Bar>
            </BarChart>
         </ResponsiveContainer>
      </div>
   );
   return (
      <div>
         <Unit>{unit}</Unit>
         <div className="flex flex-col gap-1">
            {bars('a', labels[0], false)}
            {bars('b', labels[1], true)}
         </div>
         <SrTable
            caption={ariaLabel}
            head={['Week', ...labels]}
            rows={data.map(d => [srWeek(d), d.a, d.b])}
         />
      </div>
   );
}

/** One bar of a bucket chart: its axis label, and the projects in it with
 * the days each one is counted by. */
export interface Bucket {
   tick: string;
   items: { name: string; days: number }[];
   /** amber: everything in it is owed a look */
   warn?: boolean;
}

/** A bucket's tick, wrapped to its bar's width so two neighbors never run
 * into each other on a phone ("Under 2 wk2-4 wk"). */
function bucketTick(count: number) {
   return function BucketTick({ x = 0, y = 0, width = 0, payload }: TickProps) {
      return (
         <Text
            x={Number(x)}
            y={Number(y)}
            width={Math.max(24, Number(width) / count - 4)}
            textAnchor="middle"
            verticalAnchor="start"
            fill="var(--ink-3)"
            fontSize={10}
            lineHeight="1.2em"
         >
            {String(payload?.value ?? '')}
         </Text>
      );
   };
}

/**
 * How many projects fall in each bucket, such as how long they've been
 * open: one series, the count printed on each bar, and every project in a
 * bar named on hover. A click anywhere in a bar's column picks it; the
 * picked bar stays bright and the rest fade. For the keyboard each column
 * is a button too, one Tab stop for the chart, as on the roadmap's load
 * chart: the arrow keys move between bars and show each one's projects,
 * and Enter or Space picks it.
 */
export function BucketChart({
   buckets,
   unit,
   ariaLabel,
   picked,
   onPick,
   height = 150,
}: {
   buckets: Bucket[];
   /** what the y-axis counts */
   unit: string;
   ariaLabel: string;
   /** the picked bar's index; null for none */
   picked: number | null;
   onPick: (index: number) => void;
   height?: number;
}) {
   // the bar the keyboard is on, whose projects the tooltip shows
   const [focused, setFocused] = useState<number | null>(null);
   const data = buckets.map((b, i) => ({ tick: b.tick, count: b.items.length, i }));
   const tip = ({ active, payload }: TooltipContentProps) => {
      const row = payload?.[0]?.payload as typeof data[number] | undefined;
      if (!active || !row) return null;
      const b = buckets[row.i];
      return (
         <div className="max-w-[300px] rounded-lg border border-line bg-surface px-2.5 py-2 text-xs text-ink-2 shadow-sm">
            <div className="mb-1 font-semibold text-ink">
               {b.tick}: {n(b.items.length, 'project')}
            </div>
            {[...b.items]
               .sort((x, y) => y.days - x.days || x.name.localeCompare(y.name))
               .map(item => (
                  <div key={item.name} className="flex items-baseline gap-3">
                     <span className="min-w-0 truncate">{item.name}</span>
                     <span className="ml-auto flex-none text-ink-3 tabular-nums">
                        {n(item.days, 'day')}
                     </span>
                  </div>
               ))}
            {b.items.length > 0 && (
               <div className="mt-1 text-[11px] text-ink-3">
                  {row.i === picked
                     ? 'Click to list every project again'
                     : 'Click to list only these'}
               </div>
            )}
         </div>
      );
   };
   // the Tab stop: the bar the keyboard is on, else the picked one, else the first
   const stop = focused ?? picked ?? 0;
   const step = (e: KeyboardEvent<HTMLButtonElement>, from: number) => {
      const last = buckets.length - 1;
      const to =
         e.key === 'ArrowRight'
            ? Math.min(last, from + 1)
            : e.key === 'ArrowLeft'
            ? Math.max(0, from - 1)
            : e.key === 'Home'
            ? 0
            : e.key === 'End'
            ? last
            : null;
      if (to == null) return;
      e.preventDefault();
      (e.currentTarget.parentElement?.children[to] as HTMLElement | undefined)?.focus();
   };
   return (
      <div>
         <Unit>{unit}</Unit>
         <div className="relative">
            <ResponsiveContainer width="100%" height={height}>
               <BarChart
                  data={data}
                  margin={{ top: 16, right: 8, bottom: 0, left: 0 }}
                  onClick={state => {
                     const i = Number(state.activeTooltipIndex);
                     if (Number.isInteger(i) && buckets[i]?.items.length) onPick(i);
                  }}
                  style={{ cursor: 'pointer' }}
                  // the buttons below are the chart's keyboard and its words
                  accessibilityLayer={false}
                  aria-hidden
               >
                  {grid}
                  <XAxis
                     dataKey="tick"
                     interval={0}
                     {...xAxisProps}
                     tick={bucketTick(buckets.length)}
                     height={30}
                  />
                  <YAxis {...yAxisProps} />
                  <Tooltip
                     content={tip}
                     cursor={{ fill: 'var(--muted)' }}
                     allowEscapeViewBox={{ x: false, y: true }}
                     wrapperStyle={{ zIndex: 20 }}
                     // a bar the keyboard is on shows its projects, as a hover would
                     active={focused != null ? true : undefined}
                     defaultIndex={focused ?? undefined}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                     {data.map(d => (
                        <Cell
                           key={d.tick}
                           fill={buckets[d.i].warn ? 'var(--warn)' : 'var(--brand)'}
                           fillOpacity={picked == null || picked === d.i ? 1 : 0.3}
                        />
                     ))}
                     <LabelList
                        dataKey="count"
                        position="top"
                        fill="var(--ink-2)"
                        fontSize={11}
                        className="tabular-nums"
                     />
                  </Bar>
               </BarChart>
            </ResponsiveContainer>
            {/* each bar's column as a button over the plot: invisible to the
                pointer, which the chart itself serves, and one Tab stop */}
            <div
               role="group"
               aria-label={ariaLabel}
               className="pointer-events-none absolute inset-y-0 right-2 left-10 flex"
            >
               {buckets.map((b, i) => (
                  <button
                     key={b.tick}
                     type="button"
                     tabIndex={i === stop ? 0 : -1}
                     aria-pressed={picked === i}
                     aria-disabled={!b.items.length}
                     aria-label={`${b.tick}: ${n(b.items.length, 'project')}`}
                     onClick={() => b.items.length && onPick(i)}
                     onKeyDown={e => step(e, i)}
                     onFocus={() => setFocused(i)}
                     onBlur={() => setFocused(null)}
                     className="min-w-0 flex-1 rounded border-0 bg-transparent p-0"
                  />
               ))}
            </div>
         </div>
      </div>
   );
}
