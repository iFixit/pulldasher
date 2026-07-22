import type { ReactNode } from 'react';
import { DO_WORD_RANK, rowWord, WAIT_WORD_RANK, type RowWord } from '../model/actions';
import { groupIntoTree, type StackedPull } from '../model/stack';
import type { DerivedPull } from '../model/status';
import { pullKey } from '../format';
import { claimFor } from '../store';
import { Truncated } from './Lane';
import { Row, type RowOptions } from './Row';

/**
 * The one eyebrow-label type treatment: every 11px uppercase in-list label on
 * the board (word sub-headers here, Review's "Pick up next" band label) shares
 * this string so the tier can't drift apart one hand-rolled copy at a time.
 */
export const eyebrowText = 'text-[11px] font-semibold tracking-wide uppercase';

/**
 * The quiet in-list label every word-grouped list splits on — the badge's
 * replacement: instead of a per-card pill, the section itself says what's
 * owed (brand) or why it waits (muted). Mirrors Classic's old SubHeader
 * styling so the two lenses still read as one design.
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
   return (
      <div
         className={`border-t border-secondary bg-muted/40 px-3.5 py-1 first:border-t-0 ${eyebrowText}`}
      >
         <span className={kind === 'do' ? 'text-brand-700' : 'text-ink-3'}>{word}</span>{' '}
         <span className="tabular-nums text-ink-3">· {count}</span>
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
export function groupNodesByWord(
   tree: StackedPull[],
   me: string,
   claims: Readonly<Record<string, { login: string; at: number }>>
): WordGroup[] {
   const buckets = new Map<string, WordGroup>();
   let currentKey: string | null = null;
   for (const node of tree) {
      if (node.depth === 0) {
         const rw = rowWord(node.pull, me, { claim: claimFor(node.pull.data, claims) });
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
   const groups = groupNodesByWord(tree, opts.me, opts.claims ?? {});
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
