import { describe, expect, it } from 'vitest';
import { timeSpent, type Touch } from '../../../shared/model/retro';
import type { Project } from '../../../shared/model/projects';
import type { RoadmapItem } from '../../../shared/model/roadmap';
import {
   finishedIn,
   groupRows,
   lastWeek,
   loadByPerson,
   median,
   overloadLine,
   peopleByProject,
   projectLength,
   quietWeeks,
   retroPlan,
   retroRows,
   spreadByPerson,
} from './retro';
import type { RetroData } from './retroData';

const DAY = 86400;
// Monday 2026-09-28, mid-afternoon UTC
const MON = Date.UTC(2026, 8, 28, 15) / 1000;
const touch = (login: string, number: number, day: number, owner: string): Touch => ({
   login,
   at: MON + day * DAY,
   repo: 'iFixit/ifixit',
   number,
   owner,
});

describe('timeSpent', () => {
   it('splits each active day evenly across the PRs touched that day, week by week', () => {
      const rows = timeSpent([
         // Monday: dana opens her PR 1 and stamps erin's PR 2, twice
         touch('dana', 1, 0, 'dana'),
         touch('dana', 2, 0, 'erin'),
         touch('dana', 2, 0, 'erin'),
         // Tuesday: only PR 1; the next Monday, PR 1 again
         touch('dana', 1, 1, 'dana'),
         touch('dana', 1, 7, 'dana'),
      ]);
      const of = (number: number, week: string) =>
         rows.find(r => r.number === number && r.week === week);
      expect(of(1, '2026-09-28')).toMatchObject({ own: true, days: 1.5 });
      expect(of(2, '2026-09-28')).toMatchObject({ own: false, days: 0.5 });
      expect(of(1, '2026-10-05')).toMatchObject({ days: 1 });
      // a person's rows add up to their active days
      expect(rows.reduce((sum, r) => sum + r.days, 0)).toBe(3);
   });

   it('counts only the people it’s told to', () => {
      const rows = timeSpent(
         [touch('dana', 1, 0, 'dana'), touch('renovate[bot]', 1, 0, 'dana')],
         login => !login.endsWith('[bot]')
      );
      expect(rows.map(r => r.login)).toEqual(['dana']);
   });
});

describe('Look back’s groups', () => {
   const pr = (number: number, project: string | null, owner: string, merged: number | null) => ({
      repo: 'iFixit/ifixit',
      number,
      title: `PR ${number}`,
      owner,
      bot: false,
      project,
      state: merged ? ('closed' as const) : ('open' as const),
      merged,
   });
   const data: RetroData = {
      start: '2026-09-28',
      end: '2026-10-11',
      counted: 'developers',
      weeks: ['2026-09-28', '2026-10-05'],
      people: ['dana', 'erin'],
      prs: [
         pr(1, 'alpha', 'dana', MON + DAY),
         pr(2, 'beta', 'erin', null),
         pr(3, null, 'erin', null),
      ],
      rows: [
         [0, 0, 0, 1.5],
         [0, 1, 0, 0.5],
         [1, 1, 0, 1],
         [1, 1, 1, 2],
         [1, 2, 1, 1],
      ],
   };
   const rows = retroRows(data);

   it('reads the compact rows back with who wrote each PR', () => {
      expect(rows.map(r => [r.login, r.pr.number, r.own])).toEqual([
         ['dana', 1, true],
         ['dana', 2, false],
         ['erin', 2, true],
         ['erin', 2, true],
         ['erin', 3, true],
      ]);
   });

   it('adds up days, writing, weeks, people and PRs, the most days first', () => {
      const groups = groupRows(rows, r => r.pr.project ?? '', data);
      expect(groups.map(g => [g.key, g.days, g.writing, g.weekly, g.merged])).toEqual([
         ['beta', 3.5, 3, [1.5, 2], 0],
         ['alpha', 1.5, 1.5, [1.5, 0], 1],
         ['', 1, 1, [0, 1], 0],
      ]);
      expect(groups[0].people).toEqual([
         ['erin', 3],
         ['dana', 0.5],
      ]);
   });

   it('says how many different projects each person touched in a week', () => {
      // dana: alpha and beta in week one; erin: beta, then beta and an unfiled PR
      expect([...spreadByPerson(rows)]).toEqual([
         ['dana', 2],
         ['erin', 1.5],
      ]);
      expect(median([3, 1, 2])).toBe(2);
      expect(median([])).toBe(0);
   });

   it('says who worked on each filed project, and how', () => {
      const by = peopleByProject(rows);
      expect([...by.keys()].sort()).toEqual(['alpha', 'beta']);
      expect(by.get('beta')).toEqual([
         { login: 'erin', days: 3, writing: 3 },
         { login: 'dana', days: 0.5, writing: 0 },
      ]);
   });

   it('counts each person’s projects, writing and reviewing, zeros included', () => {
      const [dana, erin, finn] = loadByPerson(rows, ['dana', 'erin', 'finn']);
      expect(dana).toMatchObject({
         days: 2,
         reviewing: 0.5,
         unfiled: 0,
         wrote: 1,
         reviewedOnly: 1,
         reviewed: 1,
      });
      expect(dana.projects.map(p => p.slug)).toEqual(['alpha', 'beta']);
      // erin's unlabeled PR counts toward her days but no project
      expect(erin).toMatchObject({ days: 4, reviewing: 0, unfiled: 1, wrote: 1, reviewedOnly: 0 });
      expect(finn).toMatchObject({ days: 0, projects: [], wrote: 0 });
   });

   it('draws the overload line at twice the median, and never under 4', () => {
      // the counts from Sep 30: the median is 2.5, so the line is 5
      expect(overloadLine([7, 6, 6, 6, 4, 4, 3, 3, 3, 2, 2, 1, 1, 1, 0, 0, 0, 0])).toBe(5);
      expect(overloadLine([1, 1, 0])).toBe(4);
      expect(overloadLine([])).toBe(4);
   });
});

describe('Look back’s project columns', () => {
   it('finds the longest pause between the first and last busy week', () => {
      expect(quietWeeks([0, 2, 0, 0, 1, 0, 3, 0])).toBe(2);
      expect(quietWeeks([1, 1])).toBe(0);
      expect(quietWeeks([0, 0])).toBe(0);
      expect(lastWeek([0, 2, 0])).toBe(1);
      expect(lastWeek([0, 0])).toBe(-1);
   });

   it('says how long a project ran: open at the range’s end, or done', () => {
      const w = { first_opened: '2026-08-01', last_closed: '2026-09-15', backlog_end: 0 };
      expect(projectLength(w, '2026-09-30')).toEqual({ open: false, days: 45 });
      expect(projectLength({ ...w, backlog_end: 2 }, '2026-09-30')).toEqual({
         open: true,
         days: 61,
      });
      expect(projectLength(null, '2026-09-30')).toBeNull();
   });

   const plan = (over: Partial<RoadmapItem>): RoadmapItem => ({
      id: 1,
      name: 'Workbench',
      project: 'workbench',
      team: null,
      lead: null,
      status: 'active',
      origin: null,
      start: '2026-08-03',
      weeks: 4,
      priority: 1,
      notes: '',
      waits_on: [],
      updated_by: null,
      updated_at: null,
      created_at: null,
      update: null,
      ...over,
   });
   // the plan ends Sunday, Aug 30
   const at = (day: string) => Date.parse(`${day}T12:00:00Z`) / 1000;

   it('judges each plan’s outcome as of today', () => {
      const today = '2026-09-30';
      expect(retroPlan(plan({ status: 'done', updated_at: at('2026-08-28') }), today).text).toBe(
         'done on time'
      );
      expect(retroPlan(plan({ status: 'done', updated_at: at('2026-09-10') }), today).text).toBe(
         'done 2 wk late'
      );
      expect(retroPlan(plan({}), today).text).toBe('open, 5 wk past its end');
      expect(retroPlan(plan({ start: '2026-09-28' }), today).text).toBe('ends Oct 25');
      expect(retroPlan(plan({ status: 'parked' }), today).kind).toBe('parked');
      expect(retroPlan(null, today).text).toBe('no plan');
   });

   it('dates a finish by when it was marked done, not by a later edit', () => {
      const today = '2026-09-30';
      // done Aug 28, its notes edited Sep 10
      const edited = plan({
         status: 'done',
         status_at: at('2026-08-28'),
         updated_at: at('2026-09-10'),
      });
      expect(retroPlan(edited, today).text).toBe('done on time');
      expect(finishedIn([edited], [], { start: '2026-09-01', end: '2026-09-30' })).toEqual([]);
   });

   it('counts what finished in a range, once each, on time or late', () => {
      const project = (slug: string, closed: string | null, reason = 'completed'): Project => ({
         slug,
         name: slug,
         repo: 'iFixit/projects',
         number: 1,
         state: closed ? 'closed' : 'open',
         state_reason: closed ? reason : null,
         ongoing: false,
         parents: [],
         lead: null,
         target: null,
         fields: { start: null, target: null, priority: null },
         created_at: null,
         closed_at: closed ? `${closed}T10:00:00Z` : null,
      });
      const done = finishedIn(
         [plan({ status: 'done', updated_at: at('2026-09-10') })],
         [
            // its plan already counts it
            project('workbench', '2026-09-11'),
            project('search', '2026-09-20'),
            project('dropped-one', '2026-09-20', 'not_planned'),
            project('older', '2026-07-01'),
         ],
         { start: '2026-09-01', end: '2026-09-30' }
      );
      expect(done).toEqual([
         { key: 'workbench', name: 'Workbench', onTime: false },
         { key: 'search', name: 'search', onTime: null },
      ]);
   });
});
