import { useMemo } from 'react';
import type { Today } from '../../../../shared/model/projects';
import { resolveRange, type Range } from '../../model/projectData';
import {
   loadByPerson,
   median,
   overloadLine,
   retroRows,
   type PersonLoad,
   type RetroRow,
} from '../../model/retro';
import { useRetroData } from '../../model/retroData';

/** the Overview's window, in days: it's about now */
const WHO_DAYS = 14;

export interface WhoRow extends PersonLoad {
   team: string | null;
   /** their open PRs now, drafts included */
   open: number;
   /** their filed projects, each with the Monday of the last week they had
    * days on it */
   projects: (PersonLoad['projects'][number] & { last: string | null })[];
}

/** The Monday of each person's last week with days on each project, keyed
 * by lowercase login and slug ("login slug"). The days come by the week, so
 * the week is as close as it gets to their last day there. */
export function lastWeeks(
   rows: readonly RetroRow[],
   weeks: readonly string[]
): Map<string, string> {
   const last = new Map<string, string>();
   for (const r of rows) {
      const key = `${r.login.toLowerCase()} ${r.pr.project}`;
      const week = weeks[r.week];
      if (r.pr.project != null && r.days > 0 && week > (last.get(key) ?? '')) last.set(key, week);
   }
   return last;
}

/**
 * Who is on what: the days' rows, one load per developer (every developer
 * on a team, spelled the way their PRs spell them; with no teams, everyone
 * with days), and the overload line with the median it comes from. Over the
 * last 14 days for the Overview's tile, or over `range` for People, where
 * every column follows the picked range; People draws the table. `who` is
 * undefined while the days load, and null when they failed.
 */
export function useWhoIsOnWhat(
   teams: Record<string, string[]> | undefined,
   today: Today,
   teamOf: (login: string) => string | null,
   range?: Range
): {
   rows: RetroRow[] | null;
   who: WhoRow[] | null | undefined;
   line: number;
   middle: number;
} {
   const retro = useRetroData(range ?? (resolveRange(`${WHO_DAYS}d`) as Range));
   const rows = useMemo(() => (retro ? retroRows(retro) : null), [retro]);
   const who = useMemo((): WhoRow[] | null | undefined => {
      if (retro === null) return null;
      if (!retro || !rows) return undefined;
      const spelled = new Map(retro.people.map(l => [l.toLowerCase(), l]));
      const onTeams = Object.values(teams ?? {}).flat();
      const logins = onTeams.length
         ? onTeams.map(l => spelled.get(l.toLowerCase()) ?? l)
         : retro.people;
      const unique = [...new Map(logins.map(l => [l.toLowerCase(), l])).values()];
      const openBy = new Map<string, number>();
      for (const p of [...today.live.flatMap(g => g.open), ...today.misc, ...today.unsorted]) {
         const key = p.data.user.login.toLowerCase();
         openBy.set(key, (openBy.get(key) ?? 0) + 1);
      }
      const last = lastWeeks(rows, retro.weeks);
      return loadByPerson(rows, unique).map(load => ({
         ...load,
         team: teamOf(load.login),
         open: openBy.get(load.login.toLowerCase()) ?? 0,
         projects: load.projects.map(p => ({
            ...p,
            last: last.get(`${load.login.toLowerCase()} ${p.slug}`) ?? null,
         })),
      }));
   }, [retro, rows, teams, today, teamOf]);
   const counts = who?.map(r => r.projects.length) ?? [];
   return { rows, who, line: overloadLine(counts), middle: median(counts) };
}
