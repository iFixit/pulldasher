import { useEffect, useMemo, useState } from 'react';
import { isDummy, loadDummy } from '../backend/dummy';
import { DUMMY_LINKS, DUMMY_SPECS } from '../backend/dummyProjects';
import { epoch } from '../../../shared/format';
import { projectOf } from '../../../shared/model/projects';
import type { RoadmapItem } from '../../../shared/model/roadmap';
import { issueKey, planScopes, type PlanScope, type WorkPull } from '../../../shared/model/scope';
import { isSuffixBot } from '../../../shared/model/visibility';

/**
 * Every plan's scope (shared/model/scope.ts), by plan id: GET /scope-data on
 * a real board, and the dummy board's fixture specs over its fixture PRs.
 * The server reads a plan's spec off GitHub when the plan changes, so a
 * change to the plans' specs fetches again now and once more a few seconds
 * later, when that read has landed.
 */

/** The dummy board's scopes, built the way the server builds them. */
async function dummyScopes(plans: readonly RoadmapItem[]): Promise<PlanScope[]> {
   const { pulls, projectLabelPrefix } = await loadDummy();
   const prefix = projectLabelPrefix ?? 'project:';
   const byProject = new Map<string, WorkPull[]>();
   // the fixture PRs with no project label that link a spec
   const unlabeled: WorkPull[] = [];
   const linked = new Set(Object.keys(DUMMY_LINKS).map(k => k.toLowerCase()));
   for (const p of pulls) {
      if (isSuffixBot(p.user.login)) continue;
      const slug = projectOf(p.labels, prefix);
      const pull: WorkPull = {
         repo: p.repo,
         number: p.number,
         title: p.title,
         author: p.user.login,
         createdAt: epoch(p.created_at),
         mergedAt: p.merged_at ? epoch(p.merged_at) : null,
         state: p.state === 'open' ? 'open' : 'closed',
      };
      if (slug) byProject.set(slug, [...(byProject.get(slug) ?? []), pull]);
      else if (linked.has(issueKey(pull))) unlabeled.push(pull);
   }
   const specs = new Map(
      Object.entries(DUMMY_SPECS).map(([k, spec]) => [k, { ...spec, found: true }])
   );
   return planScopes({
      plans,
      specs,
      labeled: new Map(),
      pulls: byProject,
      links: new Map(Object.entries(DUMMY_LINKS)),
      unlabeled,
   });
}

async function load(plans: readonly RoadmapItem[]): Promise<PlanScope[] | null> {
   if (isDummy()) return dummyScopes(plans);
   return fetch('/scope-data')
      .then(r => (r.ok ? (r.json() as Promise<{ plans: PlanScope[] }>) : null))
      .then(body => body?.plans ?? null)
      .catch(() => null);
}

/** how long after a spec change the server's GitHub read has usually landed */
const SYNC_MS = 8000;

/**
 * Every plan's scope by plan id: undefined while it loads, null if the fetch
 * failed. Pass the roadmap's plans (null while they load).
 */
export function useScopeData(
   plans: readonly RoadmapItem[] | null
): ReadonlyMap<number, PlanScope> | null | undefined {
   const [got, setGot] = useState<PlanScope[] | null | undefined>(undefined);
   // what each plan's scope depends on: its spec, dates, status, and when it
   // last changed (a done plan's late PRs count from then)
   const key = plans
      ?.map(
         p =>
            `${p.id}:${p.project}:${p.spec ? issueKey(p.spec) : ''}:${p.start}:${p.weeks}:${
               p.status
            }:${p.updated_at ?? ''}`
      )
      .join(',');
   useEffect(() => {
      if (!plans) return;
      let live = true;
      const fetchNow = () =>
         load(plans).then(data => {
            if (live) setGot(data);
         });
      void fetchNow();
      const again = isDummy() ? undefined : setTimeout(fetchNow, SYNC_MS);
      return () => {
         live = false;
         if (again) clearTimeout(again);
      };
      // keyed on what the scopes depend on, not the list object, which the
      // roadmap rebuilds on every change
   }, [key]);
   const byPlan = useMemo(() => got && new Map(got.map(s => [s.planId, s])), [got]);
   return plans ? byPlan : undefined;
}
