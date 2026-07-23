import type { DerivedPull } from './status';

/**
 * "Code regions": free-text areas you own or care about (e.g. "Growthbook",
 * "Shopify", "Diagrams"). A PR that partial-matches one floats to the top of
 * the review queue. Matching is case-insensitive substring against everything
 * already on the wire — title, body, repo, branch, and label names — so it
 * costs nothing extra (changed file paths aren't fetched client-side). Pure
 * and side-effect-free, like the rest of model/.
 */

/** The lowercased text a pull is matched against: title, body, repo, branch
 * (head.ref), and label names, joined. */
function haystack(p: DerivedPull): string {
   const d = p.data;
   const labels = (d.labels ?? []).map(l => l.title).join(' ');
   return `${d.title} ${d.body} ${d.repo} ${d.head?.ref ?? ''} ${labels}`.toLowerCase();
}

/** The configured regions a pull matches, in the order they're configured;
 * empty when none match (or none are configured). Blank/whitespace regions
 * never match. */
export function matchedRegions(p: DerivedPull, regions: string[]): string[] {
   if (regions.length === 0) return [];
   const hay = haystack(p);
   return regions.filter(r => {
      const needle = r.trim().toLowerCase();
      return needle.length > 0 && hay.includes(needle);
   });
}

/** Whether a pull matches any configured region. */
export function matchesRegion(p: DerivedPull, regions: string[]): boolean {
   if (regions.length === 0) return false;
   const hay = haystack(p);
   return regions.some(r => {
      const needle = r.trim().toLowerCase();
      return needle.length > 0 && hay.includes(needle);
   });
}

/**
 * Stable-partition a sorted list so region-matching pulls float to the front,
 * each group keeping its existing relative order — the same shape as sort.ts's
 * teamFirst. A no-op (returns the input) when no regions are configured, so
 * callers can wrap it unconditionally.
 */
export function regionFirst(pulls: DerivedPull[], regions: string[]): DerivedPull[] {
   if (regions.length === 0) return pulls;
   const hit: DerivedPull[] = [];
   const miss: DerivedPull[] = [];
   for (const p of pulls) (matchesRegion(p, regions) ? hit : miss).push(p);
   return [...hit, ...miss];
}
