import type { ReactNode } from 'react';
import { DO_WORD_RANK, rowWord, WAIT_WORD_RANK, type RowWord } from '../model/actions';
import { groupIntoTree, type StackedPull } from '../model/stack';
import type { DerivedPull } from '../model/status';
import { pullKey } from '../format';
import { claimFor } from '../store';
import { Truncated } from './Lane';
import { Popover } from './Popover';
import { Row, type RowOptions } from './Row';

/**
 * The one eyebrow-label type treatment: every 11px uppercase in-list label on
 * the board (word sub-headers here, Review's "Pick up next" band label) shares
 * this string so the tier can't drift apart one hand-rolled copy at a time.
 */
export const eyebrowText = 'text-[11px] font-semibold tracking-wide uppercase';

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
   'Finish draft': 'Your draft. Not up for review until you open it.',
   // wait-words: why the pull sits
   'waiting on re-CR':
      'A reviewer approved it, then new commits landed. Waiting on them to approve again.',
   'waiting on CR': 'Waiting for someone to code review it.',
   'with author': 'Changes were requested; the next push is the author’s.',
   'waiting on re-QA': 'Someone tested it, then new commits landed. Waiting on them to test again.',
   'waiting on QA': 'Waiting for someone to test it.',
   'in QA': 'Someone is testing it right now.',
   claimed: 'Someone flagged they’re reading it.',
   stamped: 'Your stamp is in; waiting on the rest of the sign-offs.',
   'CI running': 'Checks are still running.',
   'CI red': 'A required check is failing; the author fixes that first.',
   blocked: 'The author paused it with a dev block.',
   'deploy hold': 'Done, but deliberately not shipped yet.',
   conflicts: 'Conflicts with its base branch; the author rebases.',
   stacked: 'Based on another open PR; it merges with its parent.',
   'on hold': 'Blocked on something outside this repo.',
   ready: 'Fully signed off and green; waiting on the author to merge.',
   draft: 'Not up for review yet.',
   waiting: 'Waiting, and the board can’t say on what.',
};

/**
 * The quiet in-list label every word-grouped list splits on — the badge's
 * replacement: instead of a per-card pill, the section itself says what's
 * owed (brand) or why it waits (muted). Mirrors Classic's old SubHeader
 * styling so the two lenses still read as one design. The word itself is a
 * hover door to its one-sentence gloss (WORD_GLOSS above).
 */
export function WordSubHeader({
   word,
   kind,
   count,
}: {
   word: string;
   kind: RowWord['kind'];
   count: number;
}) {
   const gloss = WORD_GLOSS[word];
   const inner = (
      <>
         <span className={kind === 'do' ? 'text-brand-700' : 'text-ink-3'}>{word}</span>{' '}
         <span className="tabular-nums text-ink-3">· {count}</span>
      </>
   );
   return (
      <div
         className={`border-t border-secondary bg-muted/40 px-3.5 py-1 first:border-t-0 ${eyebrowText}`}
      >
         {gloss ? (
            <Popover
               label={`what “${word}” means`}
               side="right"
               hover
               rootClass="relative inline-flex"
               width="w-max max-w-[280px]"
               panelClass="p-2 text-xs"
               trigger={t => (
                  <button
                     {...t}
                     type="button"
                     className={`hit rounded border-0 bg-transparent p-0 text-left ${eyebrowText}`}
                  >
                     {inner}
                  </button>
               )}
            >
               {/* the panel sits inside the uppercase eyebrow — undo the
                   treatment so the gloss reads as a normal sentence */}
               <p className="px-1 font-normal normal-case tracking-normal text-ink-2">{gloss}</p>
            </Popover>
         ) : (
            inner
         )}
      </div>
   );
}

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
 * and render each bucket as a header followed by its rows — exactly the rows
 * FoldRows would produce, just split by section instead of one flat run.
 * Headers don't count against `cap` (the truncation only rations rows), so
 * the cap is lifted by the header count before handing it to Truncated.
 */
export function WordGroupRows({
   pulls,
   opts,
   id,
   cap,
}: {
   pulls: DerivedPull[];
   opts: RowOptions;
   id?: string;
   cap: number;
}) {
   const tree = groupIntoTree(pulls);
   const groups = groupNodesByWord(tree, opts.me);
   if (!groups.length) return null;
   const children: ReactNode[] = groups.flatMap(g => [
      <WordSubHeader
         key={`h-${g.kind}-${g.word}`}
         word={g.word}
         kind={g.kind}
         count={g.nodes.length}
      />,
      ...g.nodes.map(({ pull: p, depth }) => (
         <Row key={pullKey(p.data)} pull={p} opts={opts} depth={depth} />
      )),
   ]);
   return (
      <Truncated cap={cap + groups.length} id={id}>
         {children}
      </Truncated>
   );
}
