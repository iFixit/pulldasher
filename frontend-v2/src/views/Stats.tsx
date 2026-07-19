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
import { PulseCard } from './stats/PulseCard';
import { ReciprocityCard } from './stats/ReciprocityCard';
import { RepoLoadCard } from './stats/RepoLoadCard';
import { StarvationCard } from './stats/StarvationCard';
import { StatusBar } from './stats/StatusBar';
import { ThroughputCard } from './stats/ThroughputCard';

const WINDOW_DAYS = 14;

/** a labeled band of cards; the grid reflows within each band. */
function Group({ title, children }: { title: string; children: ReactNode }) {
   return (
      <section>
         <h2 className="m-0 mb-2.5 text-xs font-semibold tracking-wide text-ink-3 uppercase">
            {title}
         </h2>
         <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
            {children}
         </div>
      </section>
   );
}

/**
 * The Stats lens: the board's shape and its review economics at a glance,
 * in three bands — Flow (what the last two weeks produced), the board right
 * now (what's open and what it's owed), and People (who's carrying it).
 * Everything is a snapshot of the current pool (open PRs plus the 14-day
 * closed window the server keeps), so it moves with the scope and filter —
 * scope to a team and these become that team's numbers.
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

   if (!pulls.length && !closed.length) {
      return (
         <EmptyState title="No data yet" sub="Nothing open or recently shipped in this scope." />
      );
   }

   return (
      <div className="flex flex-col gap-6">
         <StatusBar items={breakdown} total={pulls.length} />
         <Group title="Flow · last 14 days">
            <ThroughputCard perDay={perDay} firstCr={firstCr} />
            <PulseCard perDay={pulse} />
            <MergeSizeCard buckets={merge.buckets} sampled={merge.sampled} merged={merge.merged} />
         </Group>
         <Group title="The board right now">
            <DebtCard debt={debt} />
            <AgeMixCard
               buckets={ages}
               warnDays={settings.ageWarnDays}
               rotDays={settings.ageRotDays}
            />
            <EffortMixCard mix={effort} />
            <FrictionCard friction={stuck} />
            <AuthorLoadCard rows={authors} me={me} onPerson={onPerson} />
            <RepoLoadCard rows={repos} />
         </Group>
         <Group title="People">
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
            <ReciprocityCard rows={giveTake} me={me} onPerson={onPerson} />
            <StarvationCard
               rows={starved}
               me={me}
               onPerson={onPerson}
               warnDays={settings.ageWarnDays}
               rotDays={settings.ageRotDays}
            />
         </Group>
      </div>
   );
}
