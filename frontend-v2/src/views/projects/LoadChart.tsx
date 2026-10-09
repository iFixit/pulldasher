import type { ReactNode } from 'react';
import { n } from '../../../../shared/format';
import { addWeeks, type RoadmapOrigin } from '../../../../shared/model/roadmap';
import { FactLink, QuietButton } from '../../components/bits';
import { dayWords } from '../../model/projectData';
import { NOT_SAID } from '../../model/words';

// what a week counts: a project with a PR open at some point in it (merged
// that week counts too), not the lanes' 14 days of "being worked on"
const PRS_OPEN = 'with PRs open';
import type { LoadWeek, OriginCounts } from '../../../../shared/model/load';

/**
 * How loaded the weeks up to today were, on the roadmap's own time axis so
 * each week's bar sits above the same weeks of every row. Each fact is said
 * once: the headline beside the bars names what they count (blue on the
 * roadmap, gray with no plan: the colors the counts under it are written
 * in), and the dashed line, the one ruler that matters, says how many
 * developers there are and leads to them. No y-axis: each bar's hover
 * gives its number. The headline answers the one question: more projects
 * than developers, said in amber. No bars after today: a plan list only
 * knows what's decided, so any forecast drawn from it can only fall. The
 * weeks ahead are said in words instead (Ahead), which the rows below can
 * check.
 */

const ON_PLAN = 'var(--brand)';
const OFF_PLAN = 'color-mix(in oklab, var(--ink-3) 70%, transparent)';

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
   unsaid: c => `${c} ${NOT_SAID.toLowerCase()}`,
};
const ORIGIN_TITLE: Record<OriginKey, string> = {
   asked: 'Show only the plans asked for from above',
   fire: 'Show only the plans that are fires to put out',
   chosen: 'Show only the plans the team picked itself',
   unsaid: 'Show only the plans with no word on where the work came from',
};

/** A plan and the day it starts or should end. */
export interface PlanDay {
   name: string;
   day: string;
}

/** The plans that start, and the plans that should end, in the next four
 * weeks (Roadmap.tsx). */
export interface Ahead {
   starts: PlanDay[];
   ends: PlanDay[];
}

/** "Next 4 weeks: 2 start, 3 should end", each count a dotted
 * underline whose hover names the plans and their days. */
function AheadWords({ ahead }: { ahead: Ahead }) {
   const { starts, ends } = ahead;
   if (!starts.length && !ends.length) return <>Nothing starts or ends in the next 4 weeks</>;
   const count = (list: PlanDay[], verb: string, words: string) => (
      <span
         tabIndex={0}
         title={list.map(p => `${p.name} ${verb} ${dayWords(p.day)}`).join('\n')}
         className="underline decoration-dotted underline-offset-2"
      >
         {words}
      </span>
   );
   const startWords =
      starts.length > 0 &&
      count(starts, 'starts', `${starts.length} ${starts.length === 1 ? 'starts' : 'start'}`);
   // plans go without saying on a roadmap
   const endWords = ends.length > 0 && count(ends, 'should end', `${ends.length} should end`);
   return (
      <>
         Next 4 weeks: {startWords}
         {startWords && endWords && ', '}
         {endWords}
      </>
   );
}

/** With no plans yet, where to start: the projects Decide asks to plan. */
function FirstPlan({ asked, onStart }: { asked: number; onStart: (() => void) | null }) {
   if (!asked) return <>No plans yet, and nothing big enough to need one.</>;
   return (
      <>
         No plans yet. Start with the {asked} that {asked === 1 ? 'needs' : 'need'} one.{' '}
         {onStart && <QuietButton onClick={onStart}>Plan the first one</QuietButton>}
      </>
   );
}

function weekWords(w: LoadWeek, developers: number): string {
   const people = developers ? `, for ${n(developers, 'developer')}` : '';
   return `Week of ${dayWords(w.week)}: ${total(w)} ${PRS_OPEN}, ${w.onPlan} with a plan and ${
      w.offPlan
   } with none${people}`;
}

/** A count that filters the rows to what it counts, and back on a second
 * click: it acts here, so it's a bordered chip, filled while pressed. The
 * count stays quiet; the words take the color of the bars they count, so
 * they label them without a legend. */
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
      <FactLink
         aria-pressed={active}
         onClick={onClick}
         title={title}
         className="self-start border border-line px-1.5 py-0.5 no-underline"
         style={active ? { background: 'var(--secondary)' } : undefined}
      >
         {count != null && <span className="tabular-nums">{count} </span>}
         <span className={tone}>{children}</span>
      </FactLink>
   );
}

export function LoadChart({
   weeks: all,
   now,
   developers,
   at,
   todayAt,
   when,
   ahead,
   rowGrid,
   picked,
   onPick,
   show,
   onShow,
   origin,
   onOrigin,
   onPeople,
   firstPlan,
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
   /** what starts and should end in the next four weeks, said right of today */
   ahead: Ahead;
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
   /** with no plans yet: how many projects Decide asks to plan, and the way
    * to plan the first of them (null when none is asked); null once a plan
    * exists */
   firstPlan?: { asked: number; onStart: (() => void) | null } | null;
}) {
   // only the weeks that happened: a projection from the plans can only fall
   const weeks = all.filter(w => !w.projected);
   // a picked week's numbers stand in for this week's
   const shown = (picked && weeks.find(w => w.week === picked)) || now;
   const inFlight = total(shown);
   // the week the counts are about, in words
   const weekName = picked ? `the week of ${dayWords(shown.week)}` : 'this week';
   // a count picks its week too, so its rows are the ones it counted
   const narrow = (then: () => void) => {
      if (picked !== shown.week) onPick(shown.week);
      then();
   };
   const step = (by: number) => {
      const i = weeks.findIndex(w => w.week === (picked ?? now.week));
      const next = weeks[Math.min(weeks.length - 1, Math.max(0, (i < 0 ? 0 : i) + by))];
      if (next) onPick(next.week);
   };
   const top = Math.max(developers, ...weeks.map(total), 1) * 1.15;
   const pct = (v: number) => `${(v / top) * 100}%`;
   const each = developers ? inFlight / developers : null;
   const over = developers ? inFlight - developers : 0;
   return (
      // its own stacking context, so no label in it paints over the sticky
      // headers above it
      <div className={`${rowGrid} isolate border-b border-line px-3.5 py-3`}>
         {/* a week picked with the arrow keys is read out, as a click shows it */}
         <span className="sr-only" aria-live="polite">
            {picked ? weekWords(shown, developers) : ''}
         </span>
         <div className="flex flex-col gap-1.5 self-start">
            {/* the answer: how many projects, and how many more than
                developers. It narrows the rows to its week; its hover fill
                says it presses, and no border makes it a card in a card */}
            <div className="flex flex-col items-start">
               <button
                  type="button"
                  aria-pressed={!!picked}
                  onClick={() => onPick(picked ? null : now.week)}
                  title={
                     picked
                        ? 'Show every week again'
                        : `A project counts in a week when one of its PRs was open in it, so this can differ from the lanes below, which count PRs in the last 14 days. Show only the plans and projects ${PRS_OPEN} this week`
                  }
                  className="pressable -mx-1.5 flex flex-col items-start rounded-md border-0 bg-transparent px-1.5 py-0.5 text-left hover:bg-muted"
                  style={picked ? { background: 'var(--secondary)' } : undefined}
               >
                  <span className="text-xl font-semibold text-ink tabular-nums">{inFlight}</span>
                  <span className="text-xs text-ink-2">
                     {inFlight === 1 ? 'project' : 'projects'} {PRS_OPEN}
                     {picked ? ` ${weekName}` : <span className="text-ink-3"> this week</span>}
                  </span>
                  {over > 0 && (
                     <span className="text-xs text-warn">{over} more than developers</span>
                  )}
               </button>
            </div>
            {/* the two halves of the count, in one line; each narrows the rows
                to what it counts, in the week it counts them, so its number
                and its rows agree. Where the plans came from is a closer look:
                it shows once the rows are narrowed to the plans. */}
            {/* with no plans, "0 have a plan" is always 0: the line waits for one */}
            <div className={`flex flex-col gap-0.5 text-[11px] ${firstPlan ? 'hidden' : ''}`}>
               <span className="flex flex-wrap items-baseline gap-x-1.5">
                  <CountButton
                     active={show === 'plan'}
                     onClick={() =>
                        show === 'plan' ? onShow('all') : narrow(() => onShow('plan'))
                     }
                     title={`Show only the plans on the roadmap ${weekName}`}
                     count={shown.onPlan}
                  >
                     {shown.onPlan === 1 ? 'has a plan' : 'have a plan'}
                  </CountButton>
                  <span aria-hidden className="text-ink-3">
                     ·
                  </span>
                  <CountButton
                     active={show === 'unplanned'}
                     onClick={() =>
                        show === 'unplanned' ? onShow('all') : narrow(() => onShow('unplanned'))
                     }
                     title={`Show only the projects ${PRS_OPEN} with no plan ${weekName}`}
                     count={shown.offPlan}
                     tone="text-ink-3"
                  >
                     {shown.offPlan === 1 ? 'has none' : 'have none'}
                  </CountButton>
               </span>
               <OriginSplit
                  keys={originsShown(show, origin, shown.origins)}
                  counts={shown.origins}
                  origin={origin}
                  onOrigin={o => (o ? narrow(() => onOrigin(o)) : onOrigin(null))}
                  weekName={weekName}
               />
            </div>
         </div>
         <div className="min-w-0">
            {/* today, in brand words over its line: the line marks it, so
                no fill to make it the loudest thing here */}
            <div className="relative h-4 text-[11px] font-semibold text-brand">
               {todayAt != null && (
                  <span
                     className="absolute top-0 -translate-x-1/2 leading-4"
                     style={{ left: `${todayAt}%` }}
                  >
                     Today
                  </span>
               )}
            </div>
            <div
               className="relative h-20"
               role="group"
               tabIndex={0}
               aria-label={`Plans and projects ${PRS_OPEN} each week up to today, counted from their PRs: ${total(
                  now
               )} this week${
                  developers ? ` for ${n(developers, 'developer')}` : ''
               }. Click a week, or use the arrow keys, to show only that week’s plans and projects; Escape shows every week.`}
               onKeyDown={e => {
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                     e.preventDefault();
                     step(e.key === 'ArrowRight' ? 1 : -1);
                  } else if (e.key === 'Escape') onPick(null);
               }}
            >
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
                        <span style={{ height: pct(w.onPlan), background: ON_PLAN }} />
                        <span
                           className="rounded-t-[1px]"
                           style={{ height: pct(w.offPlan), background: OFF_PLAN }}
                        />
                     </button>
                  );
               })}
               {developers > 0 && (
                  // a plain reference: the headline says when it's crossed
                  <>
                     <span
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 border-t border-dashed border-ink-3"
                        style={{ bottom: pct(developers) }}
                     />
                     {/* on the line, over the bars, so it keeps the card behind
                         it; the way to the teams on People */}
                     <FactLink
                        onClick={onPeople}
                        className="absolute right-0 bg-surface px-1 text-[11px] leading-4 tabular-nums"
                        style={{ bottom: pct(developers) }}
                        title={`${n(developers, 'developer')} on the developer teams${
                           each == null
                              ? ''
                              : `, ${each.toFixed(1)} plans and projects each ${weekName}`
                        }. At 1.0 or more, some work has one developer or none. Click to see the teams on People.`}
                     >
                        {n(developers, 'developer')}
                     </FactLink>
                  </>
               )}
               {todayAt != null && (
                  <span
                     aria-hidden
                     className="pointer-events-none absolute inset-y-0 border-l border-dashed"
                     style={{ left: `${todayAt}%`, borderColor: 'var(--brand)' }}
                  />
               )}
               {/* the weeks ahead, in words the rows can check, in the room
                   right of today */}
               {when !== 'past' && (
                  <span
                     className="absolute top-1/2 right-0 -translate-y-1/2 pl-3 text-[11px] leading-4 text-ink-2"
                     style={{ left: todayAt != null ? `${todayAt}%` : 0 }}
                  >
                     {/* on the card, so the developer line doesn't strike it */}
                     <span className="bg-surface pr-1">
                        {firstPlan ? <FirstPlan {...firstPlan} /> : <AheadWords ahead={ahead} />}
                     </span>
                  </span>
               )}
            </div>
         </div>
      </div>
   );
}

/**
 * Which origins the roadmap count splits into: none at rest, since where the
 * work came from is a closer look than the load; once the rows narrow to the
 * plans, or to an origin, each with plans that week, and the picked one even
 * at none, so it can be let go. Until some plan says, there's nothing to
 * split.
 */
export function originsShown(
   show: 'all' | 'plan' | 'unplanned',
   origin: OriginKey | null,
   counts: OriginCounts
): OriginKey[] {
   const said = counts.asked + counts.fire + counts.chosen > 0;
   if (!origin && (show !== 'plan' || !said)) return [];
   return (Object.keys(ORIGIN_COUNT) as OriginKey[]).filter(k => counts[k] > 0 || k === origin);
}

/** The plans on the roadmap split by where their work came from, each count
 * a filter like the ones above it. */
function OriginSplit({
   keys,
   counts,
   origin,
   onOrigin,
   weekName,
}: {
   /** the origins to show (originsShown) */
   keys: OriginKey[];
   counts: OriginCounts;
   origin: OriginKey | null;
   onOrigin: (origin: OriginKey | null) => void;
   /** the week the counts are about, in words */
   weekName: string;
}) {
   if (!keys.length) return null;
   return (
      <span className="flex flex-wrap gap-x-2 pl-3.5">
         {keys.map(k => (
            <CountButton
               key={k}
               active={origin === k}
               onClick={() => onOrigin(origin === k ? null : k)}
               title={`${ORIGIN_TITLE[k]}, ${weekName}`}
            >
               {ORIGIN_COUNT[k](counts[k])}
            </CountButton>
         ))}
      </span>
   );
}
