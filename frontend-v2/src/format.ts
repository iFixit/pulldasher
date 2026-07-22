import type { PullData, Signature } from './types';

/** "34m" / "5h" / "3d" — matches the terseness of the board rows. */
export function ago(epochSecs: number, now: number = Date.now() / 1000) {
   const s = Math.max(0, now - epochSecs);
   if (s < 3600) return `${Math.round(s / 60)}m`;
   if (s < 48 * 3600) return `${Math.round(s / 3600)}h`;
   return `${Math.round(s / 86400)}d`;
}

/** Deterministic hue per login, the fallback avatar color behind the picture
 * (and the whole avatar for bots / deleted accounts that have no picture). */
export function loginHue(login: string) {
   let h = 0;
   for (const c of login) h = (h * 31 + c.charCodeAt(0)) % 360;
   return h;
}

/** GitHub serves a public, unauthenticated avatar for any login at
 * github.com/<login>.png (v1 used the same). Ask for 2× the render size so it
 * stays crisp on retina. Bots and deleted accounts 404 here, so the caller
 * falls back to the login's initials on error. */
export function githubAvatarUrl(login: string, px: number) {
   return `https://github.com/${encodeURIComponent(login)}.png?size=${Math.round(px * 2)}`;
}

/** A person's GitHub profile page. */
export function githubProfileUrl(login: string) {
   return `https://github.com/${encodeURIComponent(login)}`;
}

export function githubUrl(repo: string, number: number) {
   return `https://github.com/${repo}/pull/${number}`;
}

/**
 * A permalink to the comment or review a stamp came from. The comment_id is
 * two different GitHub id spaces, so the anchor depends on source_type; a
 * review needs #pullrequestreview-, a plain comment #issuecomment-. Mirrors
 * v1's Pull.linkToSignature.
 */
export function signatureUrl(sig: Signature) {
   const anchor = sig.data.source_type === 'review' ? 'pullrequestreview' : 'issuecomment';
   return `${githubUrl(sig.data.repo, sig.data.number)}#${anchor}-${sig.data.comment_id}`;
}

/** Owner stripped whoever it is — v1's getRepoName() did the same, and the
 * legacy ?repo= filter compares against these short names. */
export function shortRepo(repo: string) {
   return repo.replace(/.*\//, '');
}

/** The one true row key. */
export function pullKey(d: { repo: string; number: number }) {
   return `${d.repo}#${d.number}`;
}

/** The DOM id a row renders under — repo's slashes swapped for hyphens (a
 * literal '/' or '#' is legal in an HTML id but not in a CSS selector), so
 * a toast can scrollIntoView + flash the row it points at. */
export function rowDomId(d: { repo: string; number: number }) {
   return `pull-${d.repo.replace(/\//g, '-')}-${d.number}`;
}

/** ISO date string → epoch seconds, the clock unit everything else here uses. */
export function epoch(iso: string): number {
   return Date.parse(iso) / 1000;
}

/**
 * When a pull actually stopped moving, in epoch seconds: its close time, or
 * last activity as a fallback for the rare pull with no `closed_at`. The one
 * definition of the "closed at" rule the closed-row card and its sort share.
 */
export function closedEpoch(pull: Pick<PullData, 'closed_at' | 'updated_at'>) {
   return epoch(pull.closed_at ?? pull.updated_at);
}

/** "1 PR" / "3 PRs" — counts read as grammar, not as a template. */
export function n(count: number, singular: string, plural = `${singular}s`) {
   return `${count} ${count === 1 ? singular : plural}`;
}
