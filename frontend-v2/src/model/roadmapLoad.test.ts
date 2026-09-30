import { describe, expect, it } from 'vitest';
import type { RoadmapItem } from '../../../shared/model/roadmap';
import { loadByWeek, mondaysBetween, peakFrom } from './roadmapLoad';

const plan = (id: number, over: Partial<RoadmapItem>): RoadmapItem => ({
   id,
   name: `Plan ${id}`,
   project: null,
   team: null,
   lead: null,
   status: 'planned',
   start: '2026-09-14',
   weeks: 4,
   priority: id,
   notes: '',
   waits_on: [],
   updated_by: null,
   updated_at: null,
   update: null,
   ...over,
});

describe('loadByWeek', () => {
   const weeks = mondaysBetween('2026-09-16', '2026-10-12');
   const today = '2026-09-30';
   const load = loadByWeek({
      weeks,
      today,
      plans: [
         plan(1, { project: 'a', status: 'active', start: '2026-09-14', weeks: 4 }), // to Oct 11
         plan(2, { status: 'active', start: '2026-09-21', weeks: 2 }), // no PRs, to Oct 4
         plan(3, { start: '2026-10-05', weeks: 2 }),
         plan(4, { project: 'c', status: 'dropped' }),
      ],
      spans: [
         { slug: 'a', start: '2026-09-01', end: null },
         { slug: 'b', start: '2026-09-20', end: '2026-09-25' },
         { slug: 'c', start: '2026-09-29', end: null },
      ],
   });

   it('walks whole weeks from Monday', () => {
      expect(weeks).toEqual(['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']);
   });

   it('counts what the PRs did up to this week, and plans under way with no PRs', () => {
      expect(load.slice(0, 3)).toEqual([
         { week: '2026-09-14', onPlan: 1, offPlan: 1, projected: false },
         { week: '2026-09-21', onPlan: 2, offPlan: 1, projected: false },
         // b closed on the 25th; c opened on the 29th, and its plan was dropped
         { week: '2026-09-28', onPlan: 2, offPlan: 1, projected: false },
      ]);
   });

   it('counts only the plan after this week', () => {
      expect(load[3]).toEqual({ week: '2026-10-05', onPlan: 2, offPlan: 0, projected: true });
   });
});

describe('peakFrom', () => {
   it('finds the busiest week from this one on', () => {
      const week = (w: string, onPlan: number, offPlan: number) => ({
         week: w,
         onPlan,
         offPlan,
         projected: false,
      });
      const weeks = [week('2026-09-21', 9, 9), week('2026-09-28', 1, 2), week('2026-10-05', 2, 2)];
      expect(peakFrom(weeks, '2026-09-30')).toEqual({ count: 4, week: '2026-10-05' });
      expect(peakFrom([], '2026-09-30')).toBeNull();
   });
});
