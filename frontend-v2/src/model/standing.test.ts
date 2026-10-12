import { describe, expect, it } from 'vitest';
import type { DerivedPull } from '../../../shared/model/status';
import { pullStanding, type ProjectStanding } from './standing';

/** An open PR with just what pullStanding reads: its key and labels. */
function pr(number: number, labels: string[] = []): Pick<DerivedPull, 'data'> {
   return {
      data: { repo: 'org/repo', number, labels: labels.map(title => ({ title })) },
   } as unknown as Pick<DerivedPull, 'data'>;
}

const standing = (over: Partial<ProjectStanding> = {}): ProjectStanding => ({
   pull_links: {},
   plans: {},
   ...over,
});

describe('pullStanding', () => {
   it("names a parked project's PRs, by label or by the issue they link", () => {
      const s = pullStanding(
         standing({
            pull_links: { 'org/repo#2': ['picker'] },
            plans: { picker: { status: 'parked', in_progress: false } },
         }),
         [pr(1, ['project:picker']), pr(2), pr(3)],
         'project:'
      );
      expect([...s.parked]).toEqual([
         ['org/repo#1', 'picker'],
         ['org/repo#2', 'picker'],
      ]);
      expect(s.finishing.size).toBe(0);
   });

   it('files a PR by its label before a link, as the Projects tab does', () => {
      const s = pullStanding(
         standing({
            pull_links: { 'org/repo#1': ['picker'] },
            plans: { picker: { status: 'parked', in_progress: false } },
         }),
         [pr(1, ['project:sync'])],
         'project:'
      );
      expect(s.parked.size).toBe(0);
   });

   it('marks the last two open PRs of a plan in progress, not a third', () => {
      const plans = { sync: { status: 'active' as const, in_progress: true } };
      const two = pullStanding(
         standing({ plans }),
         [pr(1, ['project:sync']), pr(2, ['project:sync'])],
         'project:'
      );
      expect([...two.finishing]).toEqual([
         ['org/repo#1', { slug: 'sync', left: 2 }],
         ['org/repo#2', { slug: 'sync', left: 2 }],
      ]);
      const three = pullStanding(
         standing({ plans }),
         [pr(1, ['project:sync']), pr(2, ['project:sync']), pr(3, ['project:sync'])],
         'project:'
      );
      expect(three.finishing.size).toBe(0);
   });

   it('finishes nothing for a plan not under way, or work filed as one-offs', () => {
      const s = pullStanding(
         standing({
            plans: {
               later: { status: 'planned', in_progress: false },
               misc: { status: 'active', in_progress: true },
            },
         }),
         [pr(1, ['project:later']), pr(2, ['project:misc'])],
         'project:'
      );
      expect(s.finishing.size).toBe(0);
   });

   it('says nothing before the standing loads, or with no projects', () => {
      const parked = { plans: { picker: { status: 'parked' as const, in_progress: false } } };
      expect(pullStanding(null, [pr(1, ['project:picker'])], 'project:').parked.size).toBe(0);
      expect(pullStanding(standing(parked), [pr(1, ['project:picker'])], null).parked.size).toBe(0);
   });
});
