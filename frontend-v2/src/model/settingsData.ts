import { isDummy } from '../backend/dummy';
import { checkDeveloperTeams, type DeveloperTeams } from '../../../shared/model/settings';
import { refreshProjectsData, setDummyTeams } from './projectData';

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
   const res = await fetch('/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ developer_teams: checked.teams }),
   }).catch(() => null);
   if (!res || res.redirected || res.status === 401) {
      return { error: 'Your sign-in expired. Reload the page to sign in again.' };
   }
   if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: json.error ?? 'Couldn’t save the teams. Try again in a minute.' };
   }
   refreshProjectsData();
   return { ok: true };
}
