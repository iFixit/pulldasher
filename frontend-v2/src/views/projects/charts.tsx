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
import {
   chartWeek,
   weekBars,
   weekTitle,
   weekWords,
   type ChartWeek,
   type WeekBars,
} from '../../model/retro';
import { yTicks } from './LoadChart';

/**
 * The Projects tab's charts, on Recharts. It draws SVG, so every color here
 * is a CSS variable from styles.css and dark mode costs no redraw, the same
 * rule the hand-drawn Stats charts follow. This module is loaded lazily with
 * the views that chart, so the review board never downloads it.
 *
 * Every chart says what it counts: the unit sits over the y-axis, the
 * x-axis names the days or weeks, and hovering a mark gives its exact
 * numbers; a screen reader gets the same numbers as a table. Every mark is
 * named where it's drawn, never in a key: a strip's name sits over its bars,
 * and two series' words take their bars' colors. Color vocabulary, shared
 * with the Stats tab: ink for opened, green for merged, brand for what is
 * still open; anything else (Look back's days, who opened what) is ink, so
 * brand never means two things on one page. The days before the picked
 * range are drawn paler, the week the range starts in split in two, and a
 * week the chart's days cut off says how many of its days count. No chart
 * animates: on this board motion means something changed.
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

/** a strip's one ink: the strip's name labels it, so it needs no hue */
const STRIP = 'var(--ink-3)';
/** how much of its color a day before the picked range keeps */
const BEFORE = 0.35;

/** What a chart's y-axis counts, said over it where the eye starts. */
function Unit({ children }: { children: ReactNode }) {
   return <div className="mb-1 pl-1 text-xs font-medium text-ink-3">{children}</div>;
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
 * cover stays the bright part. (A bar chart pales its early bars instead,
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

/** A tooltip line: its name, its number, and its dot's color (none for a
 * line that adds the others up). */
type TipLine = [string, number | string, string | null];

/**
 * The one tooltip look: the point's title, then a dot, a name and a number
 * per line, and a quiet note under them. It's a status region, so the arrow
 * keys moving a focused chart from week to week are heard, not only seen.
 */
function TipCard({
   title,
   lines,
   note,
}: {
   title: ReactNode;
   lines: TipLine[];
   note?: string | null;
}) {
   return (
      <div
         role="status"
         className="rounded-lg border border-line bg-surface px-2.5 py-2 text-xs text-ink-2 shadow-sm"
      >
         <div className="mb-1 font-semibold text-ink">{title}</div>
         {lines.map(([name, value, color]) => (
            <div key={name} className="flex items-center gap-2">
               <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ background: color ?? 'transparent' }}
               />
               {name}
               <b className="ml-auto pl-4 font-semibold text-ink tabular-nums">{value}</b>
            </div>
         ))}
         {note && <div className="mt-1 text-ink-3">{note}</div>}
      </div>
   );
}

/** What Recharts hands a custom tick; it sends more, and these are all we read. */
interface TickProps {
   x?: number | string;
   y?: number | string;
   width?: number | string;
   payload?: { value?: unknown };
}

/**
 * The x-axis tick for a week: its Monday and, under a week the range or the
 * chart's days cut off (the range's first week, this one so far), how many
 * of its days count, so a short bar at either end doesn't read as a slow
 * week. Such a week sits at an end, so its words anchor to that edge of the
 * plot instead of running off it. The first week says its year when that
 * isn't this one.
 */
function weekTick(weeks: readonly ChartWeek[]) {
   return function WeekTick({ x = 0, y = 0, width = 0, payload }: TickProps) {
      const i = weeks.findIndex(w => w.week === payload?.value);
      if (i < 0) return <g />;
      const w = weeks[i];
      // a paler week before the range is context, not a slow week to explain
      const cut = w.counted < 7 && !w.before;
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
               {/* the first tick carries the year; the rest stay short */}
               {i === 0 ? weekWords(w.week) : dayWords(w.week).replace(/, \d{4}$/, '')}
            </tspan>
            {cut && (
               <tspan x={at} dy="1.3em">
                  {w.counted} of 7 days
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
         tickFormatter={(day: string) => dayWords(day)}
         tick={weekTick(weeks)}
         interval="preserveStartEnd"
         minTickGap={16}
         height={32}
      />
   );
}

/** A window's weeks as the charts draw them. Without the picked range's own
 * weeks, the week the range starts in can't split, so its bar counts the
 * whole week, and it doesn't claim "5 of 7 days" under a bar holding all
 * seven. */
function weekFacts(
   weeks: readonly WeekPoint[],
   shown: DayRange | undefined,
   picked: DayRange | undefined,
   split: boolean
): ChartWeek[] {
   return weeks.map(w => {
      const f = chartWeek(w.week, shown, picked);
      return split || f.before ? f : { ...f, counted: f.days };
   });
}

/** Each week's number from the picked range's own weeks, by Monday, for
 * splitting the week the range starts in; 0 for a week they don't have. */
function rangeValues(
   facts: readonly ChartWeek[],
   rangeWeeks: readonly WeekPoint[] | undefined,
   pick: (w: WeekPoint) => number
): number[] | undefined {
   if (!rangeWeeks) return undefined;
   const byWeek = new Map(rangeWeeks.map(w => [w.week, w]));
   return facts.map(f => {
      const w = byWeek.get(f.week);
      return w ? pick(w) : 0;
   });
}

/** "Before the range: 3", or "Before the range: 2 opened, 1 merged", under a
 * tooltip for the week the range starts in; null for any other week. */
function beforeNote(w: ChartWeek, said: string | null): string | null {
   return !w.before && w.counted < w.days && said ? `Before the range: ${said}` : null;
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
               <XAxis
                  dataKey="date"
                  tickFormatter={(day: string) => dayWords(day)}
                  minTickGap={24}
                  {...xAxisProps}
               />
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
 * Merging fewer than arrive is what makes the backlog grow. The two words
 * over the plot take their bars' colors, so they label the bars without a
 * key, the way the roadmap's load chart labels its own.
 */
export function FlowWeeksChart({
   weeks,
   rangeWeeks,
   picked,
   shown,
   height = 160,
}: {
   weeks: WeekPoint[];
   /** the picked range's own weeks: the week the range starts in draws its
    * days before the range paler, instead of counting them as the range's */
   rangeWeeks?: WeekPoint[];
   /** the range the page's numbers cover; the weeks before it are paler */
   picked?: DayRange;
   /** the days the weeks were counted over, so a week they cut off says so */
   shown?: DayRange;
   height?: number;
}) {
   const facts = weekFacts(weeks, shown, picked, !!rangeWeeks);
   const both = ({ developers, non_developers }: WeekPoint['opened']) =>
      developers + non_developers;
   const split = (pick: (w: WeekPoint) => number) =>
      weekBars(weeks.map(pick), rangeValues(facts, rangeWeeks, pick), facts);
   const opened = split(w => both(w.opened));
   const merged = split(w => both(w.merged));
   const data = facts.map((f, i) => ({
      ...f,
      opened: opened.counted[i],
      openedBefore: opened.before[i],
      merged: merged.counted[i],
      mergedBefore: merged.before[i],
   }));
   // a week before the range is all pale: its numbers are the pale ones
   const shownOf = (d: typeof data[number]) =>
      d.before ? [d.openedBefore, d.mergedBefore] : [d.opened, d.merged];
   const tip = ({ active, payload }: TooltipContentProps) => {
      const row = payload?.[0]?.payload as typeof data[number] | undefined;
      if (!active || !row) return null;
      const [o, m] = shownOf(row);
      return (
         <TipCard
            title={weekTitle(row)}
            lines={[
               ['Opened', o, 'var(--ink-3)'],
               ['Merged', m, 'var(--ok)'],
            ]}
            note={beforeNote(
               row,
               row.openedBefore || row.mergedBefore
                  ? `${row.openedBefore} opened, ${row.mergedBefore} merged`
                  : null
            )}
         />
      );
   };
   const bar = (key: keyof typeof data[number], fill: string, opacity: number, stack: string) => (
      <Bar
         dataKey={key}
         stackId={stack}
         fill={fill}
         fillOpacity={opacity}
         radius={[4, 4, 0, 0]}
         isAnimationActive={false}
      />
   );
   return (
      <div>
         <Unit>
            PRs each week, <span className="font-semibold text-ink-2">opened</span> and{' '}
            <span className="font-semibold text-ok">merged</span>
         </Unit>
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
               {/* each series stacks the range's days under the paler days
                   before it, which only the week the range starts in has */}
               {bar('opened', 'var(--ink-3)', 0.55, 'opened')}
               {bar('openedBefore', 'var(--ink-3)', 0.2, 'opened')}
               {bar('merged', 'var(--ok)', 1, 'merged')}
               {bar('mergedBefore', 'var(--ok)', 0.3, 'merged')}
            </BarChart>
         </ResponsiveContainer>
         <SrTable
            caption="PRs opened and merged each week"
            head={['Week', 'Opened', 'Merged']}
            rows={data.map(d => {
               const note = beforeNote(
                  d,
                  d.openedBefore || d.mergedBefore
                     ? `${d.openedBefore} opened, ${d.mergedBefore} merged`
                     : null
               );
               return [`${weekTitle(d)}${note ? `. ${note}` : ''}`, ...shownOf(d)];
            })}
         />
      </div>
   );
}

/** One strip of a strip chart: its name, over its own bars, and its weeks. */
export interface Strip {
   name: string;
   bars: WeekBars;
}

/**
 * Groups' weeks, such as writing and reviewing days, or PRs opened by
 * developers and by everyone else: one strip of bars per group, one over the
 * other on the same scale and in the same ink, each named over its own bars,
 * so there's no key to learn. A week before the picked range is paler, and
 * so are the days before the range in the week it starts in, stacked on the
 * range's own days in that week's bar.
 */
export function StripsChart({
   weeks,
   strips,
   unit,
   ariaLabel,
   total,
   format = v => v,
   height = 160,
}: {
   /** every week of the chart's days, oldest first */
   weeks: ChartWeek[];
   strips: Strip[];
   /** what the y-axis counts, e.g. "PRs opened each week" */
   unit: string;
   ariaLabel: string;
   /** the tooltip's line adding up every strip, e.g. "All days" */
   total?: string;
   /** a number as the tooltip and the screen reader say it */
   format?: (value: number) => number | string;
   height?: number;
}) {
   const data = weeks.map((w, i) => ({
      ...w,
      ...Object.fromEntries(
         strips.flatMap((s, k) => [
            [`in${k}`, s.bars.counted[i]],
            [`before${k}`, s.bars.before[i]],
         ])
      ),
   }));
   // one scale for every strip, gridlines at round counts
   const top = Math.max(
      1,
      ...weeks.flatMap((_, i) => strips.map(s => s.bars.counted[i] + s.bars.before[i]))
   );
   // the baseline is 0 on every strip, so no strip labels it
   const ticks = yTicks(top);
   const strip = Math.max(40, Math.round((height - 32) / strips.length));
   // a week before the range is all pale: its numbers are the pale ones
   const valueOf = (s: Strip, w: ChartWeek, i: number) =>
      w.before ? s.bars.before[i] : s.bars.counted[i];
   const paleOf = (i: number) => strips.reduce((sum, s) => sum + s.bars.before[i], 0);
   const tip = ({ active, payload }: TooltipContentProps) => {
      const w = payload?.[0]?.payload as ChartWeek | undefined;
      if (!active || !w) return null;
      const i = weeks.findIndex(x => x.week === w.week);
      const pale = paleOf(i);
      return (
         <TipCard
            title={weekTitle(w)}
            lines={[
               ...strips.map((s): TipLine => [s.name, format(valueOf(s, w, i)), STRIP]),
               ...(total && strips.length > 1
                  ? [
                       [
                          total,
                          format(strips.reduce((sum, s) => sum + valueOf(s, w, i), 0)),
                          null,
                       ] as TipLine,
                    ]
                  : []),
            ]}
            note={beforeNote(w, pale ? String(format(pale)) : null)}
         />
      );
   };
   const plot = (s: Strip, k: number) => {
      // the weeks are named under the last strip; the others keep a baseline
      const axis = k === strips.length - 1;
      return (
         <div key={s.name}>
            {/* the name sits over its own bars, where the plot starts */}
            <div className="pl-10 text-xs text-ink-2">{s.name}</div>
            <ResponsiveContainer width="100%" height={axis ? strip + 32 : strip}>
               <BarChart
                  data={data}
                  margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                  role="img"
                  title={unit ? `${s.name}: ${unit}` : s.name}
                  // one keyboard stop for the chart: the first strip's
                  // tooltip says every strip's week
                  accessibilityLayer={k === 0}
               >
                  {grid}
                  {axis ? (
                     weekAxis(weeks)
                  ) : (
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
                     dataKey={`in${k}`}
                     stackId="week"
                     fill={STRIP}
                     radius={[3, 3, 0, 0]}
                     isAnimationActive={false}
                  />
                  <Bar
                     dataKey={`before${k}`}
                     stackId="week"
                     fill={STRIP}
                     fillOpacity={BEFORE}
                     radius={[3, 3, 0, 0]}
                     isAnimationActive={false}
                  />
               </BarChart>
            </ResponsiveContainer>
         </div>
      );
   };
   return (
      <div>
         {unit && <Unit>{unit}</Unit>}
         <div className="flex flex-col gap-1">{strips.map(plot)}</div>
         <SrTable
            caption={ariaLabel}
            head={['Week', ...strips.map(s => s.name)]}
            rows={weeks.map((w, i) => {
               const pale = paleOf(i);
               const note = beforeNote(w, pale ? String(format(pale)) : null);
               return [
                  `${weekTitle(w)}${note ? `. ${note}` : ''}`,
                  ...strips.map(s => format(valueOf(s, w, i))),
               ];
            })}
         />
      </div>
   );
}

/**
 * Two groups' weeks from a window's numbers, such as PRs opened by
 * developers and by everyone else, as two strips (StripsChart). With the
 * picked range's own weeks, the week the range starts in splits too.
 */
export function SplitWeeksChart({
   weeks,
   rangeWeeks,
   pick,
   labels,
   unit,
   ariaLabel,
   picked,
   shown,
   height = 160,
}: {
   weeks: WeekPoint[];
   /** the picked range's own weeks: the week the range starts in draws its
    * days before the range paler, instead of counting them as the range's */
   rangeWeeks?: WeekPoint[];
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
   const facts = weekFacts(weeks, shown, picked, !!rangeWeeks);
   const strip = (k: 0 | 1): Strip => ({
      name: labels[k],
      bars: weekBars(
         weeks.map(w => pick(w)[k]),
         rangeValues(facts, rangeWeeks, w => pick(w)[k]),
         facts
      ),
   });
   return (
      <StripsChart
         weeks={facts}
         strips={[strip(0), strip(1)]}
         unit={unit}
         ariaLabel={ariaLabel}
         height={height}
      />
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
               <div className="mt-1 text-xs text-ink-3">
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
