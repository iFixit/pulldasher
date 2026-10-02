import type { Label } from '../types';

/**
 * Which project a PR is in. Kept apart from projects.ts, which re-exports
 * it, so the board's rows can name a PR's project without loading the whole
 * projects model.
 */

/** the slug for one-off PRs that fit no project */
export const MISC_SLUG = 'misc';

/** Every project slug a PR's labels name, sorted so every reader agrees. */
export function projectSlugs(labels: readonly Pick<Label, 'title'>[], prefix: string): string[] {
   return labels
      .filter(l => l.title.startsWith(prefix) && l.title.length > prefix.length)
      .map(l => l.title.slice(prefix.length))
      .sort();
}

/**
 * A PR's project, the one rule every view and the server count by: its
 * project label (a real project before misc, else the first alphabetically);
 * with no label but misc, the project whose issues it links (`linked`: the
 * projects that have an issue it links, sorted, so a PR linking two goes to
 * the first, as one with two labels does); else misc when it says so; else
 * null. Without `linked`, its labels alone, as the board's rows name it.
 */
export function projectOf(
   labels: readonly Pick<Label, 'title'>[],
   prefix: string,
   linked: readonly string[] = []
): string | null {
   const slugs = projectSlugs(labels, prefix);
   return slugs.find(s => s !== MISC_SLUG) ?? linked[0] ?? slugs[0] ?? null;
}
