import { describe, expect, it } from 'vitest';
import { repoBlocks } from './repoBlocks';
import type { DerivedPull } from './status';

const pull = (repo: string, n: number, starved = false) =>
   ({ data: { repo, number: n }, starved }) as unknown as DerivedPull;

const shape = (r: ReturnType<typeof repoBlocks>) => ({
   starved: r.starved.map(p => p.data.number),
   blocks: r.blocks.map(b => ({ repo: b.repo, nums: b.pulls.map(p => p.data.number) })),
});

describe('repoBlocks', () => {
   it('partitions into contiguous blocks in priority order', () => {
      const queue = [pull('ops', 1), pull('mono', 2), pull('ops', 3), pull('mono', 4)];
      expect(shape(repoBlocks(queue, ['mono', 'ops']))).toEqual({
         starved: [],
         blocks: [
            { repo: 'mono', nums: [2, 4] },
            { repo: 'ops', nums: [1, 3] },
         ],
      });
   });

   it('keeps the incoming order within each block (teammates and score intact)', () => {
      const queue = [pull('ops', 9), pull('ops', 1), pull('ops', 5)];
      expect(shape(repoBlocks(queue, ['ops'])).blocks[0].nums).toEqual([9, 1, 5]);
   });

   it('starved pulls pierce the partition and lead in their own order', () => {
      const queue = [pull('mono', 1), pull('ops', 2, true), pull('mono', 3, true), pull('ops', 4)];
      expect(shape(repoBlocks(queue, ['mono', 'ops']))).toEqual({
         starved: [2, 3],
         blocks: [
            { repo: 'mono', nums: [1] },
            { repo: 'ops', nums: [4] },
         ],
      });
   });

   it('unlisted repos trail the listed ones, ordered by their best pull', () => {
      const queue = [pull('tail-b', 1), pull('mono', 2), pull('tail-a', 3), pull('tail-b', 4)];
      expect(shape(repoBlocks(queue, ['mono'])).blocks.map(b => b.repo)).toEqual([
         'mono',
         'tail-b',
         'tail-a',
      ]);
   });

   it('a priority naming absent repos yields no empty blocks', () => {
      const queue = [pull('mono', 1)];
      expect(shape(repoBlocks(queue, ['ghost', 'mono'])).blocks).toEqual([
         { repo: 'mono', nums: [1] },
      ]);
   });
});
