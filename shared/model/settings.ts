/**
 * The settings people change from the board or the API, checked by the same
 * code on both sides. Today that's the developer teams: who counts as a
 * developer, and on which team, for every developer split and every load
 * line. Saved ones replace config.js's projects.developerTeams; null goes
 * back to config.js.
 */

const TEAM_MAX = 64;
const TEAMS_MAX = 30;
const MEMBERS_MAX = 200;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export type DeveloperTeams = Record<string, string[]>;

/**
 * Check developer teams as a person sent them: an object of team name to
 * GitHub logins. Names and logins are trimmed, a login listed twice in one
 * team counts once, and a login on two teams is refused, since a developer's
 * work can only count toward one team's load.
 */
export function checkDeveloperTeams(
   input: unknown
): { teams: DeveloperTeams | null } | { error: string } {
   if (input === null) return { teams: null };
   if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { error: 'send developer_teams as an object of team name to logins, or null' };
   }
   const entries = Object.entries(input as Record<string, unknown>);
   if (entries.length > TEAMS_MAX) return { error: `at most ${TEAMS_MAX} teams` };
   const teams: DeveloperTeams = {};
   const teamOf = new Map<string, string>();
   for (const [rawName, logins] of entries) {
      const name = rawName.trim();
      if (!name || name.length > TEAM_MAX) {
         return { error: `a team name is 1 to ${TEAM_MAX} characters` };
      }
      if (teams[name]) return { error: `the team ${name} is listed twice` };
      if (!Array.isArray(logins) || logins.length > MEMBERS_MAX) {
         return { error: `${name}'s members are a list of up to ${MEMBERS_MAX} GitHub logins` };
      }
      const members: string[] = [];
      for (const raw of logins) {
         const login = typeof raw === 'string' ? raw.trim() : '';
         if (!LOGIN.test(login)) return { error: `${String(raw)} isn't a GitHub login` };
         const key = login.toLowerCase();
         const other = teamOf.get(key);
         if (other === name) continue;
         if (other) return { error: `${login} is on both ${other} and ${name}` };
         teamOf.set(key, name);
         members.push(login);
      }
      teams[name] = members;
   }
   return { teams };
}
