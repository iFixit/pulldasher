import { n } from '../../../shared/format';
import { STALL_DAYS } from '../../../shared/model/decide';
import { dayStart, utcDay } from '../../../shared/model/projects';
import {
   endOf,
   paceFinish,
   PILE_AGE_DAYS,
   PILE_GROWTH,
   PILE_MIN,
   UPDATE_DUE_DAYS,
   type RoadmapHealth,
   type RoadmapItem,
} from '../../../shared/model/roadmap';
import type { PrStage } from '../../../shared/model/stage';
import { dayWords } from './projectData';
import { STAGE_WORDS } from './stage';
import { andList, days, LAST_14_DAYS, noPrActivity, pastEnd } from './words';

const DAY = 86400;

/** the order a project's open PRs are counted in, nearest to shipping
 * first, as its page counts them */
const STAGES: readonly PrStage[] = ['ready', 'hold', 'review', 'work'];

/**
 * An update drafted from a plan's numbers (its `lately`), for its lead to
 * post as it is or change first. How it's going: off track once it runs
 * past a hard end with PRs open; at risk when its issues, at their pace,
 * never finish or finish after a hard end, or its open PRs stalled for
 * STALL_DAYS; else on track. A soft end is an estimate, so passing it is
 * said but changes nothing, and ongoing work has no end to say. Then a
 * sentence of what merged and where its open PRs stand (and how they pile
 * up, when that's why an update is owed), and one of what's left. Null with
 * no numbers to draft from.
 */
export function draftUpdate(
   item: Pick<RoadmapItem, 'start' | 'weeks' | 'end_kind' | 'lately'>,
   now: number
): { health: RoadmapHealth; body: string } | null {
   const lately = item.lately;
   if (!lately) return null;
   const end = endOf(item);
   const hard = item.end_kind === 'hard';
   const today = utcDay(now);
   const open = STAGES.reduce((sum, s) => sum + lately.open[s], 0);
   const ended = !!end && today > end;
   const idle = lately.activityAt == null ? null : Math.floor((now - lately.activityAt) / DAY);
   const stalled = open > 0 && idle != null && idle >= STALL_DAYS;
   const pace = end ? lately.issues : null;
   const finish = pace ? paceFinish(pace, now) : null;
   const after = !!end && finish != null && finish !== Infinity && utcDay(finish) > end;
   const health: RoadmapHealth =
      hard && ended && open > 0
         ? 'off_track'
         : finish === Infinity || (hard && after) || stalled
         ? 'at_risk'
         : 'on_track';

   const merged = lately.merged
      ? `${n(lately.merged, 'PR')} merged in the ${LAST_14_DAYS}`
      : `No PRs merged in the ${LAST_14_DAYS}`;
   const stages = STAGES.filter(s => lately.open[s]).map(
      s => `${lately.open[s]} ${STAGE_WORDS[s].toLowerCase()}`
   );
   const prs = open
      ? `${merged}, and ${open} ${open === 1 ? 'is' : 'are'} open: ${andList(stages)}.`
      : `${merged}, and none are open.`;
   // the pile a merge can't vouch for (roadmap.ts vouchFor), said in words
   const grew = open >= PILE_MIN && lately.grew >= PILE_GROWTH;
   const aged = open >= PILE_MIN && (lately.medianAge ?? 0) > PILE_AGE_DAYS;
   const more = `That’s ${lately.grew} more open than ${days(UPDATE_DUE_DAYS)} ago`;
   const half = `half have been open ${Math.floor(lately.medianAge ?? 0)} days or more`;
   const pile =
      grew && aged
         ? ` ${more}, and ${half}.`
         : grew
         ? ` ${more}.`
         : aged
         ? ` ${half.charAt(0).toUpperCase()}${half.slice(1)}.`
         : '';

   let left: string;
   if (!end) {
      left = stalled ? `${noPrActivity(idle as number)}.` : 'It’s ongoing, with no end date.';
   } else if (ended) {
      const weeks = Math.ceil(((dayStart(today) as number) - (dayStart(end) as number)) / DAY / 7);
      left = hard
         ? `It’s ${pastEnd(weeks)}, ${dayWords(end)}.`
         : `It’s ${pastEnd(weeks, 'soft')}, ${dayWords(end)}.`;
   } else if (stalled) {
      left = `${noPrActivity(idle as number)}.`;
   } else if (pace && finish === Infinity) {
      const words = pace.closed === pace.added ? 'as fast as' : 'faster than';
      left = `Its issues arrive ${words} they close: ${pace.closed} closed and ${pace.added} added in four weeks.`;
   } else if (pace && finish != null) {
      const issues = `${n(pace.open, 'open issue')} ${pace.open === 1 ? 'is' : 'are'}`;
      left = `At this pace its ${issues} done around ${dayWords(utcDay(finish))}, ${
         after ? 'after' : 'by'
      } its ${dayWords(end)}${hard ? '' : ' soft'} end.`;
   } else if (pace?.open) {
      const issues = `${n(pace.open, 'issue')} ${pace.open === 1 ? 'is' : 'are'}`;
      left = `${issues} still open, and it ends ${dayWords(end)}.`;
   } else {
      left = `It ends ${dayWords(end)}.`;
   }
   return { health, body: `${prs}${pile} ${left}` };
}
