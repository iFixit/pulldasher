/**
 * An issue's (or a PR's) address, and how people write one. Its own module
 * so the roadmap's field checks and the scope model can both use it.
 */

/** An issue's (or a PR's) address. */
export interface IssueRef {
   repo: string;
   number: number;
}

export const issueKey = (ref: IssueRef): string => `${ref.repo}#${ref.number}`;

/** an "owner/repo" name, as a regex source */
export const REPO_PATTERN = '[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+';

/**
 * An issue reference the way people paste one: "owner/repo#123", a GitHub
 * issue or PR URL, or "#123" (or just "123") against `defaultRepo`. Null
 * when it isn't one.
 */
export function parseIssueRef(text: string, defaultRepo: string | null = null): IssueRef | null {
   const s = text.trim();
   let m = new RegExp(
      `^https?://github\\.com/(${REPO_PATTERN})/(?:issues|pull)/(\\d+)/?(?:[#?].*)?$`,
      'i'
   ).exec(s);
   if (m) return { repo: m[1], number: Number(m[2]) };
   m = new RegExp(`^(${REPO_PATTERN})#(\\d+)$`).exec(s);
   if (m) return { repo: m[1], number: Number(m[2]) };
   m = /^#?(\d+)$/.exec(s);
   if (m && defaultRepo) return { repo: defaultRepo, number: Number(m[1]) };
   return null;
}
