import { useMemo } from 'react';
import type { DerivedPull } from '../model/status';
import { crStarvation, mergeTimeBySize, signoffLeaders, statusBreakdown } from '../model/stats';
import { useSettings } from '../settings';
import type { PullData } from '../types';
import { EmptyState, STATUS_DOT, STATUS_LABEL } from '../components/bits';
import { Leaderboard } from './stats/Leaderboard';
import { MergeSizeCard } from './stats/MergeSizeCard';
import { StarvationCard } from './stats/StarvationCard';
import { StatusBar } from './stats/StatusBar';

/**
 * The Stats lens: the board's shape and its review economics at a glance.
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
   const crLeaders = useMemo(() => signoffLeaders(pulls, closed, 'CR'), [pulls, closed]);
   const qaLeaders = useMemo(() => signoffLeaders(pulls, closed, 'QA'), [pulls, closed]);
   const starved = useMemo(() => crStarvation(pulls), [pulls]);
   const merge = useMemo(() => mergeTimeBySize(closed), [closed]);
   const settings = useSettings();

   if (!pulls.length && !closed.length) {
      return (
         <EmptyState title="No data yet" sub="Nothing open or recently shipped in this scope." />
      );
   }

   return (
      <div className="flex flex-col gap-5">
         <StatusBar items={breakdown} total={pulls.length} />
         <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
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
            <StarvationCard
               rows={starved}
               me={me}
               onPerson={onPerson}
               warnDays={settings.ageWarnDays}
               rotDays={settings.ageRotDays}
            />
            <MergeSizeCard buckets={merge.buckets} sampled={merge.sampled} merged={merge.merged} />
         </div>
      </div>
   );
}
