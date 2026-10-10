import { useMemo } from 'react';
import type { DerivedPull } from '../../../shared/model/status';
import { rowWord } from '../model/actions';
import type { PullData } from '../../../shared/types';
import { n, pullKey } from '../../../shared/format';
import { closedIssues, decideProjects, decideQueue } from '../../../shared/model/decide';
import { buildToday } from '../../../shared/model/projects';
import { dayOf } from '../model/days';
import {
   isYours,
   portfolioItems,
   stageWord,
   withCalls,
   type PortfolioItem,
} from '../model/portfolio';
import {
   DEFAULT_RANGE,
   ongoingSlugs,
   resolveRange,
   teamLookup,
   useProjectsData,
   type Range,
} from '../model/projectData';
import { useRoadmap } from '../model/roadmapData';
import { useWorkData } from '../model/workData';
import { LAST_14_DAYS } from '../model/words';
import { claimFor } from '../model/reviewers';
import { EmptyState } from '../components/bits';
import { Fold, Lane, laneShown, RestGroup, Truncated } from '../components/Lane';
import type { RowOptions } from '../components/Row';
import { WordGroupRows } from '../components/WordGroups';
import { ClosedRow } from '../components/ClosedRow';

/**
 * The author's tab: only PRs you own, split by whose move it is. The old
 * "Your PRs" lane mixed both answers; here "do this next" and "nudge this
 * person" never share a section. The split runs on the SAME rowWord the
 * word-group sub-headers render — lane and header can't disagree (splitting
 * on authorMove once put a brand "Chase CR" header inside "Waiting on
 * others", because the two models diverge on edge cases like external
 * blocks). Under self-review your own CR and QA stamps are Your move too,
 * unless you asked someone: then the PR waits on them, and a request nobody
 * answers in 4 hours comes back as a nudge. Under them, your projects, in
 * the Projects tab's own words.
 */

export function MyWork({
   pulls,
   closed,
   opts,
   prefix,
   allPulls,
   allClosed,
}: {
   pulls: DerivedPull[];
   closed: PullData[];
   opts: RowOptions;
   /** the project label prefix; null when the server isn't set up for projects */
   prefix: string | null;
   /** every person's open and recently closed PRs, whatever the filters
    * narrow, as every Projects view counts them */
   allPulls: DerivedPull[];
   allClosed: PullData[];
}) {
   const me = opts.me;
   // your self-reviewed rows say when the diff is worth asking someone about
   const rowOpts = { ...opts, askHint: true };
   const mine = pulls.filter(p => p.data.user.login === me);
   const byUrgency = (a: DerivedPull, b: DerivedPull) => b.ageDays - a.ageDays;
   const kindOf = (p: DerivedPull) => rowWord(p, me, { claim: claimFor(p.data) }).kind;
   const move = mine.filter(p => kindOf(p) === 'do').sort(byUrgency);
   const waiting = mine.filter(p => kindOf(p) !== 'do').sort(byUrgency);
   const shipped = closed.filter(p => p.user.login === me);
   // a project you lead is yours with no PR of your own open
   const projects = prefix && (
      <YourProjects
         me={me}
         prefix={prefix}
         allPulls={allPulls}
         allClosed={allClosed}
         onProject={opts.onProject}
         lanesClear={!move.length && !waiting.length}
      />
   );

   if (!mine.length && !shipped.length) {
      return (
         <>
            <EmptyState
               title="Nothing of yours is open"
               sub="Everything you authored is merged or closed."
            />
            {projects && <RestGroup>{projects}</RestGroup>}
         </>
      );
   }

   return (
      <>
         <Lane title="Your move" pulls={[]} count={move.length} opts={opts}>
            <WordGroupRows pulls={move} opts={rowOpts} id="mine:move" cap={laneShown(12, opts)} />
            {!move.length && (
               <div className="px-3.5 py-3 text-[13px] text-ink-3">
                  Nothing needs you right now.
               </div>
            )}
         </Lane>
         <Lane title="Waiting on others" pulls={[]} count={waiting.length} opts={opts}>
            <WordGroupRows
               pulls={waiting}
               opts={rowOpts}
               id="mine:waiting"
               cap={laneShown(12, opts)}
            />
            {!waiting.length && (
               <div className="px-3.5 py-3 text-[13px] text-ink-3">
                  Nothing is waiting on anyone else.
               </div>
            )}
         </Lane>
         <RestGroup>
            {projects}
            <Fold
               count={shipped.length}
               label="Recently closed"
               gloss="Merged or closed in the last 14 days."
               id="mine:shipped"
               // both lanes above are clear and shipped has something to
               // show: "look what got done" is exactly the content the
               // all-clear day deserves, not another closed triangle
               defaultOpen={!move.length && !waiting.length}
            >
               <Truncated cap={laneShown(30, opts)} id="mine:shipped-rows">
                  {shipped.map(p => (
                     <ClosedRow key={pullKey(p)} pull={p} lastSeen={opts.lastSeen} />
                  ))}
               </Truncated>
            </Fold>
         </RestGroup>
      </>
   );
}

/** A project of yours in My work: the Projects tab's item, and whether its
 * word is a call that's yours. */
interface YourProject {
   item: PortfolioItem;
   /** its word names a call its lead owes, and you lead it */
   owed: boolean;
}

/**
 * Your projects as the Projects tab reads them (portfolio.ts isYours, the
 * Overview's Yours): the projects you lead or have a PR in, open or merged
 * in the last 14 days, each with its Plan column's word. Null until the
 * projects and the roadmap load.
 */
function useYourProjects(
   me: string,
   prefix: string,
   allPulls: DerivedPull[],
   allClosed: PullData[]
): YourProject[] | null {
   // the window the Projects tab opens on, so one fetch serves both
   const data = useProjectsData(resolveRange(DEFAULT_RANGE) as Range);
   const { items: plans } = useRoadmap();
   const work = useWorkData(plans);
   return useMemo(() => {
      if (!data || !plans) return null;
      const now = Date.now();
      const today = buildToday(
         data.projects,
         allPulls,
         allClosed,
         prefix,
         now / 1000,
         data.pull_links
      );
      const ongoing = ongoingSlugs(data);
      // Decide's questions, asked as decideRows asks them
      // (views/projects/Decide.tsx), so each word names the call Decide puts first
      const asked = decideQueue({
         live: decideProjects(today),
         items: plans,
         closed: closedIssues(data.projects),
         planCounts: new Map(
            [...(work?.plans ?? [])].map(([id, w]) => [
               id,
               {
                  openPulls: w.openPulls,
                  afterEnd: w.afterEnd.length,
                  afterDone: w.afterDone.length,
               },
            ])
         ),
         issues: work?.projects,
         ongoing,
         today: dayOf(new Date(now)),
         now: now / 1000,
      });
      const items = withCalls(
         portfolioItems(
            data.projects,
            today,
            {},
            teamLookup(data.teams),
            now,
            plans,
            work?.projects ?? null,
            ongoing
         ),
         asked,
         now
      );
      return (
         items
            .filter(item => isYours(item, me))
            .map(item => ({
               item,
               owed: item.planCell.warn && item.lead?.toLowerCase() === me.toLowerCase(),
            }))
            // a call that's yours first, then where the most is open
            .sort(
               (a, b) =>
                  Number(b.owed) - Number(a.owed) ||
                  b.item.open - a.item.open ||
                  a.item.name.localeCompare(b.item.name)
            )
      );
   }, [data, plans, work, allPulls, allClosed, prefix, me]);
}

/**
 * The fold under your PRs: one line per project of yours, its name, its one
 * word (amber only when the call is yours: an update you owe as its lead, a
 * question Decide asks of a plan you lead) and its open PRs, each opening
 * the project's page on the Projects tab. It rests closed like the board's
 * other folds, and opens on its own when it holds a call of yours or your
 * lanes are clear.
 */
function YourProjects({
   me,
   prefix,
   allPulls,
   allClosed,
   onProject,
   lanesClear,
}: {
   me: string;
   prefix: string;
   allPulls: DerivedPull[];
   allClosed: PullData[];
   onProject?: (slug: string) => void;
   lanesClear: boolean;
}) {
   const yours = useYourProjects(me, prefix, allPulls, allClosed);
   if (!yours) return null;
   return (
      <Fold
         count={yours.length}
         label="Your projects"
         gloss={`Projects you lead, or have a PR in that’s open or merged in the ${LAST_14_DAYS}. Each opens its page on the Projects tab.`}
         id="mine:projects"
         defaultOpen={lanesClear || yours.some(y => y.owed)}
      >
         {yours.map(({ item, owed }) => (
            <button
               key={item.slug}
               type="button"
               onClick={() => onProject?.(item.slug)}
               className="pressable flex w-full flex-wrap items-baseline gap-x-1.5 border-t border-secondary px-3.5 py-2 text-left text-[13px] first:border-t-0 hover:bg-muted"
            >
               {/* the name reads as the door it is, as a fact link does */}
               <span className="font-medium text-ink underline decoration-line underline-offset-2">
                  {item.name}
               </span>
               {/* each fact keeps its dot when the line wraps on a phone; the
                   word is its Plan column's, or where it stands, as its
                   page's head says, when the plan has nothing to say */}
               <span className={`whitespace-nowrap ${owed ? 'text-warn' : 'text-ink-2'}`}>
                  <span aria-hidden className="text-ink-3">
                     ·{' '}
                  </span>
                  {item.planCell.text || stageWord(item)}
               </span>
               {item.open > 0 && (
                  <span className="whitespace-nowrap text-ink-3 tabular-nums">
                     <span aria-hidden>· </span>
                     {n(item.open, 'open PR')}
                  </span>
               )}
            </button>
         ))}
      </Fold>
   );
}
