import { n } from '../../../../shared/format';
import { addWeeks } from '../../../../shared/model/roadmap';
import { eyebrowText } from '../../components/Lane';
import { dayWords } from '../../model/projectData';
import type { LoadWeek } from '../../model/roadmapLoad';

/**
 * How loaded the weeks are, on the roadmap's own time axis so each week's
 * bar sits above the same weeks of every row. Every mark is labeled where
 * it is drawn, never in a legend: the weeks up to today say "In flight, from
 * PRs" (blue on the roadmap, gray with no plan), the weeks after say
 * "Planned", the dashed line says how many developers there are, and the
 * band above it is amber because there's more in flight than people.
 */

const ON_PLAN = 'var(--brand)';
const NO_PLAN = 'color-mix(in oklab, var(--ink-3) 55%, transparent)';
const PLANNED = 'color-mix(in oklab, var(--brand) 45%, transparent)';
const OVER_ZONE = 'color-mix(in oklab, var(--warn) 9%, transparent)';

const total = (w: LoadWeek) => w.onPlan + w.offPlan;

function weekWords(w: LoadWeek, developers: number): string {
   const people = developers ? `, for ${n(developers, 'developer')}` : '';
   return w.projected
      ? `Week of ${dayWords(w.week)}: ${w.onPlan} planned${people}`
      : `Week of ${dayWords(w.week)}: ${total(w)} in flight, ${w.onPlan} on the roadmap and ${
           w.offPlan
        } with no plan${people}`;
}

function Swatch({ color }: { color: string }) {
   return (
      <span
         aria-hidden
         className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]"
         style={{ background: color }}
      />
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
}) {
   const inFlight = total(now);
   const top = Math.max(developers, ...weeks.map(total), 1) * 1.15;
   const pct = (v: number) => `${(v / top) * 100}%`;
   const each = developers ? inFlight / developers : null;
   return (
      <div className={`${rowGrid} border-b border-line px-3.5 py-3`}>
         <div className="flex flex-col gap-0.5 self-start">
            <span className={`text-ink-3 ${eyebrowText}`}>In flight this week</span>
            <span className="text-2xl font-semibold leading-tight text-ink tabular-nums">
               {inFlight}
            </span>
            <span className="text-[11px] text-ink-2">
               <Swatch color={ON_PLAN} />
               {now.onPlan} on the roadmap
            </span>
            <span className="text-[11px] text-ink-2">
               <Swatch color={NO_PLAN} />
               {now.offPlan} with no plan
            </span>
            {each != null && (
               <span
                  className={`text-[11px] ${each >= 1 ? 'text-warn' : 'text-ink-3'}`}
                  title="In flight this week, per developer on a developer team"
               >
                  {n(developers, 'developer')}, {each.toFixed(1)} each
               </span>
            )}
         </div>
         <div className="min-w-0">
            {/* what each side of today counts, said where it's drawn */}
            <div className="relative h-4 text-[10px] font-medium text-ink-3">
               {when !== 'future' && (
                  <span
                     className="absolute top-0 pr-1.5 text-right whitespace-nowrap"
                     // ends clear of the Today tag, which sits centered on the line
                     style={
                        todayAt != null
                           ? { right: `calc(${100 - todayAt}% + 1.5rem)` }
                           : { left: 0 }
                     }
                  >
                     In flight, from PRs
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
                     className="absolute top-0 pl-1.5 whitespace-nowrap"
                     style={{ left: todayAt != null ? `calc(${todayAt}% + 1.5rem)` : 0 }}
                  >
                     Planned
                  </span>
               )}
            </div>
            <div
               className="relative h-20"
               role="img"
               aria-label={`Projects in flight each week: ${inFlight} this week${
                  developers ? ` for ${n(developers, 'developer')}` : ''
               }. Later weeks show what the roadmap plans.`}
            >
               {developers > 0 && (
                  <span
                     aria-hidden
                     className="absolute inset-x-0 top-0"
                     style={{ height: `${100 - (developers / top) * 100}%`, background: OVER_ZONE }}
                  />
               )}
               {weeks.map(w => {
                  const left = at(w.week);
                  return (
                     <span
                        key={w.week}
                        className="absolute bottom-0 flex h-full flex-col-reverse px-px hover:opacity-80"
                        style={{ left: `${left}%`, width: `${at(addWeeks(w.week, 1)) - left}%` }}
                        title={weekWords(w, developers)}
                     >
                        {w.projected ? (
                           <span
                              className="rounded-t-[1px]"
                              style={{ height: pct(w.onPlan), background: PLANNED }}
                           />
                        ) : (
                           <>
                              <span style={{ height: pct(w.onPlan), background: ON_PLAN }} />
                              <span
                                 className="rounded-t-[1px]"
                                 style={{ height: pct(w.offPlan), background: NO_PLAN }}
                              />
                           </>
                        )}
                     </span>
                  );
               })}
               {developers > 0 && (
                  <span
                     aria-hidden
                     className="pointer-events-none absolute inset-x-0 border-t border-dashed"
                     style={{ bottom: pct(developers), borderColor: 'var(--warn)' }}
                  >
                     <span className="absolute right-0 -top-4 bg-surface px-1 text-[10px] text-warn">
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
            </div>
         </div>
      </div>
   );
}
