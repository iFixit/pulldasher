import { dayStart } from './projects';
import { mondayOf, PROJECT_SLUG } from './roadmap';

/**
 * The settings people change from the board or the API, checked by the same
 * code on both sides: the developer teams (who counts as a developer, and on
 * which team, for every developer split and every load line; saved ones
 * replace config.js's projects.developerTeams, and null goes back to
 * config.js), and who takes turns running Decide.
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

const ROTATION_MAX = 50;
const WEEK = 7 * 86400;

/** Who takes turns running Decide, a week each, in this order; `from` is
 * the Monday of the week the first of them runs. */
export interface DecideRotation {
   logins: string[];
   from: string;
}

/**
 * Check who takes turns running Decide, as a person sent it: GitHub logins
 * in turn order. Logins are trimmed and one listed twice counts once. Null,
 * or no one, means nobody runs it.
 */
export function checkDecideRotation(
   input: unknown
): { logins: string[] | null } | { error: string } {
   if (input === null) return { logins: null };
   if (!Array.isArray(input) || input.length > ROTATION_MAX) {
      return {
         error: `send decide_rotation as a list of up to ${ROTATION_MAX} GitHub logins, or null`,
      };
   }
   const logins: string[] = [];
   const seen = new Set<string>();
   for (const raw of input) {
      const login = typeof raw === 'string' ? raw.trim() : '';
      if (!LOGIN.test(login)) return { error: `${String(raw)} isn't a GitHub login` };
      if (seen.has(login.toLowerCase())) continue;
      seen.add(login.toLowerCase());
      logins.push(login);
   }
   return { logins: logins.length ? logins : null };
}

/** Whose turn it is to run Decide in the week holding `day`: every reader
 * counts the same whole weeks from the rotation's first Monday. Null with
 * nobody in it. */
export function decideTurn(rotation: DecideRotation | null, day: string): string | null {
   if (!rotation?.logins.length) return null;
   const weeks = Math.round(
      ((dayStart(mondayOf(day)) as number) - (dayStart(rotation.from) as number)) / WEEK
   );
   const count = rotation.logins.length;
   return rotation.logins[((weeks % count) + count) % count];
}

const SLUG = PROJECT_SLUG;
const ONGOING_MAX = 500;

/** Check the projects marked ongoing as a person sent them: a list of
 * project slugs (each once), or null for none. */
export function checkOngoingProjects(
   input: unknown
): { slugs: string[] | null } | { error: string } {
   if (input === null) return { slugs: null };
   if (!Array.isArray(input) || input.length > ONGOING_MAX) {
      return {
         error: `send ongoing_projects as a list of up to ${ONGOING_MAX} project slugs, or null`,
      };
   }
   for (const slug of input) {
      if (typeof slug !== 'string' || !SLUG.test(slug)) {
         return { error: `${String(slug)} isn't a project slug, like ups-access-points` };
      }
   }
   return { slugs: [...new Set(input as string[])].sort() };
}
