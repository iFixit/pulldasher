import { describe, expect, it } from 'vitest';
import { checkDeveloperTeams } from '../../../shared/model/settings';

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
