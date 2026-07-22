import { useMemo, type ReactNode } from 'react';
import type { DerivedPull } from '../model/status';
import {
   ageMix,
   authorLoad,
   crStarvation,
   effortMix,
   firstCrLatency,
   friction,
   mergedPerDay,
   mergeTimeBySize,
   reciprocity,
   repoBreakdown,
   reviewDebt,
   signoffLeaders,
   stampsPerDay,
   statusBreakdown,
} from '../model/stats';
import { fillMonthGaps, useStatsHistory, weeklyTimeInReview } from '../model/statsHistory';
import { useSettings } from '../settings';
import type { PullData } from '../types';
import { EmptyState, STATUS_DOT, STATUS_LABEL } from '../components/bits';
import { AgeMixCard } from './stats/AgeMixCard';
import { AuthorLoadCard } from './stats/AuthorLoadCard';
import { DebtCard } from './stats/DebtCard';
import { EffortMixCard } from './stats/EffortMixCard';
import { FrictionCard } from './stats/FrictionCard';
import { Leaderboard } from './stats/Leaderboard';
import { MergeSizeCard } from './stats/MergeSizeCard';
import { MonthlyThroughputCard } from './stats/MonthlyThroughputCard';
import { ReciprocityCard } from './stats/ReciprocityCard';
import { RepoLoadCard } from './stats/RepoLoadCard';
import { ShippingPulseCard } from './stats/ShippingPulseCard';
import { StarvationCard } from './stats/StarvationCard';
import { StatusBar } from './stats/StatusBar';
import { TimeInReviewCard } from './stats/TimeInReviewCard';

const WINDOW_DAYS = 14;

/** a labeled band of cards; the grid reflows within each band. */
function Group({ title, children }: { title: string; children: ReactNode }) {
   return (
      <section>
         <h2 className="sticky top-[var(--header-h,0px)] z-[5] m-0 bg-[var(--canvas)] pb-2.5 text-xs font-semibold tracking-wide text-ink-3 uppercase">
            {title}
         </h2>
         <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
            {children}
         </div>
      </section>
   );
}

/**
 * The Stats lens: the board's shape and its review economics at a glance, in
 * bands ordered most-actionable first — the board right now (what's open and
 * what it's owed), Flow (what the last two weeks produced), People (who's
 * carrying it), then Trends (the same shape over months, from a separate
 * history endpoint — hidden if that fetch hasn't landed, and last because a
 * multi-month retrospective is the least time-critical read). Everything but
 * Trends is a snapshot of the current pool (open PRs plus the 14-day closed
 * window the server keeps), so it moves with the scope and filter — scope to a
 * team and these become that team's numbers.
 */
export function Stats({
   pulls,
   closed,
   me,
   onPerson,
}: {
   pulls: DerivedPull[];
   closed: PullData[];
   me: string;
   onPerson: (login: string) => void;
}) {
   const breakdown = useMemo(
      () =>
         statusBreakdown(pulls).map(s => ({
            status: s.status,
            count: s.count,
            label: STATUS_LABEL[s.status],
            color: STATUS_DOT[s.status],
         })),
      [pulls]
   );
   // flow — the closed window plus stamp timestamps
   const perDay = useMemo(() => mergedPerDay(closed, WINDOW_DAYS, Date.now()), [closed]);
   const firstCr = useMemo(() => firstCrLatency(closed), [closed]);
   const pulse = useMemo(
      () => stampsPerDay(pulls, closed, WINDOW_DAYS, Date.now()),
      [pulls, closed]
   );
   const merge = useMemo(() => mergeTimeBySize(closed), [closed]);
   // the board right now
   const debt = useMemo(() => reviewDebt(pulls), [pulls]);
   const ages = useMemo(() => ageMix(pulls), [pulls]);
   const effort = useMemo(() => effortMix(pulls), [pulls]);
   const stuck = useMemo(() => friction(pulls), [pulls]);
   const authors = useMemo(() => authorLoad(pulls), [pulls]);
   const repos = useMemo(() => repoBreakdown(pulls), [pulls]);
   // people
   const crLeaders = useMemo(() => signoffLeaders(pulls, closed, 'CR'), [pulls, closed]);
   const qaLeaders = useMemo(() => signoffLeaders(pulls, closed, 'QA'), [pulls, closed]);
   const giveTake = useMemo(() => reciprocity(pulls, closed), [pulls, closed]);
   const starved = useMemo(() => crStarvation(pulls), [pulls]);
   const settings = useSettings();
   // the heaviest text tier follows the warn threshold automatically, same
   // derivation as app.tsx's rowOpts — see ageWarnDays in settings.ts
   const ageRotDays = Math.round(settings.ageWarnDays * 2.5);
   // trends — server-side history the live socket payload doesn't carry (it
   // only ships open pulls + 14 days of closed ones); null while loading or on
   // any fetch failure, which hides the whole band below.
   const history = useStatsHistory();
   const monthly = useMemo(() => (history ? fillMonthGaps(history.monthly) : []), [history]);
   const timeInReview = useMemo(
      () =>
         history
            ? weeklyTimeInReview(
                 history.firstCrByMonth,
                 history.durationByWeek,
                 history.mergeAgeByDay
              )
            : [],
      [history]
   );

   if (!pulls.length && !closed.length) {
      return (
         <EmptyState
            title="No data yet"
            sub="Nothing open or recently closed matching your filters."
         />
      );
   }

   return (
      <div className="flex flex-col gap-6">
         <StatusBar items={breakdown} total={pulls.length} />
         <Group title="The board right now">
            <DebtCard debt={debt} />
            <FrictionCard friction={stuck} />
            <AgeMixCard buckets={ages} warnDays={settings.ageWarnDays} rotDays={ageRotDays} />
            <EffortMixCard mix={effort} />
            <AuthorLoadCard rows={authors} me={me} onPerson={onPerson} />
            <RepoLoadCard rows={repos} />
         </Group>
         <Group title="Flow · last 14 days">
            <ShippingPulseCard perDay={perDay} pulse={pulse} firstCr={firstCr} />
            <MergeSizeCard buckets={merge.buckets} sampled={merge.sampled} merged={merge.merged} />
         </Group>
         <Group title="People">
            <StarvationCard
               rows={starved}
               me={me}
               onPerson={onPerson}
               warnDays={settings.ageWarnDays}
               rotDays={ageRotDays}
            />
            <ReciprocityCard rows={giveTake} me={me} onPerson={onPerson} />
            <Leaderboard
               title="CR leaderboard"
               sub="PRs CR’d, on the board"
               accent="var(--brand)"
               rows={crLeaders}
               me={me}
               onPerson={onPerson}
            />
            <Leaderboard
               title="QA leaderboard"
               sub="PRs QA’d, on the board"
               accent="var(--violet)"
               rows={qaLeaders}
               me={me}
               onPerson={onPerson}
            />
         </Group>
         {history && (
            <Group title="Trends">
               <TimeInReviewCard weeks={timeInReview} />
               <MonthlyThroughputCard monthly={monthly} />
            </Group>
         )}
      </div>
   );
}
