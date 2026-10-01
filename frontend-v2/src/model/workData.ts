import { useEffect, useState } from 'react';
import { isDummy, loadDummy } from '../backend/dummy';
import { DUMMY_ATTACHED, DUMMY_ISSUES, DUMMY_LINKS } from '../backend/dummyProjects';
import { epoch } from '../../../shared/format';
import { projectOf } from '../../../shared/model/projects';
import type { RoadmapItem } from '../../../shared/model/roadmap';
import { isSuffixBot } from '../../../shared/model/visibility';
import {
   issueKey,
   planWork,
   projectCounts,
   type AttachedIssue,
   type IssueCounts,
   type IssueRef,
   type PlanWork,
   type WorkInputs,
   type WorkPull,
} from '../../../shared/model/work';
import { createMemoryStore } from '../storage';

/**
 * Every plan's PRs by the dates, and how every project's issues stand
 * (shared/model/work.ts): GET /work-data on a real board, and the dummy
 * board's fixtures run through the same model.
 */

/** Bumped when an issue is added to a project or taken off, so the work
 * and every project page load again. */
export const workVersion = createMemoryStore({ n: 0 });

/** The issues added by hand on the dummy board, by slug, standing in for
 * the server's table. */
export const dummyHand = new Map<string, AttachedIssue[]>();

/** What the dummy board's work is built from, the way the server builds it
 * (lib/work.js workInputs). */
export async function dummyWorkInputs(plans: readonly RoadmapItem[]): Promise<WorkInputs> {
   const { pulls, projectLabelPrefix } = await loadDummy();
   const prefix = projectLabelPrefix ?? 'project:';
   const linksOf = new Map(Object.entries(DUMMY_LINKS).map(([k, v]) => [k.toLowerCase(), v]));
   const byProject = new Map<string, WorkPull[]>();
   const unlabeled: WorkPull[] = [];
   const knownPulls = new Map<string, WorkPull>();
   for (const p of pulls) {
      if (isSuffixBot(p.user.login)) continue;
      const pull: WorkPull = {
         repo: p.repo,
         number: p.number,
         title: p.title,
         author: p.user.login,
         createdAt: epoch(p.created_at),
         mergedAt: p.merged_at ? epoch(p.merged_at) : null,
         closedAt: p.closed_at ? epoch(p.closed_at) : null,
         state: p.state === 'open' ? 'open' : 'closed',
         links: linksOf.get(issueKey(p)) ?? [],
      };
      knownPulls.set(issueKey(pull), pull);
      const slug = projectOf(p.labels, prefix);
      if (slug) byProject.set(slug, [...(byProject.get(slug) ?? []), pull]);
      else if (pull.links.length) unlabeled.push(pull);
   }
   // a project's issues by its label and by hand, each once
   const attached = new Map<string, AttachedIssue[]>();
   for (const slug of new Set([...Object.keys(DUMMY_ATTACHED), ...dummyHand.keys()])) {
      const byKey = new Map<string, AttachedIssue>();
      for (const issue of [...(DUMMY_ATTACHED[slug] ?? []), ...(dummyHand.get(slug) ?? [])]) {
         const was = byKey.get(issueKey(issue.ref));
         byKey.set(
            issueKey(issue.ref),
            was
               ? {
                    ...was,
                    via: [...new Set([...was.via, ...issue.via])],
                    addedBy: was.addedBy ?? issue.addedBy,
                 }
               : issue
         );
      }
      attached.set(slug, [...byKey.values()]);
   }
   // the PRs that link each issue, as the issue's side reads them
   const links = new Map<string, IssueRef[]>();
   for (const [pr, issues] of linksOf) {
      const at = pr.lastIndexOf('#');
      const ref = knownPulls.get(pr) ?? { repo: pr.slice(0, at), number: Number(pr.slice(at + 1)) };
      for (const issue of issues) {
         const k = issueKey(issue);
         links.set(k, [...(links.get(k) ?? []), { repo: ref.repo, number: ref.number }]);
      }
   }
   return {
      plans,
      attached,
      pulls: byProject,
      unlabeled,
      links,
      knownPulls,
      knownIssues: new Map(DUMMY_ISSUES.map(hit => [issueKey(hit), hit])),
   };
}

/** Every plan's PRs by the dates, by plan id, and how every project's
 * issues stand, by slug. */
export interface WorkData {
   plans: ReadonlyMap<number, PlanWork>;
   projects: ReadonlyMap<string, IssueCounts>;
}

const toData = (body: { plans: PlanWork[]; projects: Record<string, IssueCounts> }): WorkData => ({
   plans: new Map(body.plans.map(p => [p.planId, p])),
   projects: new Map(Object.entries(body.projects)),
});

async function load(plans: readonly RoadmapItem[]): Promise<WorkData | null> {
   if (isDummy()) {
      const inputs = await dummyWorkInputs(plans);
      return toData({
         plans: planWork(inputs),
         projects: Object.fromEntries(projectCounts(inputs)),
      });
   }
   return fetch('/work-data')
      .then(r => (r.ok ? (r.json() as Promise<Parameters<typeof toData>[0]>) : null))
      .then(body => body && toData(body))
      .catch(() => null);
}

/**
 * The work: undefined while it loads, null if the fetch failed. Pass the
 * roadmap's plans (null while they load).
 */
export function useWorkData(plans: readonly RoadmapItem[] | null): WorkData | null | undefined {
   const [got, setGot] = useState<WorkData | null | undefined>(undefined);
   const { n: version } = workVersion.useValue();
   // what the plans' PRs depend on: each plan's project, dates, status, and
   // when it last changed (a done plan's late PRs count from then)
   const key = plans
      ?.map(p => `${p.id}:${p.project}:${p.start}:${p.weeks}:${p.status}:${p.updated_at ?? ''}`)
      .join(',');
   useEffect(() => {
      if (!plans) return;
      let live = true;
      void load(plans).then(data => {
         if (live) setGot(data);
      });
      return () => {
         live = false;
      };
      // keyed on what the work depends on, not the list object, which the
      // roadmap rebuilds on every change
   }, [key, version]);
   return plans ? got : undefined;
}
