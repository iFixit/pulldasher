const projectIssuesSyncedAt = new Map();
// issues a run couldn't read, by repo then issue number, with how many runs
// in a row failed; each is read on its own next run so the marker can move on
// (one stuck issue would otherwise re-read the whole window every hour)
const projectIssueRetries = new Map();
export const RETRY_LIMIT = 3;

/**
 * Read one repo's issues changed since its marker (`firstSince` on the first
 * run), and retry the ones an earlier run couldn't read. Resolves whether
 * anything changed: a retry that fails again isn't a change, so open boards
 * aren't told to fetch again for it.
 */
export async function syncRepoIssues(refresh, repo, firstSince, startedAt) {
   const retries = projectIssueRetries.get(repo) ?? new Map();
   const failing = new Map();
   let changed = false;
   for (const [number, fails] of retries) {
      try {
         await refresh.issue(repo, number);
         changed = true;
      } catch (err) {
         if (fails + 1 >= RETRY_LIMIT) {
            console.error('Giving up on %s#%s after %d tries', repo, number, fails + 1);
         } else {
            failing.set(number, fails + 1);
         }
      }
   }
   const report = await refresh.issuesChangedSince(
      repo,
      projectIssuesSyncedAt.get(repo) ?? firstSince
   );
   // a repo that couldn't be listed read nothing, so its marker stays
   if (!report.failedRepos.length) projectIssuesSyncedAt.set(repo, startedAt);
   for (const { number } of report.failedItems) if (!failing.has(number)) failing.set(number, 1);
   projectIssueRetries.set(repo, failing);
   return changed || report.refreshed > 0;
}

/** test hook */
export function _resetIssueSync() {
   projectIssuesSyncedAt.clear();
   projectIssueRetries.clear();
}
export const _syncedAt = repo => projectIssuesSyncedAt.get(repo);
