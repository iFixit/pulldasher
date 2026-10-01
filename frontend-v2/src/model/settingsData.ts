import { isDummy } from '../backend/dummy';
import { utcDay } from '../../../shared/model/projects';
import { mondayOf } from '../../../shared/model/roadmap';
import {
   checkDecideRotation,
   checkDeveloperTeams,
   checkOngoingProjects,
   type DeveloperTeams,
} from '../../../shared/model/settings';
import {
   refreshProjectsData,
   setDummyOngoing,
   setDummyRotation,
   setDummyTeams,
} from './projectData';

/**
 * Saving the developer teams from the People view: PATCH /settings, which
 * checks them with the same shared code, then every window loads again,
 * since each developer count changes with the teams. Null goes back to
 * config.js's. The dummy board keeps them in memory instead.
 */
export async function saveDeveloperTeams(
   teams: DeveloperTeams | null
): Promise<{ ok: true } | { error: string }> {
   const checked = checkDeveloperTeams(teams);
   if ('error' in checked) return checked;
   if (isDummy()) {
      setDummyTeams(checked.teams);
      refreshProjectsData();
      return { ok: true };
   }
   return patchSettings({ developer_teams: checked.teams }, 'the teams');
}

/**
 * Saving who takes turns running Decide, a week each, the first of them
 * this week; null for nobody. The dummy board keeps it in memory.
 */
export async function saveDecideRotation(
   logins: string[] | null
): Promise<{ ok: true } | { error: string }> {
   const checked = checkDecideRotation(logins);
   if ('error' in checked) return checked;
   if (isDummy()) {
      const from = mondayOf(utcDay(Date.now() / 1000));
      setDummyRotation(checked.logins && { logins: checked.logins, from });
      refreshProjectsData();
      return { ok: true };
   }
   return patchSettings({ decide_rotation: checked.logins }, 'who runs Decide');
}

/**
 * Saving which projects are ongoing (no end, so Decide never asks them for
 * a first plan): the whole list, as it should be after the change. The
 * dummy board keeps it in memory.
 */
export async function saveOngoingProjects(
   slugs: string[]
): Promise<{ ok: true } | { error: string }> {
   const checked = checkOngoingProjects(slugs);
   if ('error' in checked) return checked;
   if (isDummy()) {
      setDummyOngoing(checked.slugs ?? []);
      refreshProjectsData();
      return { ok: true };
   }
   return patchSettings({ ongoing_projects: checked.slugs }, 'which projects are ongoing');
}

/** PATCH /settings, then load every window again. */
async function patchSettings(
   body: Record<string, unknown>,
   what: string
): Promise<{ ok: true } | { error: string }> {
   const res = await fetch('/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
   }).catch(() => null);
   if (!res || res.redirected || res.status === 401) {
      return { error: 'Your sign-in expired. Reload the page to sign in again.' };
   }
   if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: json.error ?? `Couldn’t save ${what}. Try again in a minute.` };
   }
   refreshProjectsData();
   return { ok: true };
}
