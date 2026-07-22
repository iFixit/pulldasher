import { DO_WORD_RANK, rowWord, WAIT_WORD_RANK, type RowWord } from '../model/actions';
import { groupIntoTree, type StackedPull } from '../model/stack';
import type { DerivedPull } from '../model/status';
import { pullKey } from '../format';
import { claimFor } from '../store';
import { Fold, Truncated } from './Lane';
import { Row, type RowOptions } from './Row';

export { eyebrowText } from './Lane';

/**
 * One plain sentence per group word, shown on hovering the header — the
 * eyebrow explains itself in place, so the legend stays documentation and is
 * never required reading. Viewer-relative on purpose: do-words describe your
 * action, wait-words describe what the pull is waiting on. A word missing
 * here renders as a plain header (the safe fallback for future vocabulary).
 */
const WORD_GLOSS: Record<string, string> = {
   // do-words: the next step is yours
   'Re-stamp':
      'You approved this PR, then new commits landed and undid your approval. Check the changes and approve again.',
   'Re-QA': 'You tested this PR, then new commits landed. Test it again.',
   'Finish QA': 'You started testing these. Finish and stamp.',
   'Finish CR': 'You started reviewing; your stamp isn’t in yet.',
   'Re-review': 'You asked for changes and they pushed. Take another look.',
   Merge: 'Fully signed off and green. Your merge button.',
   'Fix CI': 'Your PR with a failing build. Nobody can review it until it’s green.',
   Respond: 'A reviewer left feedback that waits on your answer.',
   Unblock: 'A block of yours is what holds it. Lift it when you’re ready.',
   Rebase: 'Your PR conflicts with its base branch.',
   'Nudge CR': 'Your PR, and nobody has reviewed it yet. Worth a ping.',
   'Find QA-er': 'CR isn’t the gate here, QA is. Line someone up to test it.',
   Review: 'Open PRs you could code review.',
   QA: 'Open PRs you could test.',
   Undraft: 'Your draft. Mark it ready on GitHub when you want review.',
   // wait-words: why the pull sits
   'waiting on re-CR':
      'A reviewer approved it, then new commits landed. Waiting on them to approve again.',
   'waiting on CR': 'Waiting for someone to code review it.',
   'with author': 'Changes were requested; the next push is the author’s.',
   'waiting on re-QA': 'Someone tested it, then new commits landed. Waiting on them to test again.',
   'waiting on QA': 'Waiting for someone to test it.',
   'in QA':
      'Someone is testing it right now: they added the QAing label on GitHub. Add it yourself to claim a QA.',
   claimed: 'Someone flagged they’re reading it.',
   stamped: 'Your stamp is in; waiting on the rest of the sign-offs.',
   'CI running': 'Checks are still running.',
   'CI red':
      'A required check is failing; the author fixes that first. Stale stamps wait too: nobody is asked to re-stamp until it’s green.',
   blocked:
      'Someone left a dev block; the author owes changes first. Stale stamps wait until the block lifts.',
   'deploy hold': 'Done, but deliberately not shipped yet.',
   conflicts: 'Conflicts with its base branch; the author rebases.',
   stacked: 'Based on another open PR; it merges with its parent.',
   'on hold': 'Blocked on something outside this repo.',
   parked:
      'Labeled Cryogenic Storage: shelved on purpose. Nothing is asked of anyone while it’s parked.',
   ready: 'Fully signed off and green; waiting on the author to merge.',
   draft: 'Not up for review yet.',
   waiting: 'Waiting, and the board can’t say on what.',
};

export interface WordGroup {
   word: string;
   kind: RowWord['kind'];
   nodes: StackedPull[];
}

/**
 * Buckets a stack-aware tree (model/stack.ts's groupIntoTree) by each root
 * pull's rowWord — the same word that would have been the card's badge.
 * A stacked child always follows its root into the root's bucket, so a
 * stack never splits across two headers. Buckets are keyed by (kind, word)
 * so every "Re-stamp" card lands in one group regardless of where it fell in
 * the input order; the RETURN order is what's ranked — do-groups first (most
 * urgent DO_WORD_RANK first), then wait-groups (WAIT_WORD_RANK), unknown
 * words last, ties kept in first-seen order (Array#sort is stable).
 */
export function groupNodesByWord(tree: StackedPull[], me: string): WordGroup[] {
   const buckets = new Map<string, WordGroup>();
   let currentKey: string | null = null;
   for (const node of tree) {
      if (node.depth === 0) {
         const rw = rowWord(node.pull, me, { claim: claimFor(node.pull.data) });
         currentKey = `${rw.kind}:${rw.word}`;
         if (!buckets.has(currentKey)) {
            buckets.set(currentKey, { word: rw.word, kind: rw.kind, nodes: [] });
         }
      }
      // depth > 0 with no depth-0 seen yet can't happen — groupIntoTree always
      // places a root before its children — but the guard keeps this total.
      if (currentKey) buckets.get(currentKey)!.nodes.push(node);
   }
   const rankOf = (g: WordGroup): number => {
      const rank = g.kind === 'do' ? DO_WORD_RANK : WAIT_WORD_RANK;
      const idx = rank.indexOf(g.word);
      return idx === -1 ? Number.POSITIVE_INFINITY : idx;
   };
   const kindOrder = (k: RowWord['kind']): number => (k === 'do' ? 0 : 1);
   return [...buckets.values()].sort(
      (a, b) => kindOrder(a.kind) - kindOrder(b.kind) || rankOf(a) - rankOf(b)
   );
}

/**
 * The full word-grouped renderer: stack the pulls, bucket them by rowWord,
 * and render each bucket as its own Fold — the board's one subsection band,
 * so every group can be collapsed and the choice is remembered. `cap` rations
 * rows per group ("+N more" inside the fold); primary lanes greet you open
 * (`foldDefaultOpen`), ledger uses pass false so the stack of bands reads as
 * a quiet table of contents.
 */
export function WordGroupRows({
   pulls,
   opts,
   id,
   cap,
   foldDefaultOpen = true,
}: {
   pulls: DerivedPull[];
   opts: RowOptions;
   id?: string;
   cap: number;
   foldDefaultOpen?: boolean;
}) {
   const tree = groupIntoTree(pulls);
   const groups = groupNodesByWord(tree, opts.me);
   if (!groups.length) return null;
   return (
      <>
         {groups.map(g => {
            const gid = id ? `${id}:${g.kind}:${g.word}` : undefined;
            return (
               <Fold
                  key={`${g.kind}-${g.word}`}
                  count={g.nodes.length}
                  label={g.word}
                  tone={g.kind}
                  gloss={WORD_GLOSS[g.word]}
                  id={gid}
                  defaultOpen={foldDefaultOpen}
               >
                  <Truncated cap={cap} id={gid ? `${gid}:rows` : undefined}>
                     {g.nodes.map(({ pull: p, depth }) => (
                        <Row key={pullKey(p.data)} pull={p} opts={opts} depth={depth} />
                     ))}
                  </Truncated>
               </Fold>
            );
         })}
      </>
   );
}
