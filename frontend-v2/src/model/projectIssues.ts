import { useEffect, useState } from 'react';
import { isDummy } from '../backend/dummy';
import { DUMMY_ISSUES, DUMMY_SPECS } from '../backend/dummyProjects';
import type { RoadmapItem } from '../../../shared/model/roadmap';
import {
   issueKey,
   issueQuery,
   parseIssueRef,
   projectIssues,
   type IssueHit,
   type IssueRef,
   type ProjectIssue,
} from '../../../shared/model/scope';
import { dummyHand, dummyScopeInputs, scopeVersion } from './scopeData';

/**
 * A project's issues and the issue search: GET /project-issues and
 * /issue-search on a real board, which read GitHub through the server's
 * token; the dummy board answers from its fixtures. Adding an issue by hand
 * or taking one off loads every scope and issue list again.
 */

/** Every issue the dummy board's search can find: the specs' issues and a
 * few no spec lists. */
function dummyCorpus(): IssueHit[] {
   const fromSpecs = Object.values(DUMMY_SPECS).flatMap(spec =>
      spec.items.flatMap(item =>
         item.ref
            ? [
                 {
                    ...item.ref,
                    title: item.title,
                    state: item.state,
                    author: item.author ?? null,
                    createdAt: item.createdAt ?? null,
                 },
              ]
            : []
      )
   );
   // the spec epics themselves, to name one on a plan
   const epics = Object.entries(DUMMY_SPECS).flatMap(([key, spec]) => {
      const ref = parseIssueRef(key);
      return ref
         ? [
              {
                 ...ref,
                 title: spec.title,
                 state: 'open' as const,
                 author: 'danielbeardsley',
                 createdAt: null,
              },
           ]
         : [];
   });
   return [...epics, ...fromSpecs, ...DUMMY_ISSUES];
}

/** What the dummy board's search finds: the way the server's does, from
 * its fixtures (lib/scope.js searchIssues). */
function dummySearch(text: string): IssueHit[] {
   const q = issueQuery(text);
   if (!q) return [];
   const all = dummyCorpus();
   if (q.kind === 'ref') return all.filter(hit => issueKey(hit) === issueKey(q.ref));
   if (q.kind === 'number') return all.filter(hit => hit.number === q.number);
   const words = q.words.toLowerCase().split(/\s+/);
   return all.filter(hit => words.every(w => hit.title.toLowerCase().includes(w))).slice(0, 10);
}

/** Issues to pick from for what someone typed (shared/model/scope.ts
 * issueQuery): an error says why GitHub couldn't be searched. */
export async function searchIssues(text: string): Promise<IssueHit[] | { error: string }> {
   if (isDummy()) return dummySearch(text);
   const res = await fetch(`/issue-search?q=${encodeURIComponent(text)}`).catch(() => null);
   if (!res || res.redirected || res.status === 401) {
      return { error: 'Your sign-in expired. Reload the page to sign in again.' };
   }
   if (!res.ok) return { error: 'Couldn’t search GitHub. Try again in a minute.' };
   return ((await res.json()) as { issues: IssueHit[] }).issues;
}

/**
 * Every issue attached to a project (shared/model/scope.ts projectIssues):
 * undefined while it loads, null if that failed. Pass the roadmap's plans,
 * so a change to a plan's spec loads the list again.
 */
export function useProjectIssues(
   slug: string,
   plans: readonly RoadmapItem[] | null
): ProjectIssue[] | null | undefined {
   const [got, setGot] = useState<{ slug: string; issues: ProjectIssue[] | null }>();
   const { n: version } = scopeVersion.useValue();
   const specs = plans
      ?.filter(p => p.project === slug)
      .map(p => `${p.id}:${p.spec ? issueKey(p.spec) : ''}:${p.start}:${p.weeks}`)
      .join(',');
   useEffect(() => {
      if (!plans) return;
      let live = true;
      const load = isDummy()
         ? dummyScopeInputs(plans).then(inputs => projectIssues(inputs, slug))
         : fetch(`/project-issues?project=${encodeURIComponent(slug)}`)
              .then(r => (r.ok ? (r.json() as Promise<{ issues: ProjectIssue[] }>) : null))
              .then(body => body?.issues ?? null)
              .catch(() => null);
      void load.then(issues => {
         if (live) setGot({ slug, issues });
      });
      return () => {
         live = false;
      };
      // keyed on what the list depends on, not the plans' list object
   }, [slug, specs, version]);
   return got?.slug === slug ? got.issues : undefined;
}

/** Add an issue to a project by hand, or take one added by hand off it. */
export async function changeProjectIssue(
   slug: string,
   ref: IssueRef,
   add: boolean
): Promise<{ ok: true } | { error: string }> {
   if (isDummy()) {
      const list = dummyHand.get(slug) ?? [];
      const rest = list.filter(item => item.ref && issueKey(item.ref) !== issueKey(ref));
      const hit = dummyCorpus().find(h => issueKey(h) === issueKey(ref));
      if (add && !hit) return { error: 'GitHub has no issue by that name' };
      dummyHand.set(
         slug,
         add && hit
            ? [
                 ...rest,
                 {
                    source: 'hand',
                    ref: { repo: hit.repo, number: hit.number },
                    title: hit.title,
                    state: hit.state,
                    closedAt: null,
                    joinedAt: Math.floor(Date.now() / 1000),
                    author: hit.author,
                    createdAt: hit.createdAt,
                    addedBy: 'you',
                 },
              ]
            : rest
      );
      scopeVersion.set({ n: scopeVersion.get().n + 1 });
      return { ok: true };
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
           })}`,
           { method: 'DELETE' }
        )
   ).catch(() => null);
   if (!res || res.redirected || res.status === 401) {
      return { error: 'Your sign-in expired. Reload the page to sign in again.' };
   }
   if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: json.error ?? 'Couldn’t save that. Try again in a minute.' };
   }
   scopeVersion.set({ n: scopeVersion.get().n + 1 });
   return { ok: true };
}
