import type { ReactNode } from 'react';
import { n } from '../../../../shared/format';
import type { WindowCounts } from '../../../../shared/model/projects';
import { LoadFailed } from '../../components/bits';
import { GroupHeader } from '../../components/Lane';
import {
   chartWindow,
   dayWords,
   previousRange,
   rangeDays,
   rangeWords,
   refreshProjectsData,
   useProjectsData,
   type Range,
} from '../../model/projectData';
import { beforeWords, mergeSpeed } from '../../model/retro';
import { durationWords } from '../../model/stage';
import { StatsCard } from '../stats/parts';
import { ChartSlot, FlowWeeksChart, OpenPrsChart } from './lazyCharts';
import { versus } from './parts';

/** a project's numbers for days it had no PRs in */
const NONE: WindowCounts = {
   backlog_start: 0,
   backlog_end: 0,
   opened: 0,
   merged: 0,
   closed: 0,
   median_age_start_days: null,
   median_age_end_days: null,
   median_days_to_merge: null,
   developers: 0,
   non_developers: 0,
};

/**
 * The range's PRs in one sentence, each count against the same number of
 * days just before: "Sep 2 to Oct 1: 47 PRs opened (4 more than the 30 days
 * before), 16 merged (2 fewer), half of them within about 7 hours of
 * opening, and none closed without merging." Then how old the open ones
 * were, in the same words for a time.
 */
function rangeSentence(w: WindowCounts, prev: WindowCounts | undefined, range: Range): string {
   // the first comparison says against what; the second, only how far
   const first = prev ? ` (${versus(w.opened, prev.opened, beforeWords(rangeDays(range)))})` : '';
   const d = prev ? w.merged - prev.merged : 0;
   const second = prev ? ` (${d > 0 ? `${d} more` : d < 0 ? `${-d} fewer` : 'the same'})` : '';
   const speed = mergeSpeed(w.merged, w.median_days_to_merge);
   const flow = `${rangeWords(range)}: ${w.opened ? n(w.opened, 'PR') : 'no PRs'} opened${first}, ${
      w.merged || 'none'
   } merged${second}${speed ? `, ${speed},` : ''} and ${
      w.closed || 'none'
   } closed without merging.`;
   if (w.median_age_end_days == null) return flow;
   return w.median_age_start_days != null
      ? `${flow} The open PRs’ median age went from ${durationWords(
           w.median_age_start_days
        )} to ${durationWords(w.median_age_end_days)}.`
      : `${flow} The open PRs’ median age ended at ${durationWords(w.median_age_end_days)}.`;
}

/**
 * Is the backlog growing: the PRs open at the end of each day, and what
 * arrived and what merged each week, over at least 90 days ending on the
 * range's last day with the days before the range paler, then the range's
 * numbers in one sentence under the charts. Every PR, or one project's (by
 * its label) with `slug`. Look back and a project's page both show it, so
 * the question reads the same wherever it's asked.
 */
export function BacklogSection({
   range,
   slug = null,
   title,
   id,
   headerExtra,
   everyone = false,
}: {
   range: Range;
   /** one project's PRs; every PR without */
   slug?: string | null;
   /** "Is the backlog growing?", or "Is its backlog growing?" on a project's page */
   title: string;
   id?: string;
   /** the header's right end: a project page's range picker */
   headerExtra?: ReactNode;
   /** the page around it counts only some people's days: say this counts every PR */
   everyone?: boolean;
}) {
   const shown = chartWindow(range);
   const flow = useProjectsData(shown, slug);
   // the range's own numbers, whose weeks split the week the range starts in
   const now = useProjectsData(range, slug);
   // the days before come unscoped, as the tab already holds them; a
   // project's numbers are in them by its slug
   const prev = useProjectsData(previousRange(range));
   const before = prev
      ? slug
         ? prev.window.projects[slug] ?? NONE
         : prev.window.totals
      : undefined;
   // nothing open on any day and nothing opened: one line, not two empty charts
   const empty =
      !!flow &&
      !flow.window.days.some(day => day.backlog > 0) &&
      !flow.window.weeks.some(w => w.opened.developers + w.opened.non_developers > 0);
   return (
      <section id={id} className="scroll-mt-[var(--header-h,0px)]">
         <GroupHeader
            level={3}
            title={title}
            sub={`${everyone ? 'Everyone’s PRs, ' : ''}${rangeWords(shown)}${
               shown.start < range.start ? `, paler before ${dayWords(range.start)}` : ''
            }`}
            headerExtra={headerExtra}
         />
         <StatsCard>
            {flow === null ? (
               <LoadFailed what="the charts" onRetry={refreshProjectsData} />
            ) : empty ? (
               <p className="m-0 max-w-[70ch] text-[13px] text-ink-3">
                  No PRs were open, opened or merged from {rangeWords(shown)}.
               </p>
            ) : (
               <div className="flex flex-col gap-4">
                  <ChartSlot height={200}>
                     {flow && <OpenPrsChart days={flow.window.days} picked={range} />}
                  </ChartSlot>
                  <ChartSlot height={190}>
                     {/* waits for the range's weeks too, so its first week
                         doesn't redraw from whole to split */}
                     {flow && now !== undefined && (
                        <FlowWeeksChart
                           weeks={flow.window.weeks}
                           rangeWeeks={now?.window.weeks}
                           picked={range}
                           shown={flow.window}
                        />
                     )}
                  </ChartSlot>
                  {now && (
                     <p className="m-0 max-w-[70ch] text-[13px] text-ink-2">
                        {rangeSentence(now.window.totals, before, range)}
                     </p>
                  )}
               </div>
            )}
         </StatsCard>
      </section>
   );
}
