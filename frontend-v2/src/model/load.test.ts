import { describe, expect, it } from 'vitest';
import type { RoadmapItem } from '../../../shared/model/roadmap';
import {
   loadByWeek,
   mondaysBetween,
   peakFrom,
   spansFrom,
   weekMembers,
} from '../../../shared/model/load';

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
   created_at: null,
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

   it('counts ahead, if nothing changes: plans to their end, open work with no decision', () => {
      // plan 1 runs to Oct 11 and plan 3 starts Oct 5; plan 2 (no PRs) ended
      // Oct 4; c is still open, and its only item was dropped, a decision
      expect(load[3]).toEqual({ week: '2026-10-05', onPlan: 2, offPlan: 0, projected: true });
   });

   it('keeps an overrun plan and undecided open work in every week ahead', () => {
      const later = loadByWeek({
         weeks: ['2026-11-02'],
         today,
         plans: [plan(1, { project: 'a', status: 'active', start: '2026-08-03', weeks: 4 })],
         spans: [
            { slug: 'a', start: '2026-08-03', end: null },
            { slug: 'z', start: '2026-09-01', end: null },
            { slug: 'p', start: '2026-09-01', end: null },
            { slug: 'q', start: '2026-09-01', end: '2026-09-20' },
         ],
      });
      // a ran past its Aug 30 end and is still open; z has no decision; q closed
      expect(later[0]).toEqual({ week: '2026-11-02', onPlan: 1, offPlan: 2, projected: true });
   });

   it('drops parked and finished work from the weeks ahead', () => {
      const ahead = loadByWeek({
         weeks: ['2026-11-02'],
         today,
         plans: [
            plan(1, { project: 'a', status: 'parked' }),
            plan(2, { project: 'b', status: 'done' }),
         ],
         spans: [
            { slug: 'a', start: '2026-09-01', end: null },
            { slug: 'b', start: '2026-09-01', end: null },
         ],
      });
      expect(ahead[0]).toEqual({ week: '2026-11-02', onPlan: 0, offPlan: 0, projected: true });
   });

   it('counts a project once however many of its plans run, and only named work ahead', () => {
      const plans = [
         plan(1, { project: 'a', status: 'active', start: '2026-10-05', weeks: 4 }),
         plan(2, { project: 'a', start: '2026-10-12', weeks: 4 }),
      ];
      const spans = [
         { slug: 'a', start: '2026-09-01', end: null },
         { slug: 'big', start: '2026-09-01', end: null },
         { slug: 'small', start: '2026-09-01', end: null },
      ];
      const [week] = loadByWeek({
         weeks: ['2026-10-19'],
         today,
         plans,
         spans,
         ahead: new Set(['big']),
      });
      // a counts once for its two plans; small ships without a plan
      expect(week).toEqual({ week: '2026-10-19', onPlan: 1, offPlan: 1, projected: true });
      // a picked week's rows are exactly what it counts
      const members = weekMembers({ today, plans, spans, ahead: new Set(['big']) })('2026-10-19');
      expect([...members.projects]).toEqual([
         ['a', 'on'],
         ['big', 'off'],
      ]);
      expect([...members.plans]).toEqual([1, 2]);
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

describe('spansFrom', () => {
   it('runs open projects to today and closed ones to their last close', () => {
      expect(
         spansFrom(
            {
               a: { first_opened: '2026-08-01', last_closed: '2026-09-02' },
               b: { first_opened: '2026-07-01', last_closed: '2026-07-20' },
               misc: { first_opened: '2026-07-01', last_closed: '2026-09-20' },
            },
            { a: '2026-08-05', c: '2026-09-10' },
            '2026-08-01'
         )
      ).toEqual([
         { slug: 'a', start: '2026-08-01', end: null },
         { slug: 'c', start: '2026-09-10', end: null },
      ]);
   });
});
