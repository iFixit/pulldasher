import { describe, expect, it } from 'vitest';
import { groupTime, timeSpent, type Touch } from '../../../shared/model/retro';

const DAY = 86400;
const MON = Date.UTC(2026, 8, 28, 15) / 1000;
const touch = (login: string, number: number, day: number, owner: string): Touch => ({
   login,
   at: MON + day * DAY,
   repo: 'iFixit/ifixit',
   number,
   owner,
});

describe('timeSpent', () => {
   it('splits each active day evenly across the PRs touched that day', () => {
      const rows = timeSpent([
         // Monday: dana opens her PR 1 and stamps erin's PR 2, twice
         touch('dana', 1, 0, 'dana'),
         touch('dana', 2, 0, 'erin'),
         touch('dana', 2, 0, 'erin'),
         // Tuesday: only PR 1
         touch('dana', 1, 1, 'dana'),
         // erin comments on her own PR on Monday
         touch('erin', 2, 0, 'erin'),
      ]);
      const of = (login: string, number: number) =>
         rows.find(r => r.login === login && r.number === number);
      expect(of('dana', 1)).toMatchObject({ own: true, days: 1.5 });
      expect(of('dana', 2)).toMatchObject({ own: false, days: 0.5 });
      expect(of('erin', 2)).toMatchObject({ own: true, days: 1 });
      // each person's rows add up to their active days
      expect(rows.filter(r => r.login === 'dana').reduce((sum, r) => sum + r.days, 0)).toBe(2);
   });

   it('counts only the people it’s told to', () => {
      const rows = timeSpent(
         [touch('dana', 1, 0, 'dana'), touch('renovate[bot]', 1, 0, 'dana')],
         login => !login.endsWith('[bot]')
      );
      expect(rows.map(r => r.login)).toEqual(['dana']);
   });
});

describe('groupTime', () => {
   it('adds up days, writing, and people, the most days first', () => {
      const rows = timeSpent([
         touch('dana', 1, 0, 'dana'),
         touch('erin', 1, 0, 'dana'),
         touch('erin', 3, 1, 'erin'),
         touch('finn', 3, 1, 'erin'),
         touch('finn', 3, 2, 'erin'),
      ]);
      const project = (n: number) => (n === 1 ? 'alpha' : 'beta');
      expect(groupTime(rows, r => project(r.number))).toEqual([
         { key: 'beta', days: 3, writing: 1, people: ['finn', 'erin'] },
         { key: 'alpha', days: 2, writing: 1, people: ['dana', 'erin'] },
      ]);
   });
});
