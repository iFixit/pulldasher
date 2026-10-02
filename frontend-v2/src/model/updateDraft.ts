import { n } from '../../../shared/format';
import { STALL_DAYS } from '../../../shared/model/decide';
import { dayStart, utcDay } from '../../../shared/model/projects';
import {
   paceFinish,
   planEnd,
   type RoadmapHealth,
   type RoadmapItem,
} from '../../../shared/model/roadmap';
import type { PrStage } from '../../../shared/model/stage';
import { dayWords } from './projectData';
import { STAGE_WORDS } from './stage';
import { andList, LAST_14_DAYS, noPrActivity, pastEnd } from './words';

const DAY = 86400;

/** the order a project's open PRs are counted in, nearest to shipping
 * first, as its page counts them */
const STAGES: readonly PrStage[] = ['ready', 'hold', 'review', 'work'];

/**
 * An update drafted from a plan's numbers (its `lately`), for its lead to
 * post as it is or change first. How it's going: off track once it runs
 * past its end with PRs open; at risk when its issues, at their pace,
 * finish after its end, or its open PRs stalled for STALL_DAYS; else on
 * track. Then a sentence of what merged and where its open PRs stand, and
 * one of what's left. Null with no numbers to draft from.
 */
export function draftUpdate(
   item: Pick<RoadmapItem, 'start' | 'weeks' | 'lately'>,
   now: number
): { health: RoadmapHealth; body: string } | null {
   const lately = item.lately;
   if (!lately) return null;
   const end = planEnd(item);
   const today = utcDay(now);
   const open = STAGES.reduce((sum, s) => sum + lately.open[s], 0);
   const ended = today > end;
   const idle = lately.activityAt == null ? null : Math.floor((now - lately.activityAt) / DAY);
   const stalled = open > 0 && idle != null && idle >= STALL_DAYS;
   const pace = lately.issues;
   const finish = pace ? paceFinish(pace, now) : null;
   const late = finish === Infinity || (finish != null && utcDay(finish) > end);
   const health: RoadmapHealth =
      ended && open > 0 ? 'off_track' : late || stalled ? 'at_risk' : 'on_track';

   const merged = lately.merged
      ? `${n(lately.merged, 'PR')} merged in the ${LAST_14_DAYS}`
      : `No PRs merged in the ${LAST_14_DAYS}`;
   const stages = STAGES.filter(s => lately.open[s]).map(
      s => `${lately.open[s]} ${STAGE_WORDS[s].toLowerCase()}`
   );
   const prs = open
      ? `${merged}, and ${open} ${open === 1 ? 'is' : 'are'} open: ${andList(stages)}.`
      : `${merged}, and none are open.`;

   let left: string;
   if (ended) {
      const days = ((dayStart(today) as number) - (dayStart(end) as number)) / DAY;
      const weeks = Math.ceil(days / 7);
      left = `It’s ${pastEnd(weeks)}, ${dayWords(end)}.`;
   } else if (stalled) {
      left = `${noPrActivity(idle as number)}.`;
   } else if (pace && finish === Infinity) {
      const words = pace.closed === pace.added ? 'as fast as' : 'faster than';
      left = `Its issues arrive ${words} they close: ${pace.closed} closed and ${pace.added} added in four weeks.`;
   } else if (pace && finish != null) {
      const issues = `${n(pace.open, 'open issue')} ${pace.open === 1 ? 'is' : 'are'}`;
      left = `At this pace its ${issues} done around ${dayWords(utcDay(finish))}, ${
         late ? 'after' : 'by'
      } its ${dayWords(end)} end.`;
   } else if (pace?.open) {
      const issues = `${n(pace.open, 'issue')} ${pace.open === 1 ? 'is' : 'are'}`;
      left = `${issues} still open, and it ends ${dayWords(end)}.`;
   } else {
      left = `It ends ${dayWords(end)}.`;
   }
   return { health, body: `${prs} ${left}` };
}
