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
 * - Starved pulls are surfaced as a highlight (returned separately, still in
 *   rank order) AND kept in their own repo block — a starved pull from a
 *   low-priority repo is never hidden by a higher-priority repo's block,
 *   unlike an earlier version that extracted starved pulls out of the
 *   blocks entirely and could bury one behind a high-volume repo's "show
 *   more" fold.
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
   const byRepo = new Map<string, DerivedPull[]>();
   for (const p of queue) {
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
