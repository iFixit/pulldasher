import { describe, expect, it } from 'vitest';
import { timeSpent, type Touch } from '../../../shared/model/retro';
import { groupRows, median, retroRows, spreadByPerson } from './retro';
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
});
