import type { DerivedPull } from '../../../shared/model/status';

/**
 * The review queue's repo blocks: the owner's priority-and-cap model. With a
 * repo priority set, the queue stops interleaving repos and renders as
 * contiguous per-repo blocks in the priority order — the monorepo's work
 * before ops, ops before the long tail — with each block's overflow capped
 * behind a "+N more from <repo>" fold (the cap is the flood bound: two ops
 * reviewers receiving twenty AI-assisted producers' output must not
 * monopolize the screen).
 *
 * Two guarantees survive the partition:
 * - Starved pulls pierce it. They lead the lane regardless of repo, in their
 *   existing rank order — the fairness backstop must not sit below a repo
 *   the viewer ranked last, or "surface the other repos" becomes a lie.
 * - Order WITHIN a block is exactly the incoming order (stable partition),
 *   so teammates still lead and the score still ranks — the priority only
 *   decides which repo's run comes first, never which pull is "best".
 *
 * Repos in the queue but absent from the priority list trail the listed
 * ones, ordered by their best pull's rank (first appearance in the incoming
 * order) — urgency picks the tail's order, not the alphabet.
 */
export interface RepoBlock {
   repo: string;
   pulls: DerivedPull[];
}

export function repoBlocks(
   queue: DerivedPull[],
   priority: string[]
): { starved: DerivedPull[]; blocks: RepoBlock[] } {
   const starved = queue.filter(p => p.starved);
   const rest = queue.filter(p => !p.starved);
   const byRepo = new Map<string, DerivedPull[]>();
   for (const p of rest) {
      const list = byRepo.get(p.data.repo);
      if (list) list.push(p);
      else byRepo.set(p.data.repo, [p]);
   }
   const listed = priority.filter(r => byRepo.has(r));
   // Map preserves insertion order = first appearance in rank order
   const unlisted = [...byRepo.keys()].filter(r => !priority.includes(r));
   return {
      starved,
      blocks: [...listed, ...unlisted].map(repo => ({
         repo,
         pulls: byRepo.get(repo) ?? [],
      })),
   };
}
