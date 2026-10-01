import { n } from '../../../../shared/format';
import { bucketOf, NEXT_WEEKS, type RoadmapItem } from '../../../../shared/model/roadmap';
import { Fold, GroupHeader, Rows } from '../../components/Lane';
import type { PortfolioItem } from '../../model/portfolio';
import { planWarnings, SaidWords, type Said } from './roadmapHealth';

const BUCKETS: ['now' | 'next' | 'later', string, string][] = [
   ['now', 'Now', 'In progress, or its start week has begun'],
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

function Card({
   item,
   all,
   linked,
   today,
   team,
   onOpen,
}: {
   item: RoadmapItem;
   all: RoadmapItem[];
   linked: PortfolioItem | undefined;
   today: string;
   /** say its team: not when a team's fold already does */
   team: boolean;
   onOpen: () => void;
}) {
   const bucket = bucketOf(item, today);
   // the timeline's own warnings, in its words and with its one amber piece
   const w = planWarnings(
      item,
      all,
      today,
      linked ? { live: linked.status === 'live', target: linked.target } : null
   );
   const words = (s: Said | null, tone = '') =>
      s && (
         <span className={tone} title={s.title}>
            <SaidWords said={s} />
         </span>
      );
   return (
      // the whole row opens the plan; the name is its keyboard door
      <li
         onClick={onOpen}
         className="cursor-pointer border-t border-secondary px-3.5 py-2 first:border-t-0 hover:bg-muted"
      >
         <button
            type="button"
            onClick={e => {
               e.stopPropagation();
               onOpen();
            }}
            className="hit pressable rounded border-0 bg-transparent p-0 text-left text-[13px] font-medium text-ink hover:text-brand"
            title="Open it on the timeline"
         >
            {item.name}
         </button>
         <div className="flex flex-wrap gap-x-2 text-xs text-ink-3">
            {words(w.status)}
            {words(w.health, 'text-ink-2')}
            {words(w.over)}
            {words(w.target)}
            {bucket !== 'now' && <span>{monthWords(item.start, today)}</span>}
            {words(w.waits)}
            {[team ? item.team : null, item.lead, linked?.open ? n(linked.open, 'open PR') : null]
               .filter(Boolean)
               .map(fact => (
                  <span key={fact}>{fact}</span>
               ))}
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
   onOpen,
}: {
   /** the plans to show, as the find box narrows them, in priority order */
   items: RoadmapItem[];
   /** every plan, for what one waits on */
   all: RoadmapItem[];
   bySlug: Map<string, PortfolioItem>;
   /** team names when the roadmap is split into team lanes, else null */
   laneTitles: string[] | null;
   today: string;
   onOpen: (id: number) => void;
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
               onOpen={() => onOpen(item.id)}
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
