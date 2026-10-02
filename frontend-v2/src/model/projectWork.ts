import { useEffect, useState } from 'react';
import { isDummy } from '../backend/dummy';
import { DUMMY_ATTACHED, DUMMY_ISSUES, DUMMY_PROJECTS } from '../backend/dummyProjects';
import type { RoadmapItem } from '../../../shared/model/roadmap';
import {
   issueKey,
   issueQuery,
   projectWork,
   type IssueHit,
   type IssueRef,
   type ProjectWork,
} from '../../../shared/model/work';
import { refreshProjectsData } from './projectData';
import { dummyRows, dummyWorkInputs, saveDummyRows, workVersion } from './workData';

/**
 * A project's page and the issue search: GET /project-work and
 * /issue-search on a real board, which read GitHub through the server's
 * token; the dummy board answers from its fixtures. Adding an issue by hand
 * or taking one off loads the work and the page again.
 */

/** Every issue the dummy board's search can find, once each: an issue in
 * two projects is in two lists. */
function dummyCorpus(): IssueHit[] {
   const attached = Object.values(DUMMY_ATTACHED)
      .flat()
      .map(issue => ({
         ...issue.ref,
         title: issue.title,
         state: issue.state,
         author: issue.author,
         createdAt: issue.createdAt,
         closedAt: issue.closedAt,
      }));
   return [...new Map([...attached, ...DUMMY_ISSUES].map(hit => [issueKey(hit), hit])).values()];
}

/** What the dummy board's search finds: the way the server's does, from
 * its fixtures (lib/work.js searchIssues), each hit with its projects. */
function dummySearch(text: string): IssueHit[] {
   const q = issueQuery(text);
   if (!q) return [];
   const all = dummyCorpus();
   let hits: IssueHit[];
   if (q.kind === 'ref') hits = all.filter(hit => issueKey(hit) === issueKey(q.ref));
   else if (q.kind === 'number') hits = all.filter(hit => hit.number === q.number);
   else {
      const words = q.words.toLowerCase().split(/\s+/);
      hits = all.filter(hit => words.every(w => hit.title.toLowerCase().includes(w))).slice(0, 10);
   }
   // the fixtures' labeled issues and the ones added by hand or by a link
   // now, never one taken off
   const lists = [
      ...Object.entries(DUMMY_ATTACHED).map(([slug, list]) => ({
         slug,
         refs: list.filter(i => i.via.includes('label')).map(i => i.ref),
      })),
      ...[...dummyRows].map(([slug, rows]) => ({
         slug,
         refs: rows.filter(row => row.removedAt == null).map(row => row.ref),
      })),
   ];
   return hits.map(hit => ({
      ...hit,
      projects: [
         ...new Set(
            lists
               .filter(({ refs }) => refs.some(ref => issueKey(ref) === issueKey(hit)))
               .map(({ slug }) => slug)
         ),
      ],
   }));
}

const SIGNED_OUT = 'Your sign-in expired. Reload the page to sign in again.';

/** Issues to pick from for what someone typed (shared/model/work.ts
 * issueQuery); an error says why GitHub couldn't be searched. */
export async function searchIssues(text: string): Promise<IssueHit[] | { error: string }> {
   if (isDummy()) return dummySearch(text);
   const res = await fetch(`/issue-search?q=${encodeURIComponent(text)}`).catch(() => null);
   if (!res || res.redirected || res.status === 401) return { error: SIGNED_OUT };
   if (!res.ok) return { error: 'Couldn’t search GitHub. Try again in a minute.' };
   return ((await res.json()) as { issues: IssueHit[] }).issues;
}

/**
 * A project's page (shared/model/work.ts projectWork): undefined while it
 * loads, null if that failed. The dummy board builds it from the plans.
 */
export function useProjectWork(
   slug: string,
   plans: readonly RoadmapItem[] | null
): ProjectWork | null | undefined {
   const [got, setGot] = useState<{ slug: string; work: ProjectWork | null }>();
   const { n: version } = workVersion.useValue();
   const dummyPlans = isDummy() ? plans : null;
   useEffect(() => {
      if (isDummy() && !dummyPlans) return;
      let live = true;
      const load = isDummy()
         ? dummyWorkInputs(dummyPlans ?? []).then(inputs => projectWork(inputs, slug))
         : fetch(`/project-work?project=${encodeURIComponent(slug)}`)
              .then(r => (r.ok ? (r.json() as Promise<ProjectWork>) : null))
              .catch(() => null);
      void load.then(work => {
         if (live) setGot({ slug, work });
      });
      return () => {
         live = false;
      };
   }, [slug, version, dummyPlans]);
   return got?.slug === slug ? got.work : undefined;
}

/** Load every project page again: the way back from one that failed. */
export function reloadProjectWork(): void {
   workVersion.set({ n: workVersion.get().n + 1 });
}

/** Add an issue to a project by hand (or put back one taken off), or take
 * one added by hand or by a link off it, for good: its row stays, so a link
 * never brings it back. `forget` takes back an add instead (its Undo), as
 * if it was never added, so a suggestion goes back to being one: only for
 * an add that said it `inserted` its row, so an Undo never forgets a
 * Remove made before the add. */
export async function changeProjectIssue(
   slug: string,
   ref: IssueRef,
   add: boolean,
   { forget = false } = {}
): Promise<{ ok: true; inserted?: boolean } | { error: string }> {
   if (isDummy()) {
      const rows = dummyRows.get(slug) ?? [];
      const row = rows.find(r => issueKey(r.ref) === issueKey(ref));
      const hit = dummyCorpus().find(h => issueKey(h) === issueKey(ref));
      const now = Math.floor(Date.now() / 1000);
      if (add && DUMMY_PROJECTS.some(p => issueKey(p) === issueKey(ref))) {
         return {
            error: 'That’s a project’s own issue: it names the project, so it isn’t one of its issues.',
         };
      }
      if (add && !row && !hit) return { error: 'GitHub has no issue by that name.' };
      // the server's table: added again, a row comes back as it was
      if (row && forget) {
         dummyRows.set(
            slug,
            rows.filter(r => r !== row)
         );
      } else if (row) {
         row.removedAt = add ? null : row.removedAt ?? now;
      } else if (add && hit) {
         dummyRows.set(slug, [
            ...rows,
            {
               ref: { repo: hit.repo, number: hit.number },
               title: hit.title,
               state: hit.state,
               closedAt: hit.closedAt ?? null,
               author: hit.author,
               createdAt: hit.createdAt,
               via: ['hand'],
               attachedAt: now,
               addedBy: 'you',
               removedAt: null,
            },
         ]);
      }
      saveDummyRows();
      reloadProjectWork();
      // which project each PR is in can change with it, on every view
      refreshProjectsData();
      // as the server says it: an add with no row before put one in
      return add ? { ok: true, inserted: !row } : { ok: true };
   }
   const res = await (add
      ? fetch('/project-issues', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ project: slug, issue: ref }),
        })
      : fetch(
           `/project-issues?${new URLSearchParams({
              project: slug,
              repo: ref.repo,
              number: String(ref.number),
              ...(forget ? { forget: '1' } : {}),
           })}`,
           { method: 'DELETE' }
        )
   ).catch(() => null);
   if (!res || res.redirected || res.status === 401) return { error: SIGNED_OUT };
   if (!res.ok) {
      // the server's reasons for a 404 or 409 read well; a 500's doesn't
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return {
         error: res.status < 500 && json.error ? json.error : 'Couldn’t save that.',
      };
   }
   reloadProjectWork();
   if (!add) return { ok: true };
   const json = (await res.json().catch(() => ({}))) as { inserted?: boolean };
   return { ok: true, inserted: json.inserted };
}
