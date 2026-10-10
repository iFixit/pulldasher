import { describe, expect, it } from 'vitest';
import {
   checkDecideRotation,
   checkDeveloperTeams,
   decideTurn,
} from '../../../shared/model/settings';

describe('checkDeveloperTeams', () => {
   it('trims names and logins, and counts a login listed twice in a team once', () => {
      expect(checkDeveloperTeams({ ' Store ': ['dana', ' erin', 'Dana'] })).toEqual({
         teams: { Store: ['dana', 'erin'] },
      });
      expect(checkDeveloperTeams(null)).toEqual({ teams: null });
   });

   it('refuses what it can’t count: a login on two teams, a bad login, a bad shape', () => {
      const error = (input: unknown) => (checkDeveloperTeams(input) as { error: string }).error;
      expect(error({ Store: ['dana'], FixBot: ['DANA'] })).toMatch(/both Store and FixBot/);
      expect(error({ Store: ['not a login'] })).toMatch(/isn't a GitHub login/);
      expect(error({ Store: 'dana' })).toMatch(/list/);
      expect(error(['Store'])).toMatch(/object/);
      expect(error({ '': ['dana'] })).toMatch(/team name/);
   });
});

describe('the Decide rotation', () => {
   it('takes logins in turn order, trimmed, each once; none is nobody', () => {
      expect(checkDecideRotation([' dana', 'erin', 'Dana'])).toEqual({ logins: ['dana', 'erin'] });
      expect(checkDecideRotation([])).toEqual({ logins: null });
      expect(checkDecideRotation(null)).toEqual({ logins: null });
      expect(checkDecideRotation('dana')).toHaveProperty('error');
      expect(checkDecideRotation(['two words'])).toHaveProperty('error');
   });

   it('gives each a week in turn, from the first Monday, the same any day of the week', () => {
      const rotation = { logins: ['dana', 'erin', 'finn'], from: '2026-09-28' };
      expect(decideTurn(rotation, '2026-09-28')).toBe('dana');
      expect(decideTurn(rotation, '2026-10-04')).toBe('dana');
      expect(decideTurn(rotation, '2026-10-05')).toBe('erin');
      expect(decideTurn(rotation, '2026-10-19')).toBe('dana');
      // before it started, the turns run backward the same way
      expect(decideTurn(rotation, '2026-09-21')).toBe('finn');
      expect(decideTurn(null, '2026-10-05')).toBeNull();
   });
});
