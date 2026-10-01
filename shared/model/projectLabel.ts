import type { Label } from '../types';

/**
 * Which project a PR's labels put it in. Kept apart from projects.ts, which
 * re-exports it, so the board's rows can name a PR's project without
 * loading the whole projects model.
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

/** A PR's project: a real project before misc when it carries both, else
 * the first label alphabetically; null with no project label at all. */
export function projectOf(labels: readonly Pick<Label, 'title'>[], prefix: string): string | null {
   const slugs = projectSlugs(labels, prefix);
   return slugs.find(s => s !== MISC_SLUG) ?? slugs[0] ?? null;
}
