import { useEffect, useState } from 'react';
import { isDummy, loadDummy } from '../backend/dummy';
import {
   DUMMY_ATTACHED,
   DUMMY_ISSUES,
   DUMMY_LINKS,
   DUMMY_PROJECTS,
} from '../backend/dummyProjects';
import { epoch } from '../../../shared/format';
import { MISC_SLUG, projectOf, type PullLinks } from '../../../shared/model/projects';
import type { RoadmapItem } from '../../../shared/model/roadmap';
import { isSuffixBot } from '../../../shared/model/visibility';
import {
   issueKey,
   planWork,
   projectCounts,
   projectWork,
   type AttachedIssue,
   type IssueCounts,
   type IssueRef,
   type PlanWork,
   type WorkInputs,
   type WorkPull,
} from '../../../shared/model/work';
import { createMemoryStore, readSessionStorage, writeSessionStorage } from '../storage';

/**
 * Every plan's PRs by the dates, and how every project's issues stand
 * (shared/model/work.ts): GET /work-data on a real board, and the dummy
 * board's fixtures run through the same model.
 */

/** Bumped when an issue is added to a project or taken off, so the work
 * and every project page load again. */
export const workVersion = createMemoryStore({ n: 0 });

/** an issue Remove can take off: one added by hand or joined by a link. One
 * with the project's label stays until the label comes off on GitHub. */
export const removable = (issue: AttachedIssue) => !issue.via.includes('label');

/** A row of the dummy board's stand-in for the server's project_issues
 * table: an issue added by hand or joined by a link, and when it was taken
 * off, its row kept so a link never brings it back. */
type DummyRow = AttachedIssue & { removedAt: number | null };

// one set per bench, so ?state=fresh starts with none of the full bench's
const DUMMY_ROWS_KEY = `pd2.dummy.projectIssues${
   typeof location !== 'undefined' && new URLSearchParams(location.search).get('state')
      ? `:${new URLSearchParams(location.search).get('state')}`
      : ''
}`;

/** The dummy board's project_issues rows, by slug: the fixtures' own
 * issues added by hand to start, so Remove takes them off as it would a
 * real one. They last the browser tab, as the server's table outlasts a
 * reload, so a Remove still holds after one. */
export const dummyRows: Map<string, DummyRow[]> = (() => {
   try {
      const kept = JSON.parse(readSessionStorage(DUMMY_ROWS_KEY) ?? 'null');
      if (Array.isArray(kept)) return new Map(kept as [string, DummyRow[]][]);
   } catch {
      // a row from an older shape: start over from the fixtures
   }
   const byHandOnly = (issue: AttachedIssue) => issue.via.length === 1 && issue.via[0] === 'hand';
   return new Map(
      Object.entries(DUMMY_ATTACHED)
         .map(([slug, list]): [string, DummyRow[]] => [
            slug,
            list.filter(byHandOnly).map(issue => ({ ...issue, removedAt: null })),
         ])
         .filter(([, list]) => list.length > 0)
   );
})();

/** Keep the dummy board's rows for the next load of this tab. */
export function saveDummyRows(): void {
   writeSessionStorage(DUMMY_ROWS_KEY, JSON.stringify([...dummyRows]));
}

/** The dummy board's issues by slug, the fixtures' labeled ones and the
 * rows not taken off, each once; and the ones taken off. */
function dummyAttached(): {
   attached: Map<string, AttachedIssue[]>;
   removed: Map<string, Set<string>>;
} {
   const attached = new Map<string, AttachedIssue[]>();
   for (const slug of new Set([...Object.keys(DUMMY_ATTACHED), ...dummyRows.keys()])) {
      const byKey = new Map<string, AttachedIssue>();
      const labeled = (DUMMY_ATTACHED[slug] ?? []).filter(issue => issue.via.includes('label'));
      const live = (dummyRows.get(slug) ?? []).filter(row => row.removedAt == null);
      for (const issue of [...labeled, ...live]) {
         const was = byKey.get(issueKey(issue.ref));
         byKey.set(
            issueKey(issue.ref),
            was
               ? {
                    ...was,
                    via: [...new Set([...was.via, ...issue.via])],
                    addedBy: was.addedBy ?? issue.addedBy,
                    linkedBy: was.linkedBy ?? issue.linkedBy,
                 }
               : issue
         );
      }
      if (byKey.size) attached.set(slug, [...byKey.values()]);
   }
   const removed = new Map(
      [...dummyRows].map(([slug, rows]): [string, Set<string>] => [
         slug,
         new Set(rows.filter(row => row.removedAt != null).map(row => issueKey(row.ref))),
      ])
   );
   return { attached, removed };
}

/** Which projects each PR links, the way the server reads it (lib/work.js
 * pullLinksFrom): every project with an issue it links, or whose own
 * issue it links, sorted. */
function dummyPullLinksFrom(
   attached: ReadonlyMap<string, readonly AttachedIssue[]>,
   own: ReadonlyMap<string, IssueRef>,
   links: ReadonlyMap<string, readonly IssueRef[]>
): PullLinks {
   const projectsOf = new Map<string, Set<string>>();
   const add = (ref: IssueRef, slug: string) =>
      projectsOf.set(issueKey(ref), new Set([...(projectsOf.get(issueKey(ref)) ?? []), slug]));
   for (const [slug, issues] of attached) for (const issue of issues) add(issue.ref, slug);
   for (const [slug, ref] of own) add(ref, slug);
   const out: Record<string, string[]> = {};
   for (const [issue, prs] of links) {
      const slugs = projectsOf.get(issue);
      if (!slugs) continue;
      for (const pr of prs) {
         out[issueKey(pr)] = [...new Set([...(out[issueKey(pr)] ?? []), ...slugs])].sort();
      }
   }
   return out;
}

/**
 * What the dummy board's work is built from, the way the server builds it
 * (lib/work.js workInputs), just after a sync: each load lets the issues
 * its projects' PRs link join on their own, as the server's hourly sync
 * does (joinLinkedIssues), and never one taken off.
 */
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
      // misc holds unsorted work, not a project: a misc PR joins the
      // project whose issue it links, as one with no label does
      const slug = projectOf(p.labels, prefix);
      if (slug && slug !== MISC_SLUG) byProject.set(slug, [...(byProject.get(slug) ?? []), pull]);
      else if (pull.links.length) unlabeled.push(pull);
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
   const ownIssues = new Map(DUMMY_PROJECTS.map(p => [p.slug, { repo: p.repo, number: p.number }]));
   const inputs = (): WorkInputs => {
      const { attached, removed } = dummyAttached();
      return {
         plans,
         attached,
         pulls: byProject,
         unlabeled,
         linked: dummyPullLinksFrom(attached, ownIssues, links),
         links,
         knownPulls,
         knownIssues: new Map(DUMMY_ISSUES.map(hit => [issueKey(hit), hit])),
         notIssues: new Set(DUMMY_PROJECTS.map(p => issueKey(p))),
         ownIssues,
         removed,
      };
   };
   const before = inputs();
   const slugs = new Set([
      ...byProject.keys(),
      ...unlabeled.map(pr => before.linked?.[issueKey(pr)]?.[0]).filter(s => s != null),
   ]);
   const now = Math.floor(Date.now() / 1000);
   let joined = false;
   for (const slug of slugs) {
      for (const s of projectWork(before, slug, now).suggested) {
         // one the board has never seen is one GitHub would have to name
         if (!s.joins || !s.title) continue;
         const ref = { repo: s.repo, number: s.number };
         dummyRows.set(slug, [
            ...(dummyRows.get(slug) ?? []),
            {
               ref,
               title: s.title,
               state: s.state,
               closedAt: s.closedAt ?? null,
               author: s.author,
               createdAt: s.createdAt,
               via: ['link'],
               // its pace counts from when the PR that brought it opened, as
               // on the server; when it joined stays beside it
               attachedAt: s.linkedAt,
               joinedAt: now,
               addedBy: null,
               linkedBy: s.linkedBy[0],
               removedAt: null,
            },
         ]);
         joined = true;
      }
   }
   if (!joined) return before;
   saveDummyRows();
   return inputs();
}

/** Which projects each of the dummy board's PRs links, as /projects-data
 * sends it, once its issues have joined. */
export async function dummyPullLinks(): Promise<PullLinks> {
   return (await dummyWorkInputs([])).linked ?? {};
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
   // what the plans' PRs depend on: each plan's project, dates, whether it
   // ends at all, status, and when its status changed (a done plan's late
   // PRs count from then)
   const key = plans
      ?.map(
         p =>
            `${p.id}:${p.project}:${p.start}:${p.weeks}:${p.end_kind}:${p.status}:${
               p.status_at ?? p.updated_at ?? ''
            }`
      )
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
