/** "34m" / "5h" / "3d" — matches the terseness of the board rows. */
export function ago(epochSecs: number, now: number = Date.now() / 1000) {
   const s = Math.max(0, now - epochSecs);
   if (s < 3600) return `${Math.round(s / 60)}m`;
   if (s < 48 * 3600) return `${Math.round(s / 3600)}h`;
   return `${Math.round(s / 86400)}d`;
}

/** Deterministic avatar hue per login (no external images: CSP-safe). */
export function loginHue(login: string) {
   let h = 0;
   for (const c of login) h = (h * 31 + c.charCodeAt(0)) % 360;
   return h;
}

export function githubUrl(repo: string, number: number) {
   return `https://github.com/${repo}/pull/${number}`;
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

/** "1 PR" / "3 PRs" — counts read as grammar, not as a template. */
export function n(count: number, singular: string, plural = `${singular}s`) {
   return `${count} ${count === 1 ? singular : plural}`;
}
