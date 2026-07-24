import { githubUrl, pullKey } from '../../../shared/format';
import type { DerivedPull } from '../../../shared/model/status';

/**
 * A pull paired with its stack-nesting depth (0 = top-level). Board render
 * order: a resolved child immediately follows its parent, recursing through
 * chains — the tree flattened back into a list, the way a Row can render it.
 */
export interface StackedPull {
   pull: DerivedPull;
   depth: number;
}

/** Deeper nests still exist (a five-deep chain happens), but the UI only
 * carries geometry for two indent levels — everything past that reports 2. */
const MAX_DEPTH = 2;

const keyOf = (p: DerivedPull) => pullKey(p.data);

/** Every pull sharing a (repo, head ref), regardless of fork owner. */
function headRefIndex(pulls: DerivedPull[]): Map<string, DerivedPull[]> {
   const byHeadRef = new Map<string, DerivedPull[]>();
   for (const p of pulls) {
      const k = `${p.data.repo}|${p.data.head.ref}`;
      const bucket = byHeadRef.get(k);
      if (bucket) bucket.push(p);
      else byHeadRef.set(k, [p]);
   }
   return byHeadRef;
}

/**
 * A pull's immediate parent, or null when it isn't a resolvable child: not
 * dependent, no pull in the index has a matching head ref, or more than one
 * does. Two different forks can name a branch the same, and the dummy
 * fixture's own #35103/#351011 shows the same fork opening two pulls off one
 * branch — either way, a base ref matching more than one head is a guess this
 * never takes; the pull renders flat instead.
 */
function resolveParent(
   byHeadRef: ReadonlyMap<string, DerivedPull[]>,
   p: DerivedPull
): DerivedPull | null {
   if (!p.dependent) return null;
   const candidates = byHeadRef.get(`${p.data.repo}|${p.data.base.ref}`);
   if (!candidates || candidates.length !== 1) return null;
   return candidates[0] !== p ? candidates[0] : null;
}

/**
 * Reorders a pull list so a pull based on another pull's head branch (both in
 * THIS list) renders right after that parent, indented by nesting depth.
 * Parent resolution only ever looks within `pulls` — a parent that's off this
 * particular lane/lens (closed, filtered, on another tab) can't be found
 * here; see `buildParentLookup` for the whole-board fallback that names it
 * anyway.
 *
 * Same length and content as the input, just reordered — nothing is dropped,
 * nothing is invented.
 */
export function groupIntoTree(pulls: DerivedPull[]): StackedPull[] {
   const byHeadRef = headRefIndex(pulls);

   const parentOf = new Map<string, DerivedPull | null>();
   for (const p of pulls) parentOf.set(keyOf(p), resolveParent(byHeadRef, p));

   // Cycle guard: a<->b (or longer) base loops must not hang the walk below.
   // parentOf is a functional graph (out-degree <= 1 per node), so one pass
   // per unvisited node — tracking the current walk's path — finds every
   // cycle in O(n) total. Cyclical pulls render flat: neither side of a loop
   // can consistently be "above" the other.
   const settled = new Set<string>();
   const cyclical = new Set<string>();
   for (const p of pulls) {
      const start = keyOf(p);
      if (settled.has(start)) continue;
      const path: string[] = [];
      const onPath = new Set<string>();
      let curKey: string | undefined = start;
      while (curKey !== undefined && !settled.has(curKey)) {
         if (onPath.has(curKey)) {
            const idx = path.indexOf(curKey);
            for (const k of path.slice(idx)) cyclical.add(k);
            break;
         }
         onPath.add(curKey);
         path.push(curKey);
         const parent = parentOf.get(curKey);
         curKey = parent ? keyOf(parent) : undefined;
      }
      for (const k of path) settled.add(k);
   }
   for (const k of cyclical) parentOf.set(k, null);

   // Children in input-relative order, one list per resolved parent.
   const childrenOf = new Map<string, DerivedPull[]>();
   for (const p of pulls) {
      const parent = parentOf.get(keyOf(p));
      if (!parent) continue;
      const pk = keyOf(parent);
      const list = childrenOf.get(pk);
      if (list) list.push(p);
      else childrenOf.set(pk, [p]);
   }

   const out: StackedPull[] = [];
   const place = (p: DerivedPull, depth: number) => {
      out.push({ pull: p, depth });
      for (const child of childrenOf.get(keyOf(p)) ?? []) {
         place(child, Math.min(depth + 1, MAX_DEPTH));
      }
   };
   // Roots keep the input's relative order; each one's children are placed
   // recursively right after it, so nothing needs a second sorting pass.
   for (const p of pulls) {
      if (parentOf.get(keyOf(p))) continue; // placed already, under its parent
      place(p, 0);
   }
   return out;
}

/** What a resolved parent looks like once it's off the current list: enough
 * to name it and link to it, nothing more. */
export interface ParentRef {
   number: number;
   title: string;
   url: string;
}

/**
 * The whole-board parent lookup: same resolution rule as `groupIntoTree`, but
 * over every pull on the board — not just the filtered/scoped list a given
 * lane renders — so a pull whose parent exists somewhere else (a different
 * lane, a hidden repo, another lens' scope) can still be named instead of just
 * saying "based on <ref>". Build once (memoized over the full pull set in
 * app.tsx) and thread through RowOptions.parentOf.
 */
export function buildParentLookup(allPulls: DerivedPull[]): (p: DerivedPull) => ParentRef | null {
   const byHeadRef = headRefIndex(allPulls);
   return p => {
      const parent = resolveParent(byHeadRef, p);
      if (!parent) return null;
      return {
         number: parent.data.number,
         title: parent.data.title,
         url: githubUrl(parent.data.repo, parent.data.number),
      };
   };
}
