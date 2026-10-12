import { useEffect } from 'react';
import { pullKey } from '../../../shared/format';
import { issueKey } from '../../../shared/model/issueRef';
// the small module, so the review board doesn't load the projects model
import { MISC_SLUG, projectOf } from '../../../shared/model/projectLabel';
import type { PullLinks } from '../../../shared/model/projects';
import type { RoadmapStatus } from '../../../shared/model/roadmap';
import type { DerivedPull } from '../../../shared/model/status';
import { isDummy } from '../backend/dummy';
import { backend } from '../backend/socket';
import { createMemoryStore } from '../storage';

/**
 * What the review board knows of projects (GET /project-standing): which
 * projects each PR links, and how each project's plan stands, so a parked
 * project's PRs sink in their lanes and the last PRs of a plan under way
 * break ties upward. Loaded once a session and again whenever the server
 * says projects changed; the dummy board builds the same from its fixtures.
 */
export interface ProjectStanding {
   /** the projects each PR links, by issueKey of the PR (projects.ts PullLinks) */
   pull_links: PullLinks;
   /** the plan that speaks for each project (roadmap.ts planFor), by slug;
    * in_progress is the derived In progress (roadmap.ts inProgress) */
   plans: Record<string, { status: RoadmapStatus; in_progress: boolean; name?: string }>;
}

/** how long a burst of changes on the server settles before one refetch,
 * as on the Projects tab */
const SETTLE_MS = 2000;

const store = createMemoryStore<{ standing: ProjectStanding | null }>({ standing: null });

/** The dummy board's twin of the endpoint: its PRs' links as /projects-data
 * sends them, and its roadmap as the board shows it (a plan read In progress
 * from its PRs already says active there). Loaded only on the dummy board,
 * so the fixtures stay out of the review board's bundle. */
async function dummyStanding(): Promise<ProjectStanding> {
   const [{ dummyPullLinks }, { loadRoadmap, readRoadmap }, { planFor }] = await Promise.all([
      import('./workData'),
      import('./roadmapData'),
      import('../../../shared/model/roadmap'),
   ]);
   await loadRoadmap();
   const items = readRoadmap().items ?? [];
   const plans: ProjectStanding['plans'] = {};
   for (const slug of new Set(items.flatMap(i => (i.project ? [i.project] : [])))) {
      const plan = planFor(slug, items);
      if (plan) plans[slug] = { status: plan.status, in_progress: plan.status === 'active' };
   }
   return { pull_links: await dummyPullLinks(), plans };
}

async function load(): Promise<void> {
   const standing = isDummy()
      ? await dummyStanding().catch(() => null)
      : await fetch('/project-standing')
           .then(r => (r.ok ? (r.json() as Promise<ProjectStanding>) : null))
           .catch(() => null);
   // a failed load keeps what was there: the board just doesn't sink or
   // raise anything it can't vouch for
   if (standing) store.set({ standing });
}

let started = false;
function start() {
   if (started) return;
   started = true;
   void load();
   let wait: ReturnType<typeof setTimeout> | null = null;
   backend.onProjectsChanged(() => {
      if (wait) clearTimeout(wait);
      wait = setTimeout(() => void load(), SETTLE_MS);
   });
}

/** The standing, null until it loads; `prefix` null (no projects on this
 * server) never asks for it. */
export function useProjectStanding(prefix: string | null): ProjectStanding | null {
   useEffect(() => {
      if (prefix) start();
   }, [prefix]);
   return store.useValue().standing;
}

/** A PR's project by the Projects tab's rule: its label, else the project
 * whose issue it links (projectLabel.ts projectOf). */
export function projectOfPull(
   p: Pick<DerivedPull, 'data'>,
   prefix: string,
   standing: ProjectStanding | null
): string | null {
   return projectOf(p.data.labels, prefix, standing?.pull_links[issueKey(p.data)]);
}

/** the most open PRs a project under way can have for each to count as one
 * of its last: finishing them brings the plan in */
export const FINISH_MAX_OPEN = 2;

/** What the review lanes read off the standing, by pullKey. */
export interface PullStanding {
   /** open PRs whose project's plan is parked: they sink in their lanes */
   parked: ReadonlyMap<string, string>;
   /** open PRs that are among the last FINISH_MAX_OPEN of a plan in
    * progress: they go first when they'd otherwise tie. `left` counts the
    * project's open PRs, this one included. */
   finishing: ReadonlyMap<string, { slug: string; left: number }>;
}

export const NO_STANDING: PullStanding = { parked: new Map(), finishing: new Map() };

/**
 * Each open PR's project and how it stands. `open` is every person's open
 * PR whatever the filters narrow, as every Projects view counts them, so a
 * filtered-out PR still counts toward its project's last ones.
 */
export function pullStanding(
   standing: ProjectStanding | null,
   open: readonly Pick<DerivedPull, 'data'>[],
   prefix: string | null
): PullStanding {
   if (!standing || !prefix) return NO_STANDING;
   const keysOf = new Map<string, string[]>();
   for (const p of open) {
      const slug = projectOfPull(p, prefix, standing);
      if (slug == null || slug === MISC_SLUG) continue;
      keysOf.set(slug, [...(keysOf.get(slug) ?? []), pullKey(p.data)]);
   }
   const parked = new Map<string, string>();
   const finishing = new Map<string, { slug: string; left: number }>();
   for (const [slug, keys] of keysOf) {
      const plan = standing.plans[slug];
      for (const key of keys) {
         if (plan?.status === 'parked') parked.set(key, slug);
         else if (plan?.in_progress && keys.length <= FINISH_MAX_OPEN)
            finishing.set(key, { slug, left: keys.length });
      }
   }
   return { parked, finishing };
}
