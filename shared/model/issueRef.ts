/**
 * An issue's (or a PR's) address, and how people write one. Its own module
 * so the board's search and the work model can both use it.
 */

/** An issue's (or a PR's) address. */
export interface IssueRef {
   repo: string;
   number: number;
}

/** "owner/repo#123", for people to read. */
export const issueText = (ref: IssueRef): string => `${ref.repo}#${ref.number}`;

/** An issue's key in a map. GitHub ignores case in repo names, and people
 * type them both ways, so the key does too. */
export const issueKey = (ref: IssueRef): string => issueText(ref).toLowerCase();

/** the largest number GitHub's API takes for an issue (a 32-bit Int) */
export const MAX_ISSUE_NUMBER = 2 ** 31 - 1;

const issueNumber = (digits: string): number | null => {
   const number = Number(digits);
   return number > 0 && number <= MAX_ISSUE_NUMBER ? number : null;
};

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
   if (m) return issueNumber(m[2]) ? { repo: m[1], number: Number(m[2]) } : null;
   m = new RegExp(`^(${REPO_PATTERN})#(\\d+)$`).exec(s);
   if (m) return issueNumber(m[2]) ? { repo: m[1], number: Number(m[2]) } : null;
   m = /^#?(\d+)$/.exec(s);
   if (m && defaultRepo && issueNumber(m[1])) return { repo: defaultRepo, number: Number(m[1]) };
   return null;
}
