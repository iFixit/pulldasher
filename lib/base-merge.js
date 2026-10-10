const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether a commit is a merge of the PR's base branch into the PR branch:
 * two parents and git's or GitHub's merge message, e.g. "Merge branch
 * 'master' into foo", "Merge branch 'master' of github.com:o/r into foo",
 * "Merge remote-tracking branch 'origin/master' into foo".
 */
export function isBaseMerge(commit, baseRef) {
   if (!commit.parents || commit.parents.length !== 2) return false;
   const subject = String(commit.commit?.message ?? '').split('\n')[0];
   return new RegExp(
      `^Merge (?:remote-tracking )?branch '(?:[\\w.-]+/)?${escape(
         baseRef
      )}'(?: of \\S+)?(?: into .+)?$`
   ).test(subject);
}

/**
 * Whether a CR/QA stamp left at `stampAt` survives the commits since: true
 * when every commit made after it is a merge of the base into the PR, the way
 * GitHub keeps an approval across one. `commits` is pulls.listCommits output.
 *
 * ponytail: the message can't tell a clean merge from one that resolved
 * conflicts, so a conflict-resolving merge keeps the stamp too. Upgrade path:
 * compare the merge commit's tree with a fresh merge of its parents, or the
 * PR's file patches before and after.
 */
export function stampSurvivesBaseMerges(stampAt, commits, baseRef) {
   return commits
      .filter(c => new Date(c.commit.committer.date) > stampAt)
      .every(c => isBaseMerge(c, baseRef));
}
