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

/** Words a slug can't case on its own, from the live P- labels: acronyms,
 * and brands spelled their own way. */
const SLUG_WORDS: Record<string, string> = Object.fromEntries(
   [
      'GA4',
      'BI',
      'UPS',
      'CI',
      'PLP',
      'SSR',
      'API',
      'CAD',
      'npm',
      'idx',
      'ChatGPT',
      'NetSuite',
      'FixHub',
      'FixBot',
      'RepairDesk',
      'v2',
      'v5',
   ].map(w => [w.toLowerCase(), w])
);

/** A label's slug read as words, the name of a project no issue or plan
 * names yet: "webdriver-deflake" is "Webdriver deflake", "ga4-events" is
 * "GA4 events", and "npm-token" stays "npm token", as the brand writes it. */
export const slugName = (slug: string) => {
   const words = slug.split(/[-_]+/).map(w => SLUG_WORDS[w.toLowerCase()] ?? w);
   const name = words.join(' ');
   return SLUG_WORDS[words[0].toLowerCase()] ? name : name.charAt(0).toUpperCase() + name.slice(1);
};

/** A stretch when a script added labels with a person's token
 * (config.js projects.machineLabelRuns): a label `actor` added from `from`
 * to `to` (ISO times, both counted) is the job's, not theirs. */
export interface MachineLabelRun {
   actor: string;
   from: string;
   to: string;
}

/**
 * Who put a project label on a PR: a `person`, or the `job` that files PRs
 * (a bot, or a person's token inside one of `runs`). A label whose adder
 * isn't known (a renamed label loses it) is the job's, since no person can
 * be said to have chosen it. `at` is epoch secs, null when not known.
 */
export function labeledBy(
   login: string | null,
   at: number | null,
   { isBot, runs = [] }: { isBot: (login: string) => boolean; runs?: readonly MachineLabelRun[] }
): 'person' | 'job' {
   if (!login || isBot(login)) return 'job';
   const ms = at == null ? null : at * 1000;
   const scripted = runs.some(
      r =>
         r.actor.toLowerCase() === login.toLowerCase() &&
         ms != null &&
         ms >= Date.parse(r.from) &&
         ms <= Date.parse(r.to)
   );
   return scripted ? 'job' : 'person';
}
