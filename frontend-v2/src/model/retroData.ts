import { useEffect, useState } from 'react';
import { isDummy, loadDummy } from '../backend/dummy';
import { DUMMY_TEAMS } from '../backend/dummyProjects';
import { epoch } from '../../../shared/format';
import { dayStart, projectOf } from '../../../shared/model/projects';
import { timeSpent, type TimeRow, type Touch } from '../../../shared/model/retro';
import { isSuffixBot } from '../../../shared/model/visibility';
import { teamLookup, type Range } from './projectData';

/** GET /retro-data: where people's days went in a range (shared/model/retro.ts). */
export interface RetroData {
   start: string;
   end: string;
   /** whose time: developers when there are teams, else everyone */
   counted: 'developers' | 'everyone';
   rows: (TimeRow & { project: string | null })[];
}

/** The dummy board's answer, from its fixture PRs: opened, merged and stamped. */
async function dummyRetro({ start, end }: Range): Promise<RetroData> {
   const { pulls, projectLabelPrefix } = await loadDummy();
   const prefix = projectLabelPrefix ?? 'project:';
   const from = dayStart(start) ?? 0;
   const to = (dayStart(end) ?? from) + 86400;
   const touches: Touch[] = pulls.flatMap(p => {
      const on = { repo: p.repo, number: p.number, owner: p.user.login };
      return [
         { login: p.user.login, at: epoch(p.created_at), ...on },
         ...(p.merged_at ? [{ login: p.user.login, at: epoch(p.merged_at), ...on }] : []),
         ...[...p.status.allCR, ...p.status.allQA].map(sig => ({
            login: sig.data.user.login,
            at: epoch(sig.data.created_at),
            ...on,
         })),
      ].filter(t => t.at >= from && t.at < to);
   });
   const teamOf = teamLookup(DUMMY_TEAMS);
   const labels = new Map(pulls.map(p => [`${p.repo}#${p.number}`, p.labels]));
   return {
      start,
      end,
      counted: 'developers',
      rows: timeSpent(touches, login => !isSuffixBot(login) && teamOf(login) != null).map(row => ({
         ...row,
         project: projectOf(labels.get(`${row.repo}#${row.number}`) ?? [], prefix),
      })),
   };
}

// one fetch per range, reused for 5 minutes, as with /projects-data
const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; data: Promise<RetroData | null> }>();

function load(range: Range): Promise<RetroData | null> {
   if (isDummy()) return dummyRetro(range);
   const query = new URLSearchParams({ start: range.start, end: range.end });
   return fetch(`/retro-data?${query}`)
      .then(r => (r.ok ? (r.json() as Promise<RetroData>) : null))
      .catch(() => null);
}

/** A range's time spent: undefined while it loads, null if the fetch failed. */
export function useRetroData(range: Range): RetroData | null | undefined {
   const key = `${range.start}..${range.end}`;
   const [got, setGot] = useState<{ key: string; data: RetroData | null }>();
   useEffect(() => {
      let hit = cache.get(key);
      if (!hit || Date.now() - hit.at > TTL_MS) {
         hit = { at: Date.now(), data: load(range) };
         cache.set(key, hit);
      }
      let live = true;
      hit.data.then(data => {
         if (data == null) cache.delete(key);
         if (live) setGot({ key, data });
      });
      return () => {
         live = false;
      };
      // keyed on the days, not the range object, which callers rebuild
      // every render
   }, [key]);
   return got && got.key === key ? got.data : undefined;
}
