import type { InitializePayload, PullData } from '../types';

/**
 * Dummy mode: run the whole UI without a backend.
 *   npm run dev:dummy
 * Reuses v1's fixture (frontend/dummy-pulls.json) so both frontends stay
 * honest against the same wire shape.
 */
export function isDummy(): boolean {
   return import.meta.env.VITE_DUMMY === '1';
}

export function dummyUser(): string {
   return import.meta.env.VITE_DUMMY_USER || 'danielbeardsley';
}

export async function loadDummy(): Promise<InitializePayload> {
   const pulls = (await import('../../../frontend/dummy-pulls.json'))
      .default as unknown as PullData[];
   return {
      repos: [{ name: 'iFixit/ifixit' }],
      // The fixture is a decade of frozen pulls; re-date them so age-derived
      // signals (heat, starvation, freshness) exercise realistically.
      pulls: pulls.map((p, i) => redate(p, i)),
   };
}

function redate(pull: PullData, i: number): PullData {
   const now = Date.now();
   const ageDays = (i * 7919) % 45; // deterministic spread, 0-45 days
   const created = new Date(now - ageDays * 86400_000);
   const updated = new Date(now - ((i * 104729) % (72 * 3600_000)));
   return {
      ...pull,
      created_at: created.toISOString(),
      updated_at: updated.toISOString(),
   };
}
