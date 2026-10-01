import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { n } from '../../../../shared/format';
import { addWeeks, type RoadmapOrigin } from '../../../../shared/model/roadmap';
import { dayWords } from '../../model/projectData';
import type { LoadWeek, OriginCounts } from '../../../../shared/model/load';
import { Tile } from './parts';
import { crossesLine } from './roadmapHealth';

/**
 * How loaded the weeks are, on the roadmap's own time axis so each week's
 * bar sits above the same weeks of every row. Every mark is labeled where
 * it is drawn, never in a legend: the weeks up to today say "In progress,
 * from PRs" (blue on the roadmap, gray with no plan: the colors the counts
 * beside them are written in), the weeks after say "Ahead, if nothing
 * changes" (the plans, and every project still open with no decision, in
 * lighter tints), and the dashed line says how many developers there are.
 * The line turns amber once a week from this one on has more in flight than
 * people: the one call the chart asks for.
 */

const ON_PLAN = 'var(--brand)';
const OFF_PLAN = 'color-mix(in oklab, var(--ink-3) 70%, transparent)';
// paler for the weeks ahead, and still apart from the card (about 2:1)
const ON_PLAN_AHEAD = 'color-mix(in oklab, var(--brand) 45%, transparent)';
const OFF_PLAN_AHEAD = 'color-mix(in oklab, var(--ink-3) 45%, transparent)';

const total = (w: LoadWeek) => w.onPlan + w.offPlan;

/** Round tick values from 0 to `top`, at most four, for the y-axis. */
export function yTicks(top: number): number[] {
   const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find(s => top / s <= 4) ?? 1000;
   const ticks: number[] = [];
   for (let v = step; v <= top; v += step) ticks.push(v);
   return ticks;
}

type OriginKey = RoadmapOrigin | 'unsaid';
/** A count of plans from one origin, in words. */
const ORIGIN_COUNT: Record<OriginKey, (count: number) => string> = {
   asked: c => `${c} asked for`,
   fire: c => n(c, 'fire'),
   chosen: c => n(c, 'team’s pick'),
   unsaid: c => `${c} not said`,
};
const ORIGIN_TITLE: Record<OriginKey, string> = {
   asked: 'Show only the plans asked for from above',
   fire: 'Show only the plans that are fires to put out',
   chosen: 'Show only the plans the team picked itself',
   unsaid: 'Show only the plans with no word on where the work came from',
};

function weekWords(w: LoadWeek, developers: number): string {
   const people = developers ? `, for ${n(developers, 'developer')}` : '';
   return w.projected
      ? `Week of ${dayWords(w.week)}, if nothing changes: ${total(w)} in progress, ${
           w.onPlan
        } on the roadmap and ${w.offPlan} with no plan that need one${people}`
      : `Week of ${dayWords(w.week)}: ${total(w)} in progress, ${w.onPlan} on the roadmap and ${
           w.offPlan
        } with no plan${people}`;
}

/** A count that filters the rows to what it counts, and back on a second
 * click. The count stays quiet; the words take the color of the bars they
 * count, so they label them without a legend. */
function CountButton({
   active,
   onClick,
   title,
   count,
   tone = '',
   children,
}: {
   active: boolean;
   onClick: () => void;
   title: string;
   count?: number;
   /** the color of the bars it counts */
   tone?: string;
   children: ReactNode;
}) {
   return (
      <button
         type="button"
         aria-pressed={active}
         onClick={onClick}
         title={title}
         // pressed is a chip around it; the padding is paid back so nothing moves
         className={`pressable -mx-1 self-start rounded border-0 px-1 text-left text-[11px] hover:underline ${
            active ? 'bg-secondary' : 'bg-transparent'
         }`}
      >
         {count != null && <span className="text-ink-2 tabular-nums">{count} </span>}
         <span className={tone || 'text-ink-2'}>{children}</span>
      </button>
   );
}

export function LoadChart({
   weeks,
   now,
   developers,
   at,
   todayAt,
   when,
   rowGrid,
   picked,
   onPick,
   show,
   onShow,
   origin,
   onOrigin,
   onPeople,
}: {
   weeks: LoadWeek[];
   /** this week's load, whatever weeks the chart shows */
   now: LoadWeek;
   /** everyone on a developer team; 0 when none are set up */
   developers: number;
   /** a day's place across the track, 0 to 100 */
   at: (day: string) => number;
   todayAt: number | null;
   /** whether the shown weeks are all past, all to come, or today falls among them */
   when: 'past' | 'future' | 'both';
   /** the roadmap's row grid, so the chart's track lines up with the rows' */
   rowGrid: string;
   /** the week picked by clicking its bar, or null */
   picked: string | null;
   onPick: (week: string | null) => void;
   /** what the rows show, which the counts switch */
   show: 'all' | 'plan' | 'unplanned';
   onShow: (show: 'all' | 'plan' | 'unplanned') => void;
   /** where the shown plans came from, picked from the counts; null for all */
   origin: OriginKey | null;
   onOrigin: (origin: OriginKey | null) => void;
   /** to the developer teams */
   onPeople: () => void;
}) {
   // each label above the plot shows only where it fits beside today's tag:
   // on a phone's narrow plot, one would run off the edge
   const pastLabel = useRef<HTMLSpanElement>(null);
   const aheadLabel = useRef<HTMLSpanElement>(null);
   const [fits, setFits] = useState({ past: true, ahead: true });
   useLayoutEffect(() => {
      const row = pastLabel.current?.parentElement ?? aheadLabel.current?.parentElement;
      if (!row) return;
      const check = () => {
         const past = pastLabel.current;
         const ahead = aheadLabel.current;
         const next = {
            past: !past || past.offsetLeft >= 0,
            ahead: !ahead || ahead.offsetLeft + ahead.offsetWidth <= row.clientWidth,
         };
         setFits(f => (f.past === next.past && f.ahead === next.ahead ? f : next));
      };
      check();
      const watch = new ResizeObserver(check);
      watch.observe(row);
      return () => watch.disconnect();
   }, [todayAt, when]);
   // a picked week's numbers stand in for this week's
   const shown = (picked && weeks.find(w => w.week === picked)) || now;
   const inFlight = total(shown);
   const step = (by: number) => {
      const i = weeks.findIndex(w => w.week === (picked ?? now.week));
      const next = weeks[Math.min(weeks.length - 1, Math.max(0, (i < 0 ? 0 : i) + by))];
      if (next) onPick(next.week);
   };
   const top = Math.max(developers, ...weeks.map(total), 1) * 1.15;
   const pct = (v: number) => `${(v / top) * 100}%`;
   const each = developers ? inFlight / developers : null;
   const crossed = crossesLine(weeks, now.week, developers);
   const ticks = yTicks(top);
   return (
      // its own stacking context, so no label in it paints over the sticky
      // headers above it
      <div className={`${rowGrid} isolate border-b border-line px-3.5 py-3`}>
         <div className="flex flex-col gap-1.5 self-start">
            <Tile
               value={inFlight}
               label={
                  picked ? `In progress the week of ${dayWords(picked)}` : 'In progress this week'
               }
               title={
                  picked
                     ? 'Show every week again'
                     : 'Show only the plans and projects in progress this week'
               }
               onClick={() => onPick(picked ? null : now.week)}
            />
            <div className="flex flex-col gap-0.5">
               <CountButton
                  active={show === 'plan'}
                  onClick={() => onShow(show === 'plan' ? 'all' : 'plan')}
                  title="Show only the plans on the roadmap"
                  count={shown.onPlan}
                  tone="text-brand"
               >
                  on the roadmap
               </CountButton>
               <OriginSplit counts={shown.origins} origin={origin} onOrigin={onOrigin} />
               <CountButton
                  active={show === 'unplanned'}
                  onClick={() => onShow(show === 'unplanned' ? 'all' : 'unplanned')}
                  title="Show only the projects in progress with no plan"
                  count={shown.offPlan}
                  tone="text-ink-3"
               >
                  with no plan
               </CountButton>
               {each != null && (
                  <button
                     type="button"
                     onClick={onPeople}
                     className="pressable self-start rounded border-0 bg-transparent p-0 text-left text-[11px] text-ink-3 tabular-nums hover:underline"
                     title="Plans and projects in progress in the week shown, per person on a developer team. At 1.0 or more, some work has one developer or none. Click to see the teams on People."
                  >
                     {n(developers, 'developer')}, {each.toFixed(1)} projects each
                  </button>
               )}
            </div>
         </div>
         <div className="min-w-0">
            {/* what each side of today counts, said where it's drawn */}
            <div className="relative h-4 text-[10px] font-medium text-ink-3">
               {when !== 'future' && (
                  <span
                     ref={pastLabel}
                     className="absolute top-0 pr-1.5 text-right whitespace-nowrap"
                     // ends clear of the Today tag, which sits centered on the line
                     style={{
                        ...(todayAt != null
                           ? { right: `calc(${100 - todayAt}% + 1.5rem)` }
                           : { left: 0 }),
                        visibility: fits.past ? undefined : 'hidden',
                     }}
                  >
                     In progress, from PRs
                  </span>
               )}
               {todayAt != null && (
                  <span
                     className="absolute top-0 -translate-x-1/2 rounded-sm bg-brand px-1 leading-4 font-semibold text-surface"
                     style={{ left: `${todayAt}%` }}
                  >
                     Today
                  </span>
               )}
               {when !== 'past' && (
                  <span
                     ref={aheadLabel}
                     className="absolute top-0 pl-1.5 whitespace-nowrap"
                     style={{
                        left: todayAt != null ? `calc(${todayAt}% + 1.5rem)` : 0,
                        visibility: fits.ahead ? undefined : 'hidden',
                     }}
                  >
                     Ahead, if nothing changes
                  </span>
               )}
            </div>
            <div
               className="relative h-20"
               role="group"
               tabIndex={0}
               aria-label={`Plans and projects in progress each week: ${total(now)} this week${
                  developers ? ` for ${n(developers, 'developer')}` : ''
               }. Weeks after this one count the plans, and the projects with no plan that need one, as if nothing changes. Click a week, or use the arrow keys, to show only what was in progress then; Escape shows every week.`}
               onKeyDown={e => {
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                     e.preventDefault();
                     step(e.key === 'ArrowRight' ? 1 : -1);
                  } else if (e.key === 'Escape') onPick(null);
               }}
            >
               {/* the y-axis: hairline gridlines at round counts, under the bars */}
               {ticks.map(v => (
                  <span
                     key={v}
                     aria-hidden
                     className="pointer-events-none absolute inset-x-0 border-t border-secondary"
                     style={{ bottom: pct(v) }}
                  />
               ))}
               {weeks.map(w => {
                  const left = at(w.week);
                  const isPicked = w.week === picked;
                  return (
                     // a week's column is the button that picks it; the chart
                     // itself takes the keys, so the weeks aren't 78 tab stops
                     <button
                        type="button"
                        tabIndex={-1}
                        key={w.week}
                        aria-pressed={isPicked}
                        onClick={() => onPick(isPicked ? null : w.week)}
                        className="absolute bottom-0 flex h-full flex-col-reverse border-0 p-0 px-px hover:opacity-80"
                        style={{
                           left: `${left}%`,
                           width: `${at(addWeeks(w.week, 1)) - left}%`,
                           background: isPicked
                              ? 'color-mix(in oklab, var(--ink) 12%, transparent)'
                              : 'transparent',
                        }}
                        title={`${weekWords(
                           w,
                           developers
                        )}. Click to show only that week’s plans and projects.`}
                     >
                        <span
                           style={{
                              height: pct(w.onPlan),
                              background: w.projected ? ON_PLAN_AHEAD : ON_PLAN,
                           }}
                        />
                        <span
                           className="rounded-t-[1px]"
                           style={{
                              height: pct(w.offPlan),
                              background: w.projected ? OFF_PLAN_AHEAD : OFF_PLAN,
                           }}
                        />
                     </button>
                  );
               })}
               {developers > 0 && (
                  // ink until a week ahead has more in flight than people;
                  // the count beside it is a fact, so it stays ink
                  <span
                     aria-hidden
                     className="pointer-events-none absolute inset-x-0 border-t border-dashed"
                     style={{
                        bottom: pct(developers),
                        borderColor: crossed ? 'var(--warn)' : 'var(--ink-3)',
                     }}
                  >
                     <span className="absolute right-0 -top-4 bg-surface px-1 text-[10px] text-ink-3 tabular-nums">
                        {n(developers, 'developer')}
                     </span>
                  </span>
               )}
               {todayAt != null && (
                  <span
                     aria-hidden
                     className="pointer-events-none absolute inset-y-0 border-l border-dashed"
                     style={{ left: `${todayAt}%`, borderColor: 'var(--brand)' }}
                  />
               )}
               {/* the gridlines' counts, the unit on the top one: beside the
                   plot from sm up, so they never cover the first weeks; over
                   it on a phone, where the counts sit above the chart */}
               {ticks.map((v, i) => (
                  <span
                     key={`label-${v}`}
                     aria-hidden
                     className="pointer-events-none absolute left-0 translate-y-1/2 bg-surface pr-1 text-[10px] leading-none whitespace-nowrap text-ink-3 tabular-nums sm:left-auto sm:right-full sm:bg-transparent sm:pr-1.5"
                     style={{ bottom: pct(v) }}
                  >
                     {i === ticks.length - 1 ? n(v, 'project') : v}
                  </span>
               ))}
            </div>
         </div>
      </div>
   );
}

/**
 * The plans on the roadmap split by where their work came from, each count a
 * filter like the ones above it. Until some plan says, there's nothing to
 * split, so it stays out of the way.
 */
function OriginSplit({
   counts,
   origin,
   onOrigin,
}: {
   counts: OriginCounts;
   origin: OriginKey | null;
   onOrigin: (origin: OriginKey | null) => void;
}) {
   // the picked one stays, even at none this week, so it can be turned off
   const keys = (Object.keys(ORIGIN_COUNT) as OriginKey[]).filter(
      k => counts[k] > 0 || k === origin
   );
   if (!origin && counts.asked + counts.fire + counts.chosen === 0) return null;
   return (
      <span className="flex flex-wrap gap-x-2 pl-3.5">
         {keys.map(k => (
            <CountButton
               key={k}
               active={origin === k}
               onClick={() => onOrigin(origin === k ? null : k)}
               title={ORIGIN_TITLE[k]}
            >
               {ORIGIN_COUNT[k](counts[k])}
            </CountButton>
         ))}
      </span>
   );
}
