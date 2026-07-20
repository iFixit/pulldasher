import { describe, expect, it } from 'vitest';
import type { PullData } from '../types';
import type { DerivedPull } from './status';
import { groupIntoTree } from './stack';

/**
 * A minimal DerivedPull fixture: groupIntoTree only reads repo/number,
 * head.ref, base.ref, and `dependent` — everything else here is filler to
 * satisfy the type, same spirit as status.test.ts's `pull()` helper.
 */
function dp(
   number: number,
   headRef: string,
   baseRef: string,
   opts: { repo?: string; owner?: string } = {}
): DerivedPull {
   const repo = opts.repo ?? 'iFixit/ifixit';
   const data: PullData = {
      repo,
      number,
      state: 'open',
      title: `Pull #${number}`,
      body: '',
      draft: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      closed_at: null,
      merged_at: null,
      mergeable: true,
      difficulty: null,
      additions: 10,
      deletions: 5,
      changed_files: 2,
      milestone: { title: null, due_on: null },
      head: {
         ref: headRef,
         sha: `sha-${number}`,
         repo: { owner: { login: opts.owner ?? 'iFixit' } },
      },
      base: { ref: baseRef },
      user: { login: 'author' },
      status: {
         cr_req: 1,
         qa_req: 1,
         allCR: [],
         allQA: [],
         dev_block: [],
         deploy_block: [],
         commit_statuses: [],
      },
      labels: [],
      participants: [],
   };
   return {
      data,
      status: 'needs_cr',
      ci: 'none',
      ciFailing: [],
      crBy: [],
      qaBy: [],
      crHave: 0,
      qaHave: 0,
      recrBy: [],
      reqaBy: [],
      headPushedAt: null,
      ageDays: 0,
      signedOffAt: null,
      starved: false,
      starveScore: 0,
      weight: 'S',
      conflict: false,
      mergeUnknown: false,
      dependent: !['main', 'master'].includes(baseRef),
      sizeKnown: true,
      devBlockedBy: [],
      deployBlockedBy: [],
      qaingLogin: null,
      externalBlock: false,
      cryo: false,
      changesRequestedBy: [],
      engagedNoStamp: [],
   };
}

const depths = (out: ReturnType<typeof groupIntoTree>) =>
   out.map(({ pull, depth }) => [pull.data.number, depth]);

describe('groupIntoTree', () => {
   it('passes an empty list through untouched', () => {
      expect(groupIntoTree([])).toEqual([]);
   });

   it('passes a list with no stacked pulls through in the same order', () => {
      const a = dp(1, 'a', 'master');
      const b = dp(2, 'b', 'master');
      expect(depths(groupIntoTree([a, b]))).toEqual([
         [1, 0],
         [2, 0],
      ]);
   });

   it('nests a child right after its parent, depth 1', () => {
      const parent = dp(1, 'feature-a', 'master');
      const child = dp(2, 'feature-b', 'feature-a');
      // input order deliberately reversed: the parent must still lead
      expect(depths(groupIntoTree([child, parent]))).toEqual([
         [1, 0],
         [2, 1],
      ]);
   });

   it('caps reported depth at 2 for a chain deeper than that', () => {
      const a = dp(1, 'a', 'master');
      const b = dp(2, 'b', 'a');
      const c = dp(3, 'c', 'b');
      const d = dp(4, 'd', 'c'); // great-grandchild: natural depth 3, capped to 2
      expect(depths(groupIntoTree([a, b, c, d]))).toEqual([
         [1, 0],
         [2, 1],
         [3, 2],
         [4, 2],
      ]);
   });

   it('one parent, two children: both nest, in their input-relative order', () => {
      const parent = dp(1, 'base-feature', 'master');
      const child1 = dp(2, 'c1', 'base-feature');
      const child2 = dp(3, 'c2', 'base-feature');
      expect(depths(groupIntoTree([parent, child1, child2]))).toEqual([
         [1, 0],
         [2, 1],
         [3, 1],
      ]);
   });

   it('an ambiguous parent (two pulls share the head ref) renders flat', () => {
      // mirrors the dummy fixture's #35103/#351011: same repo, same head ref
      const twin1 = dp(35103, 'shared-ref', 'master');
      const twin2 = dp(351011, 'shared-ref', 'master');
      const child = dp(35059, 'child-ref', 'shared-ref');
      const out = groupIntoTree([twin1, twin2, child]);
      expect(depths(out)).toEqual([
         [35103, 0],
         [351011, 0],
         [35059, 0],
      ]);
   });

   it('a fork twin (different owners, same branch name) is ambiguous too', () => {
      const fork1 = dp(1, 'shared-ref', 'master', { owner: 'alice' });
      const fork2 = dp(2, 'shared-ref', 'master', { owner: 'bob' });
      const child = dp(3, 'child-ref', 'shared-ref');
      expect(depths(groupIntoTree([fork1, fork2, child]))).toEqual([
         [1, 0],
         [2, 0],
         [3, 0],
      ]);
   });

   it('a parent absent from the list renders the child flat', () => {
      const orphan = dp(1, 'child-ref', 'some-branch-not-on-this-board');
      expect(depths(groupIntoTree([orphan]))).toEqual([[1, 0]]);
   });

   it('a base<->base cycle renders flat and does not hang', () => {
      const a = dp(1, 'ref-a', 'ref-b');
      const b = dp(2, 'ref-b', 'ref-a');
      expect(depths(groupIntoTree([a, b]))).toEqual([
         [1, 0],
         [2, 0],
      ]);
   });

   it('does not confuse pulls with the same head ref across different repos', () => {
      const parent = dp(1, 'shared', 'master', { repo: 'iFixit/ifixit' });
      const otherRepoTwin = dp(2, 'shared', 'master', { repo: 'iFixit/server-templates' });
      const child = dp(3, 'child', 'shared', { repo: 'iFixit/ifixit' });
      // child (3) moves to right after its real parent (1); the same-named
      // pull in the other repo (2) can't match it and stays a plain root
      expect(depths(groupIntoTree([parent, otherRepoTwin, child]))).toEqual([
         [1, 0],
         [3, 1],
         [2, 0],
      ]);
   });
});
