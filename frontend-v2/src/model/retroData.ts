import { useEffect, useState } from 'react';
import { isDummy, loadDummy } from '../backend/dummy';
import { DUMMY_TEAMS } from '../backend/dummyProjects';
import { epoch } from '../../../shared/format';
import { dayStart, projectOf } from '../../../shared/model/projects';
import { timeSpent, type Touch } from '../../../shared/model/retro';
import { isSuffixBot } from '../../../shared/model/visibility';
import { teamLookup, type Range } from './projectData';

/** A PR someone spent days on, as GET /retro-data lists it. */
export interface RetroPr {
   repo: string;
   number: number;
   title: string;
   owner: string;
   bot: boolean;
   project: string | null;
   state: 'open' | 'closed';
   /** epoch secs; null when not merged */
   merged: number | null;
}

/** GET /retro-data: where people's days went in a range, week by week
 * (lib/projects.js loadTimeSpent). Rows point into the lists by index. */
export interface RetroData {
   start: string;
   end: string;
   /** whose time: developers when there are teams, else everyone */
   counted: 'developers' | 'everyone';
   /** the Mondays of the weeks with any days, oldest first */
   weeks: string[];
   people: string[];
   prs: RetroPr[];
   /** [person, pr, week, days] */
   rows: [number, number, number, number][];
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
   const rows = timeSpent(touches, login => !isSuffixBot(login) && teamOf(login) != null);
   const byKey = new Map(pulls.map(p => [`${p.repo}#${p.number}`, p]));
   const people = [...new Set(rows.map(r => r.login))].sort();
   const weeks = [...new Set(rows.map(r => r.week))].sort();
   const prKeys = [...new Set(rows.map(r => `${r.repo}#${r.number}`))];
   return {
      start,
      end,
      counted: 'developers',
      weeks,
      people,
      prs: prKeys.map(key => {
         const p = byKey.get(key) as typeof pulls[number];
         return {
            repo: p.repo,
            number: p.number,
            title: p.title,
            owner: p.user.login,
            bot: isSuffixBot(p.user.login),
            project: projectOf(p.labels, prefix),
            state: p.state === 'open' ? 'open' : 'closed',
            merged: p.merged_at ? epoch(p.merged_at) : null,
         };
      }),
      rows: rows.map(r => [
         people.indexOf(r.login),
         prKeys.indexOf(`${r.repo}#${r.number}`),
         weeks.indexOf(r.week),
         Math.round(r.days * 100) / 100,
      ]),
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
