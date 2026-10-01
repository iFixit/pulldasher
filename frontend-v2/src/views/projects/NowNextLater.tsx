import type { MouseEvent } from 'react';
import { n } from '../../../../shared/format';
import { bucketOf, NEXT_WEEKS, type RoadmapItem } from '../../../../shared/model/roadmap';
import { FactLink } from '../../components/bits';
import { Fold, GroupHeader, Rows } from '../../components/Lane';
import type { PortfolioItem } from '../../model/portfolio';
import { IN_PROGRESS } from '../../model/words';
import { Dotted, planWarnings, SaidWords, type PlanCall, type Said } from './roadmapHealth';

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

function Card({
   item,
   all,
   linked,
   today,
   team,
   call,
   onOpen,
   onUpdates,
   onOpenItem,
   onPerson,
}: {
   item: RoadmapItem;
   all: RoadmapItem[];
   linked: PortfolioItem | undefined;
   today: string;
   /** say its team: not when a team's fold already does */
   team: boolean;
   /** the call Decide asks about it */
   call: PlanCall | null;
   onOpen: () => void;
   /** its updates, on the timeline */
   onUpdates: () => void;
   /** another plan, on the timeline */
   onOpenItem: (id: number) => void;
   onPerson: (login: string) => void;
}) {
   const bucket = bucketOf(item, today);
   // the timeline's own warnings, in its words and with its one amber piece
   const w = planWarnings(
      item,
      all,
      today,
      linked ? { live: linked.status === 'live', target: linked.target } : null,
      undefined,
      call
   );
   const words = (s: Said | null, key: string) =>
      s && (
         <span key={key} title={s.title}>
            <SaidWords said={s} />
         </span>
      );
   const { health, waits } = w;
   const lead = item.lead;
   return (
      // the whole card opens the plan; the name is its keyboard door
      <li
         data-roadmap-row
         onClick={onOpen}
         className="cursor-pointer scroll-mt-[calc(var(--header-h,0px)_+_0.5rem)] border-t border-secondary px-3.5 py-2 first:border-t-0 hover:bg-muted"
      >
         <button
            type="button"
            data-roadmap-focus
            onClick={only(onOpen)}
            className="hit pressable rounded border-0 bg-transparent p-0 text-left text-[13px] font-medium text-ink hover:text-brand"
            title="Open it on the timeline"
         >
            {item.name}
         </button>
         <div className="flex flex-wrap gap-x-1.5 text-xs text-ink-3">
            <Dotted>
               {[
                  words(w.status, 'status'),
                  health && (
                     <FactLink
                        key="health"
                        onClick={only(onUpdates)}
                        title={`${health.title}\nClick to see its updates and post one.`}
                     >
                        <SaidWords said={health} />
                     </FactLink>
                  ),
                  // past its end, Decide's call already says so
                  w.call?.kind !== 'over' && words(w.over, 'over'),
                  words(w.target, 'target'),
                  bucket !== 'now' && <span key="month">{monthWords(item.start, today)}</span>,
                  waits && (
                     <FactLink
                        key="waits"
                        onClick={only(() => onOpenItem(waits.opens.id))}
                        title={`${waits.title}. Click to open ${waits.opens.name}.`}
                     >
                        <SaidWords said={waits} />
                     </FactLink>
                  ),
                  team && item.team && <span key="team">{item.team}</span>,
                  lead && (
                     <FactLink
                        key="lead"
                        onClick={only(() => onPerson(lead))}
                        title={`Open ${lead}’s row on People`}
                     >
                        {lead}
                     </FactLink>
                  ),
                  !!linked?.open && <span key="open">{n(linked.open, 'open PR')}</span>,
               ]}
            </Dotted>
         </div>
      </li>
   );
}

/**
 * The roadmap without dates, for readers who want the order and not the
 * weeks: what's happening now, what's next, and what's later, each in
 * priority order and each split by team when the roadmap is. Opening an item
 * switches to the timeline with it open, since that's where its plan
 * changes.
 */
export function NowNextLater({
   items,
   all,
   bySlug,
   laneTitles,
   today,
   calls,
   onOpen,
   onUpdates,
   onPerson,
}: {
   /** the plans to show, as the find box narrows them, in priority order */
   items: RoadmapItem[];
   /** every plan, for what one waits on */
   all: RoadmapItem[];
   bySlug: Map<string, PortfolioItem>;
   /** team names when the roadmap is split into team lanes, else null */
   laneTitles: string[] | null;
   today: string;
   /** the calls Decide asks, by plan */
   calls: ReadonlyMap<number, PlanCall>;
   /** a plan, open on the timeline */
   onOpen: (id: number) => void;
   /** a plan's updates, open on the timeline */
   onUpdates: (id: number) => void;
   onPerson: (login: string) => void;
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
               team={!laneTitles}
               call={calls.get(item.id) ?? null}
               onOpen={() => onOpen(item.id)}
               onUpdates={() => onUpdates(item.id)}
               onOpenItem={onOpen}
               onPerson={onPerson}
            />
         ))}
      </ol>
   );
   return (
      <div className="grid gap-x-4 gap-y-6 sm:grid-cols-3">
         {BUCKETS.map(([bucket, title, sub]) => {
            const list = items.filter(i => bucketOf(i, today) === bucket);
            const lanes =
               laneTitles &&
               [...laneTitles, null]
                  .map(team => ({ team, list: list.filter(i => (i.team ?? null) === team) }))
                  .filter(lane => lane.list.length);
            return (
               <section key={bucket} className="min-w-0">
                  <GroupHeader title={title} sub={sub} count={list.length} level={3} compact />
                  {list.length ? (
                     <Rows>
                        {lanes
                           ? lanes.map(lane => (
                                <Fold
                                   key={lane.team ?? '(none)'}
                                   id={`roadmap:nnl:${bucket}:${lane.team ?? '(none)'}`}
                                   defaultOpen
                                   label={lane.team ?? 'No team'}
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
   );
}
