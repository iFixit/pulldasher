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
   const raw = (await import('../../../frontend/dummy-pulls.json'))
      .default as unknown as PullData[];
   // The fixture is a decade of frozen pulls; re-date them so age-derived
   // signals (heat, starvation, freshness) exercise realistically.
   const pulls = raw.map((p, i) => redate(p, i));
   return {
      repos: [{ name: 'iFixit/ifixit' }],
      // The fixture carries almost no closed/merged pulls and no diff sizes, so
      // the Stats lens (merge-time-by-size, leaderboards over shipped work) has
      // nothing to show. Synthesize a fortnight of merged PRs across the size
      // range so those panels demo. Dummy-only — real data carries this for real.
      pulls: [...pulls, ...synthMerged(pulls)],
   };
}

// The fixture's signature timestamps are as frozen as its pulls; spread them
// across the given window so stamp-timeline stats (review pulse, first-CR
// latency) exercise realistically instead of reading a decade-old wall.
function redateSigs(
   status: PullData['status'],
   startMs: number,
   endMs: number
): PullData['status'] {
   const span = Math.max(endMs - startMs, 3_600_000);
   const shift = <S extends { data: { created_at: string } }>(sigs: S[], salt: number): S[] =>
      sigs.map((s, j) => ({
         ...s,
         data: {
            ...s.data,
            created_at: new Date(
               startMs + ((j + 1) * span) / (sigs.length + 1) + salt
            ).toISOString(),
         },
      }));
   return { ...status, allCR: shift(status.allCR, 0), allQA: shift(status.allQA, 600_000) };
}

function redate(pull: PullData, i: number): PullData {
   const now = Date.now();
   const ageDays = (i * 7919) % 45; // deterministic spread, 0-45 days
   const created = new Date(now - ageDays * 86400_000);
   const updated = new Date(now - ((i * 104729) % (72 * 3600_000)));
   // synthesize a diff size when the fixture omits one, so the weight meter
   // and size-derived stats aren't all flat XS in dummy mode
   const additions = pull.additions ?? 17 + ((i * 4099) % 1600);
   const deletions = pull.deletions ?? (i * 1237) % 400;
   return {
      ...pull,
      created_at: created.toISOString(),
      updated_at: updated.toISOString(),
      status: redateSigs(pull.status, created.getTime(), now),
      additions,
      deletions,
   };
}

// Clone a slice of the board into merged PRs, closed within the last 14 days,
// with merge time that rises with size (plus jitter) so the trend is visible.
function synthMerged(pulls: PullData[]): PullData[] {
   const now = Date.now();
   return pulls.slice(0, 16).map((p, i) => {
      const size = (p.additions ?? 0) + (p.deletions ?? 0);
      const mergeHours = 1.5 + size / 45 + ((i * 53) % 34);
      const closedDaysAgo = (i * 3) % 14;
      const merged = now - closedDaysAgo * 86400_000;
      const created = merged - mergeHours * 3_600_000;
      return {
         ...p,
         number: 90000 + i,
         state: 'closed',
         draft: false,
         created_at: new Date(created).toISOString(),
         updated_at: new Date(merged).toISOString(),
         closed_at: new Date(merged).toISOString(),
         merged_at: new Date(merged).toISOString(),
         status: redateSigs(p.status, created, merged),
      };
   });
}
