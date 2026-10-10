import { dayWords } from './projectData';
import { describe, expect, it } from 'vitest';
import { timeSpent, type Touch } from '../../../shared/model/retro';
import type { Project } from '../../../shared/model/projects';
import type { RoadmapItem } from '../../../shared/model/roadmap';
import {
   beforeWords,
   chartWeeks,
   finishedIn,
   finishedOn,
   groupRows,
   lastWeek,
   loadByPerson,
   median,
   mergeSpeed,
   overloaded,
   overloadLine,
   peopleByProject,
   projectLength,
   quietWeeks,
   retroCsv,
   retroPlan,
   retroRows,
   spreadByPerson,
   tooManyWords,
   weekBars,
   weeklyBy,
   weekTitle,
   weekWords,
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

   it('adds up days, people and PRs, the most days first', () => {
      const groups = groupRows(rows, r => r.pr.project ?? '');
      expect(groups.map(g => [g.key, g.days])).toEqual([
         ['beta', 3.5],
         ['alpha', 1.5],
         ['', 1],
      ]);
      expect(groups[0].people).toEqual([
         ['erin', 3],
         ['dana', 0.5],
      ]);
   });

   it('draws every week of the chart, the empty ones too, by each week’s Monday', () => {
      // the chart starts a week before the data's first week, with nothing in it
      const weeks = chartWeeks(
         { start: '2026-09-21', end: '2026-10-11' },
         { start: '2026-09-28', end: '2026-10-11' }
      );
      const weekly = weeklyBy(rows, r => r.pr.project ?? '', data, weeks);
      expect(weekly.get('beta')).toEqual([0, 1.5, 2]);
      expect(weekly.get('')).toEqual([0, 0, 1]);
   });

   it('says how many different projects each person touched in a week', () => {
      // dana: alpha and beta in week one; erin: beta, then beta and an
      // unfiled PR, which isn't a project
      expect([...spreadByPerson(rows)]).toEqual([
         ['dana', 2],
         ['erin', 1],
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

   it('flags who wrote for the line or more, and no one when over a quarter would be', () => {
      const load = (login: string, wrote: number) => ({ login, wrote });
      const team = [load('amy', 6), load('bob', 1), load('cy', 0), load('di', 2), load('ed', 1)];
      expect(overloaded(team, 4).map(l => l.login)).toEqual(['amy']);
      // two of six is more than a quarter: the flag says nothing
      expect(overloaded([...team, load('fay', 4)], 4)).toEqual([]);
      expect(overloaded([], 4)).toEqual([]);
   });

   it('says how many cross when too many do to single out, never a bare zero', () => {
      const load = (wrote: number) => ({ wrote });
      const team = [load(6), load(1), load(0), load(2), load(1)];
      expect(tooManyWords(team, 4)).toBeNull();
      expect(tooManyWords([...team, load(4)], 4)).toBe('2 of 6 wrote for 4 or more');
      expect(tooManyWords([], 4)).toBeNull();
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
      // the days gone by, as the Overview counts its age: not 61, the days touched
      expect(projectLength({ ...w, backlog_end: 2 }, '2026-09-30')).toEqual({
         open: true,
         days: 60,
      });
      // still open: from its oldest open PR, as Decide says
      expect(projectLength({ ...w, backlog_end: 2 }, '2026-09-30', '2026-09-10')).toEqual({
         open: true,
         days: 20,
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
      // a commitment, the end these tests ask about
      end_kind: 'hard',
      done_when: '',
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

   it('judges each plan’s outcome as of today, in the tab’s words', () => {
      const today = '2026-09-30';
      expect(retroPlan(plan({ status: 'done', updated_at: at('2026-08-28') }), today).text).toBe(
         'Done on time'
      );
      expect(retroPlan(plan({ status: 'done', updated_at: at('2026-09-10') }), today).text).toBe(
         'Done 2 weeks late'
      );
      expect(retroPlan(plan({}), today).text).toBe('5 weeks overdue');
      expect(retroPlan(plan({ start: '2026-09-28' }), today).text).toBe('Ends Oct 25');
      expect(retroPlan(plan({ status: 'parked' }), today).kind).toBe('parked');
      expect(retroPlan(null, today).text).toBe('No plan');
      // only a hard end run past is owed a call; ongoing work has no end
      expect(retroPlan(plan({ end_kind: 'soft' }), today)).toEqual({
         kind: 'open',
         text: '5 weeks past its estimate',
      });
      expect(retroPlan(plan({ end_kind: 'ongoing' }), today).text).toBe('Ongoing');
   });

   it('dates a finish by when it was marked done, not by a later edit', () => {
      const today = '2026-09-30';
      // done Aug 28, its notes edited Sep 10
      const edited = plan({
         status: 'done',
         status_at: at('2026-08-28'),
         updated_at: at('2026-09-10'),
      });
      expect(retroPlan(edited, today).text).toBe('Done on time');
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

   it('counts a team’s finished plans as the ones it worked on', () => {
      const done = [
         { key: 'alpha', name: 'Alpha', onTime: true },
         { key: 'gamma', name: 'Gamma', onTime: false },
      ];
      const pr = {
         repo: 'r',
         number: 1,
         title: '',
         owner: 'dana',
         bot: false,
         state: 'open' as const,
         merged: null,
      };
      const rows = [
         { login: 'dana', pr: { ...pr, project: 'alpha' }, week: 0, days: 1, own: true },
      ];
      expect(finishedOn(done, rows).map(f => f.key)).toEqual(['alpha']);
   });
});

describe('Look back’s words', () => {
   it('compares a one-day range with the day before, not "the 1 days before"', () => {
      expect(beforeWords(1)).toBe('day before');
      expect(beforeWords(30)).toBe('30 days before');
   });

   it('says "half" of the merged PRs only when there are several', () => {
      expect(mergeSpeed(1, 2)).toBe('2 days after it opened');
      // in the words a person says a time, as the project page does
      expect(mergeSpeed(16, 0.3)).toBe('half of them within about 7 hours of opening');
      expect(mergeSpeed(0, null)).toBeNull();
   });
});

describe('the weeks a chart draws', () => {
   it('fills every Monday from the first day, pales the ones before the range, and counts cut-off days', () => {
      // 90 days to Thursday Oct 1: the window starts Friday Jul 4
      const weeks = chartWeeks(
         { start: '2026-07-04', end: '2026-10-01' },
         { start: '2026-09-25', end: '2026-10-01' }
      );
      expect(weeks).toHaveLength(14);
      expect(weeks[0]).toEqual({ week: '2026-06-29', days: 2, counted: 0, before: true });
      // Sep 21 to 27 holds the range's first three days: not before it, and
      // only those three count
      expect(weeks[12]).toEqual({ week: '2026-09-21', days: 7, counted: 3, before: false });
      expect(weeks[11].before).toBe(true);
      expect(weeks[13]).toEqual({ week: '2026-09-28', days: 4, counted: 4, before: false });
      expect(weeks.map(weekTitle).slice(11)).toEqual([
         'Week of Sep 14, before the range',
         'Week of Sep 21, 3 of 7 days in the range',
         'Week of Sep 28, 4 of 7 days',
      ]);
   });

   it('draws the days before the range paler, the week the range starts in split in two', () => {
      const weeks = chartWeeks(
         { start: '2026-07-04', end: '2026-10-01' },
         { start: '2026-09-25', end: '2026-10-01' }
      ).slice(11);
      // the chart's days count 9, 28 and 6 a week; the range's own, 14 and 6
      const bars = weekBars([9, 28, 6], [0, 14, 6], weeks);
      expect(bars).toEqual({ counted: [0, 14, 6], before: [9, 14, 0] });
      // without the range's own numbers, a week the range cuts counts whole
      expect(weekBars([9, 28, 6], undefined, weeks)).toEqual({
         counted: [0, 28, 6],
         before: [9, 0, 0],
      });
   });

   it('gives a week its year when it isn’t this one', () => {
      const oct1 = Date.UTC(2026, 9, 1, 12) / 1000;
      expect(weekWords('2025-09-29', oct1)).toBe('Sep 29, 2025');
      expect(weekWords('2026-09-28', oct1)).toBe('Sep 28');
   });

   it('prints the year on any day outside this year, and only then', () => {
      const oct1 = Date.UTC(2026, 9, 1, 12);
      expect(dayWords('2025-10-17', { now: oct1 })).toBe('Oct 17, 2025');
      expect(dayWords('2026-10-17', { now: oct1 })).toBe('Oct 17');
   });
});

describe('the CSV', () => {
   it('writes a line per person, PR and week, defusing a title that reads as a formula', () => {
      const pr = {
         repo: 'iFixit/ifixit',
         number: 7,
         title: '=HYPERLINK("x"), then more',
         owner: 'dana',
         bot: false,
         project: 'alpha',
         state: 'open' as const,
         merged: null,
      };
      const csv = retroCsv(
         [{ login: 'erin', pr, week: 0, days: 0.5, own: false }],
         { weeks: ['2026-09-28'] },
         login => (login === 'erin' ? 'Store' : null),
         slug => (slug === 'alpha' ? 'Alpha' : slug)
      );
      expect(csv.split('\n')[1]).toBe(
         '2026-09-28,erin,Store,reviewing,0.5,iFixit/ifixit#7,"\'=HYPERLINK(""x""), then more",Alpha'
      );
   });
});
