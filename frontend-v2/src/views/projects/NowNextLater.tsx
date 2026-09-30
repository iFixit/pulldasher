import { n } from '../../../../shared/format';
import {
   bucketOf,
   healthStanding,
   mondayOf,
   NEXT_WEEKS,
   type RoadmapItem,
} from '../../../../shared/model/roadmap';
import { eyebrowText } from '../../components/Lane';
import type { PortfolioItem } from '../../model/portfolio';
import { healthWords, planWords } from './roadmapHealth';

const BUCKETS: ['now' | 'next' | 'later', string, string][] = [
   ['now', 'Now', 'In progress, or its start has come'],
   ['next', 'Next', `Starting in the next ${NEXT_WEEKS} weeks`],
   ['later', 'Later', 'Further out'],
];

const dayWords = (day: string) =>
   new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
   });

function Card({
   item,
   linked,
   today,
   onOpen,
}: {
   item: RoadmapItem;
   linked: PortfolioItem | undefined;
   today: string;
   onOpen: () => void;
}) {
   const bucket = bucketOf(item, today);
   const health = healthWords(healthStanding(item));
   // still marked planned, though its start week has gone by
   const unstarted = item.status === 'planned' && item.start < mondayOf(today);
   return (
      <li className="rounded-lg border border-line bg-surface px-3 py-2">
         <button
            type="button"
            onClick={onOpen}
            className="hit pressable rounded border-0 bg-transparent p-0 text-left text-[13px] font-medium text-ink hover:text-brand"
            title="Open it on the timeline"
         >
            {item.name}
         </button>
         <div className="flex flex-wrap gap-x-2 text-xs">
            {unstarted && <span className="text-warn">Was to start {dayWords(item.start)}</span>}
            {health && (
               <span className={health.warn ? 'text-warn' : 'text-ink-2'} title={health.title}>
                  {health.text}
               </span>
            )}
            {bucket !== 'now' && <span className="text-ink-3">{planWords(item)}</span>}
            {[item.team, item.lead, linked?.open ? n(linked.open, 'open PR') : null]
               .filter(Boolean)
               .map(fact => (
                  <span key={fact} className="text-ink-3">
                     {fact}
                  </span>
               ))}
         </div>
      </li>
   );
}

/**
 * The roadmap without dates, for readers who want the order and not the
 * weeks: what's happening now, what's next, and what's later, each in
 * priority order. Opening an item switches to the timeline with it open, since
 * that's where its plan changes.
 */
export function NowNextLater({
   items,
   bySlug,
   laneTitles,
   today,
   onOpen,
}: {
   items: RoadmapItem[];
   bySlug: Map<string, PortfolioItem>;
   /** team names when the roadmap is split into team lanes, else null */
   laneTitles: string[] | null;
   today: string;
   onOpen: (id: number) => void;
}) {
   const groups = laneTitles
      ? [...laneTitles, null]
           .map(team => ({ team, list: items.filter(i => (i.team ?? null) === team) }))
           .filter(g => g.list.some(i => bucketOf(i, today)))
      : [{ team: null, list: items }];
   return (
      <div className="flex flex-col gap-5">
         {groups.map(g => (
            <section key={g.team ?? '(none)'}>
               {laneTitles && (
                  <h3 className={`m-0 mb-2 text-ink-3 ${eyebrowText}`}>{g.team ?? 'No team'}</h3>
               )}
               <div className="grid gap-4 sm:grid-cols-3">
                  {BUCKETS.map(([bucket, title, sub]) => {
                     const list = g.list.filter(i => bucketOf(i, today) === bucket);
                     return (
                        <div key={bucket} className="flex min-w-0 flex-col gap-2">
                           <div>
                              <span className="text-sm font-semibold text-ink">{title}</span>{' '}
                              <span className="text-xs text-ink-3 tabular-nums">
                                 · {list.length}
                              </span>
                              <div className="text-xs text-ink-3">{sub}</div>
                           </div>
                           {list.length ? (
                              <ol className="m-0 flex list-none flex-col gap-2 p-0">
                                 {list.map(item => (
                                    <Card
                                       key={item.id}
                                       item={item}
                                       linked={item.project ? bySlug.get(item.project) : undefined}
                                       today={today}
                                       onOpen={() => onOpen(item.id)}
                                    />
                                 ))}
                              </ol>
                           ) : (
                              <p className="m-0 text-xs text-ink-3">Nothing here.</p>
                           )}
                        </div>
                     );
                  })}
               </div>
            </section>
         ))}
      </div>
   );
}
