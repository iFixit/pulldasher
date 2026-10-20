import type { MouseEvent } from 'react';
import { bucketOf, NEXT_WEEKS, type RoadmapItem } from '../../../../shared/model/roadmap';
import { FactLink } from '../../components/bits';
import { Fold, GroupHeader, Rows } from '../../components/Lane';
import type { PortfolioItem } from '../../model/portfolio';
import { n } from '../../../../shared/format';
import { IN_PROGRESS } from '../../model/words';
import { Dotted, planWarnings, restWords, SaidWords, type PlanCall } from './roadmapHealth';

const BUCKETS: ['now' | 'next' | 'later', string, string][] = [
   ['now', 'Now', `${IN_PROGRESS}, or its start week has come`],
   ['next', 'Next', `Starts in the next ${NEXT_WEEKS} weeks`],
   ['later', 'Later', `Starts more than ${NEXT_WEEKS} weeks from now`],
];

/**
 * The month a plan's work starts, "starts in October" (with the year when it
 * isn't this one): the layout is for the order, not the weeks. A week
 * belongs to the month its Thursday falls in, so a plan starting the week of
 * Sep 28 reads October.
 */
function monthWords(start: string, today: string): string {
   const thursday = new Date(`${start}T00:00:00Z`);
   thursday.setUTCDate(thursday.getUTCDate() + 3);
   const sameYear = thursday.getUTCFullYear() === Number(today.slice(0, 4));
   return `starts in ${thursday.toLocaleDateString(undefined, {
      month: 'long',
      year: sameYear ? undefined : 'numeric',
      timeZone: 'UTC',
   })}`;
}

/** A word on a card that does what it does on the timeline; the card's own
 * click, which opens the plan, doesn't fire too. */
const only = (then: () => void) => (e: MouseEvent) => {
   e.stopPropagation();
   then();
};

/** A plan as a card: its name, then the timeline row's own words at rest
 * (Decide's question, its one amber mark, or a clash), the month it starts
 * when that's ahead, and its lead. The rest is in its details on the
 * timeline, which the card opens. */
function Card({
   item,
   all,
   linked,
   today,
   call,
   onOpen,
   onOpenPlan,
   onPerson,
}: {
   item: RoadmapItem;
   all: RoadmapItem[];
   linked: PortfolioItem | undefined;
   today: string;
   /** the call Decide asks about it */
   call: PlanCall | null;
   /** open it; 'plan' puts the focus on its Plan line */
   onOpen: (focus?: 'plan') => void;
   /** open another plan: the one a clash waits on */
   onOpenPlan: (id: number) => void;
   onPerson: (login: string) => void;
}) {
   const bucket = nnlBucket(item, today, call);
   // the timeline's own warnings, in its words and with its one amber piece
   const w = planWarnings(
      item,
      all,
      today,
      linked ? { live: linked.status === 'live', target: linked.target } : null,
      undefined,
      call
   );
   const rest = restWords(w);
   // the plan a clash opens; none when a call is asked instead
   const waits = w.call ? null : w.waits;
   const lead = item.lead;
   return (
      // the whole card opens the plan; the name is its keyboard door
      <li
         data-roadmap-row
         onClick={() => onOpen()}
         className="cursor-pointer scroll-mt-[calc(var(--header-h,0px)_+_0.5rem)] border-t border-secondary px-3.5 py-2 first:border-t-0 hover:bg-muted"
      >
         <button
            type="button"
            data-roadmap-focus
            onClick={only(() => onOpen())}
            className="hit pressable rounded border-0 bg-transparent p-0 text-left text-[13px] font-medium text-ink hover:text-brand"
            title="Open it on the timeline"
         >
            {item.name}
         </button>
         <div className="flex flex-wrap gap-x-1.5 text-xs text-ink-3">
            <Dotted>
               {[
                  rest && (
                     // a click opens the plan, as the card does, or for a
                     // clash, the plan it waits on; the focus on its Plan
                     // line, not on an answer
                     <span
                        key="rest"
                        title={rest.title}
                        onClick={only(() => (waits ? onOpenPlan(waits.opens.id) : onOpen('plan')))}
                        className="underline decoration-dotted underline-offset-2 hover:text-brand"
                     >
                        <SaidWords said={rest} />
                     </span>
                  ),
                  bucket !== 'now' && <span key="month">{monthWords(item.start, today)}</span>,
                  // no lead is said in the plan, not on every card
                  lead && (
                     <FactLink
                        key="lead"
                        onClick={only(() => onPerson(lead))}
                        title={`Open ${lead}’s row on People`}
                     >
                        {lead}
                     </FactLink>
                  ),
               ]}
            </Dotted>
         </div>
      </li>
   );
}

/** Which column a plan is in: bucketOf, and Now for a done, dropped or
 * parked plan Decide asks about, since its work goes on and a row Decide
 * asks about always shows. */
export function nnlBucket(
   item: Pick<RoadmapItem, 'status' | 'start'>,
   today: string,
   call: PlanCall | null | undefined
): 'now' | 'next' | 'later' | null {
   return bucketOf(item, today) ?? (call ? 'now' : null);
}

/**
 * The roadmap without dates, for readers who want the order and not the
 * weeks: what's happening now, what's next, and what's later, each in
 * priority order and each split by team or initiative when the roadmap
 * is. Opening an item
 * switches to the timeline with it open, since that's where its plan
 * changes.
 */
export function NowNextLater({
   items,
   all,
   bySlug,
   lanes,
   laneOf = item => item.team,
   today,
   calls,
   unplanned,
   asked = [],
   onOpen,
   onPerson,
   onTimeline,
}: {
   /** the plans to show, as the find box narrows them, in priority order */
   items: RoadmapItem[];
   /** every plan, for what one waits on */
   all: RoadmapItem[];
   bySlug: Map<string, PortfolioItem>;
   /** the lanes when the roadmap is split (teams, or initiatives in rank),
    * each by its key and title, the no-value lane last; null when not */
   lanes: { key: string | null; title: string }[] | null;
   /** which lane's key a plan is in */
   laneOf?: (item: RoadmapItem) => string | null;
   today: string;
   /** the calls Decide asks, by plan */
   calls: ReadonlyMap<number, PlanCall>;
   /** projects being worked on with no plan, which have no column here */
   unplanned: number;
   /** Not tracked plans Decide asks about: no place in the order, so no
    * column, but said, with the way to their question */
   asked?: RoadmapItem[];
   /** a plan, open on the timeline; 'plan' puts the focus on its Plan
    * line (a question or a clash), not on an answer */
   onOpen: (id: number, focus?: 'plan') => void;
   onPerson: (login: string) => void;
   /** the timeline, where the projects with no plan are */
   onTimeline: () => void;
}) {
   const cards = (list: RoadmapItem[]) => (
      <ol className="m-0 list-none p-0">
         {list.map(item => (
            <Card
               key={item.id}
               item={item}
               all={all}
               linked={item.project ? bySlug.get(item.project) : undefined}
               today={today}
               call={calls.get(item.id) ?? null}
               onOpen={focus => onOpen(item.id, focus)}
               onOpenPlan={id => onOpen(id, 'plan')}
               onPerson={onPerson}
            />
         ))}
      </ol>
   );
   return (
      <>
         <div className="grid gap-x-4 gap-y-6 sm:grid-cols-3">
            {BUCKETS.map(([bucket, title, sub]) => {
               const list = items.filter(i => nnlBucket(i, today, calls.get(i.id)) === bucket);
               const split =
                  lanes &&
                  lanes
                     .map(lane => ({
                        ...lane,
                        list: list.filter(i => (laneOf(i) ?? null) === lane.key),
                     }))
                     .filter(lane => lane.list.length);
               return (
                  <section key={bucket} className="min-w-0">
                     <GroupHeader title={title} sub={sub} count={list.length} level={3} compact />
                     {list.length ? (
                        <Rows>
                           {split
                              ? split.map(lane => (
                                   <Fold
                                      key={lane.key ?? '(none)'}
                                      id={`roadmap:nnl:${bucket}:${lane.key ?? '(none)'}`}
                                      defaultOpen
                                      label={lane.title}
                                      count={lane.list.length}
                                   >
                                      {cards(lane.list)}
                                   </Fold>
                                ))
                              : cards(list)}
                        </Rows>
                     ) : (
                        <p className="m-0 text-xs text-ink-3">No plans.</p>
                     )}
                  </section>
               );
            })}
         </div>
         {/* the timeline's Not tracked lane asks about these; here they'd
             have no column, so where they are is said */}
         {asked.length > 0 && (
            <p className="m-0 mt-4 text-xs text-ink-3">
               {asked.map((item, k) => (
                  <span key={item.id}>
                     {k ? (k === asked.length - 1 ? ' and ' : ', ') : ''}
                     <FactLink onClick={() => onOpen(item.id, 'plan')}>{item.name}</FactLink>
                  </span>
               ))}{' '}
               {asked.length === 1 ? 'is Not tracked, so it’s' : 'are Not tracked, so they’re'} in
               no column here, but Decide asks about {asked.length === 1 ? 'it' : 'them'}.
            </p>
         )}
         {/* without them, the columns would read as all the work */}
         {unplanned > 0 && (
            <p className="m-0 mt-4 text-xs text-ink-3">
               {n(unplanned, 'project')} with no plan {unplanned === 1 ? 'isn’t' : 'aren’t'} shown
               here.{' '}
               <FactLink onClick={onTimeline}>
                  See {unplanned === 1 ? 'it' : 'them'} on the timeline
               </FactLink>
            </p>
         )}
      </>
   );
}
