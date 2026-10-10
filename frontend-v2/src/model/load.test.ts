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
   origin: null,
   start: '2026-09-14',
   weeks: 4,
   // a commitment, the end these tests ask about
   end_kind: 'hard',
   done_when: '',
   priority: id,
   notes: '',
   waits_on: [],
   updated_by: null,
   updated_at: null,
   created_at: null,
   update: null,
   ...over,
});

/** a week's plans on the roadmap, none saying where their work came from */
const unsaid = (count: number) => ({ asked: 0, fire: 0, chosen: 0, unsaid: count });

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
         { week: '2026-09-14', onPlan: 1, origins: unsaid(1), offPlan: 1, projected: false },
         { week: '2026-09-21', onPlan: 2, origins: unsaid(2), offPlan: 1, projected: false },
         // b closed on the 25th; c opened on the 29th, and its plan was dropped
         { week: '2026-09-28', onPlan: 2, origins: unsaid(2), offPlan: 1, projected: false },
      ]);
   });

   it('counts ahead, if nothing changes: plans to their end, open work with no decision', () => {
      // plan 1 runs to Oct 11 and plan 3 starts Oct 5; plan 2 (no PRs) ended
      // Oct 4; c is still open, and its only item was dropped, a decision
      expect(load[3]).toEqual({
         week: '2026-10-05',
         onPlan: 2,
         origins: unsaid(2),
         offPlan: 0,
         projected: true,
      });
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
      expect(later[0]).toEqual({
         week: '2026-11-02',
         onPlan: 1,
         origins: unsaid(1),
         offPlan: 2,
         projected: true,
      });
   });

   it('counts ongoing work in every week from its start, with no end to stop at', () => {
      const ahead = loadByWeek({
         weeks: ['2027-03-01'],
         today,
         plans: [
            plan(1, { project: 'a', status: 'active', start: '2026-08-03', end_kind: 'ongoing' }),
            plan(2, { status: 'active', start: '2026-08-03', end_kind: 'ongoing' }),
         ],
         spans: [{ slug: 'a', start: '2026-08-03', end: '2026-09-20' }],
      });
      expect(ahead[0].onPlan).toBe(2);
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
      expect(ahead[0]).toEqual({
         week: '2026-11-02',
         onPlan: 0,
         origins: unsaid(0),
         offPlan: 0,
         projected: true,
      });
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
      expect(week).toEqual({
         week: '2026-10-19',
         onPlan: 1,
         origins: unsaid(1),
         offPlan: 1,
         projected: true,
      });
      // a picked week's rows are exactly what it counts
      const members = weekMembers({ today, plans, spans, ahead: new Set(['big']) })('2026-10-19');
      expect([...members.projects]).toEqual([
         ['a', 'on'],
         ['big', 'off'],
      ]);
      expect([...members.plans]).toEqual([1, 2]);
   });

   it('splits the plans on the roadmap by where the work came from', () => {
      const [week] = loadByWeek({
         weeks: ['2026-09-28'],
         today,
         plans: [
            // a's first plan under way speaks for it, as on its row
            plan(1, { project: 'a', status: 'active', origin: 'fire' }),
            plan(2, { project: 'a', start: '2026-11-02', origin: 'asked' }),
            // a plan with no PRs counts by its own word
            plan(3, { status: 'active', start: '2026-09-21', origin: 'chosen' }),
            plan(4, { project: 'd', status: 'active' }),
         ],
         spans: [
            { slug: 'a', start: '2026-09-01', end: null },
            { slug: 'd', start: '2026-09-01', end: null },
            { slug: 'e', start: '2026-09-01', end: null },
         ],
      });
      expect(week.onPlan).toBe(3);
      expect(week.origins).toEqual({ asked: 0, fire: 1, chosen: 1, unsaid: 1 });
      // work with no plan has no origin: it stays in offPlan
      expect(week.offPlan).toBe(1);
   });
});

describe('peakFrom', () => {
   it('finds the busiest week from this one on', () => {
      const week = (w: string, onPlan: number, offPlan: number) => ({
         week: w,
         onPlan,
         origins: { asked: 0, fire: 0, chosen: 0, unsaid: onPlan },
         offPlan,
         projected: false,
      });
      const weeks = [week('2026-09-21', 9, 9), week('2026-09-28', 1, 2), week('2026-10-05', 2, 2)];
      expect(peakFrom(weeks, '2026-09-30')).toEqual({ count: 4, week: '2026-10-05' });
      expect(peakFrom([], '2026-09-30')).toBeNull();
   });
});

describe('spansFrom', () => {
   it('runs open projects from their oldest open PR to today, closed ones to their last close', () => {
      expect(
         spansFrom(
            {
               a: { first_opened: '2026-08-01', last_closed: '2026-09-02' },
               b: { first_opened: '2026-07-01', last_closed: '2026-07-20' },
               misc: { first_opened: '2026-07-01', last_closed: '2026-09-20' },
               d: { first_opened: '2026-08-10', last_closed: null },
            },
            { a: '2026-08-05', c: '2026-09-10', d: null },
            '2026-08-01'
         )
      ).toEqual([
         { slug: 'a', start: '2026-08-05', end: null },
         { slug: 'c', start: '2026-09-10', end: null },
         // no open PR day known: the window's first PR
         { slug: 'd', start: '2026-08-10', end: null },
      ]);
   });
});
