import db from './db.js';
import debug from './debug.js';
import git from './git-manager.js';
import { issueRepos, loadProjects } from './projects.js';
import { isBot } from './review-model.js';
import { listItems } from './roadmap.js';
import {
   MISC_SLUG,
   SUGGEST_DAYS,
   bodyLinks,
   issuePace,
   issueKey,
   issueQuery,
   issueText,
   itemState,
   parseIssueRef,
   planWork,
   projectCounts,
   projectOf,
   projectWork,
} from '../shared/dist/index.js';

/**
 * Projects' work (the model is shared/model/work.ts): the issues attached to
 * each project, by its label, by hand on the board, or on their own by a
 * link from one of its PRs, and the PRs that link them. This keeps the
 * issues added by hand or by a link in `project_issues` (one taken off stays
 * there, marked, so it never comes back on its own), and which PRs link each
 * attached issue in `issue_pull_links`, read off GitHub's GraphQL API.
 * "Parts of #N" in a PR's body is how a PR links an issue here, and GitHub
 * records it only as a mention, so links come from the issue's side: its
 * closing PRs, and the PRs that mention it with a linking phrase
 * (bodyLinks). Those links also put a PR with no project label in the
 * project whose issue it links, on every view (loadPullLinks). It also
 * searches GitHub's issues for the board's picker. Reads only; nothing here
 * writes to GitHub.
 *
 * It syncs at startup, hourly, and a minute after a webhook touches an
 * attached issue, or opens or edits a PR that links one.
 */

const workDebug = debug('pulldasher:work');
const DAY = 86400;
/** issues per batched GraphQL query */
const BATCH = 40;
const TITLE_MAX = 255;

const epochOf = iso => (iso ? Math.floor(Date.parse(iso) / 1000) : null);
const clip = text => String(text ?? '').slice(0, TITLE_MAX);
const splitRepo = repo => {
   const [owner, name] = repo.split('/');
   return { owner, name };
};
const refOf = node => ({ repo: node.repository.nameWithOwner, number: node.number });
const uniqueRefs = refs => [...new Map(refs.map(ref => [issueKey(ref), ref])).values()];
const num = value => (value == null ? null : Number(value));

/** A GraphQL call that keeps GitHub's partial answer: it reports a missing
 * issue as an error beside the data it could read. Resolves { data, errors }. */
async function queryWithErrors(text, variables) {
   try {
      return { data: await git.graphql(text, variables), errors: [] };
   } catch (err) {
      if (err && err.data) return { data: err.data, errors: err.errors ?? [] };
      throw err;
   }
}

const STATE_FIELDS =
   '__typename ... on Issue { number title state stateReason closedAt createdAt author { login } ' +
   'repository { nameWithOwner } } ' +
   '... on PullRequest { number title state merged closedAt createdAt author { login } ' +
   'repository { nameWithOwner } }';

// the newest cross-references, where a long-lived issue's new PRs are, with
// each PR's body to tell a link ("Parts of #N") from a passing mention
const LINK_FIELDS = `__typename ... on Issue {
  closedByPullRequestsReferences(first: 20, includeClosedPrs: true) {
    nodes { number repository { nameWithOwner } }
  }
  timelineItems(last: 100, itemTypes: [CROSS_REFERENCED_EVENT]) {
    nodes { ... on CrossReferencedEvent { source { __typename ... on PullRequest { number body repository { nameWithOwner } } } } }
  }
}`;

/**
 * One query for many issues: each repo once, each issue under it by an
 * alias. Values by issueKey. A batch GitHub can't answer at all throws, or
 * with `skipFailed` is asked again in halves, down to one issue, so one
 * heavy issue (an epic's cross-references can time a batch out) can't keep
 * the rest of its batch from being read; what still fails is left out, so
 * the others still count.
 * ponytail: a split whose halves both fail stops there, taken for GitHub
 * failing rather than one heavy issue, since every failed ask costs
 * plugin-retry's retries; two heavy issues split across both halves wait
 * for the next sync.
 * `out.gone` holds the issueKeys GitHub answered NOT_FOUND for (deleted or
 * transferred), which a failed batch never does: an issue missing from `out`
 * but not in `gone` is only unread.
 */
async function batch(refs, fields, { skipFailed = false } = {}) {
   const out = new Map();
   out.gone = new Set();
   // one query; resolves { err } when it failed and `skipFailed` keeps going
   const ask = async chunk => {
      const byRepo = new Map();
      for (const ref of chunk) {
         const k = ref.repo.toLowerCase();
         const repo = byRepo.get(k) ?? { name: ref.repo, numbers: new Set() };
         repo.numbers.add(ref.number);
         byRepo.set(k, repo);
      }
      const repos = [...byRepo.values()];
      const text =
         'query {\n' +
         repos
            .map(({ name: repo, numbers }, r) => {
               const { owner, name } = splitRepo(repo);
               const issues = [...numbers]
                  .map(n => `i${n}: issueOrPullRequest(number: ${n}) { ${fields} }`)
                  .join('\n');
               return `r${r}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(
                  name
               )}) {\n${issues}\n}`;
            })
            .join('\n') +
         '\n}';
      let data;
      let errors;
      try {
         ({ data, errors } = await queryWithErrors(text));
      } catch (err) {
         if (!skipFailed) throw err;
         return { err };
      }
      // a path of [repo alias, issue alias] is the issue itself; a one-step
      // path is the repo (private, or renamed), which says nothing of the issue
      for (const e of errors) {
         const [r, i] = e.path ?? [];
         if (e.type === 'NOT_FOUND' && /^r\d+$/.test(r) && /^i\d+$/.test(i ?? '')) {
            const { name: repo } = repos[Number(r.slice(1))] ?? {};
            if (repo) out.gone.add(issueKey({ repo, number: Number(i.slice(1)) }));
         }
      }
      repos.forEach(({ name: repo }, r) => {
         for (const [alias, value] of Object.entries(data?.[`r${r}`] ?? {})) {
            if (value) out.set(issueKey({ repo, number: Number(alias.slice(1)) }), value);
         }
      });
      return null;
   };
   const giveUp = (chunk, { err }) =>
      console.error(
         'Work: a batch of %d issues failed: %s',
         chunk.length,
         (err && err.message) || err
      );
   // a chunk that failed: each half asked again, and so on down
   const split = async (chunk, failed) => {
      if (chunk.length === 1) return giveUp(chunk, failed);
      const middle = Math.ceil(chunk.length / 2);
      const halves = [chunk.slice(0, middle), chunk.slice(middle)];
      const answers = await Promise.all(halves.map(ask));
      if (answers.every(Boolean)) return halves.forEach((half, i) => giveUp(half, answers[i]));
      for (const [i, half] of halves.entries()) if (answers[i]) await split(half, answers[i]);
   };
   for (let i = 0; i < refs.length; i += BATCH) {
      const chunk = refs.slice(i, i + BATCH);
      const failed = await ask(chunk);
      if (failed) await split(chunk, failed);
   }
   return out;
}

/** An issue read off GitHub, as project_issues keeps it. */
const issueColumns = node => ({
   title: clip(node.title),
   state: itemState(node.state, node.stateReason),
   closed_at: epochOf(node.closedAt),
   author: node.author?.login ?? null,
   created_at: epochOf(node.createdAt),
});

/**
 * Which PRs link each issue: its closing references (a closing keyword or
 * the Development sidebar), and the PRs that cross-reference it with a
 * linking phrase in their body, which is how "Parts of #N" shows up. A
 * mention in passing, a comment or a commit doesn't link. Values by
 * issueKey, each with the issue's ref. An issue whose batch failed is left
 * out, so its stored links stay.
 */
export async function fetchLinks(refs) {
   const nodes = await batch(refs, LINK_FIELDS, { skipFailed: true });
   const out = new Map();
   for (const ref of refs) {
      const node = nodes.get(issueKey(ref));
      if (!node || node.__typename !== 'Issue') continue;
      const prs = new Map();
      for (const event of node.timelineItems?.nodes ?? []) {
         const source = event?.source;
         if (source?.__typename !== 'PullRequest') continue;
         const named = bodyLinks(source.body, source.repository.nameWithOwner);
         if (!named.some(r => issueKey(r) === issueKey(ref))) continue;
         prs.set(issueKey(refOf(source)), { ...refOf(source), closes: false });
      }
      for (const pr of node.closedByPullRequestsReferences?.nodes ?? []) {
         if (pr) prs.set(issueKey(refOf(pr)), { ...refOf(pr), closes: true });
      }
      out.set(issueKey(ref), { ref, prs: [...prs.values()] });
   }
   return out;
}

/**
 * Keep each issue's links as just read, and its links to merged PRs as they
 * were: GitHub's side lists an issue's last 100 cross-references, so past
 * that an epic's older PRs would leave its project, and Look back would
 * rewrite what was done. A link to a PR still open, or closed unmerged,
 * goes once it's no longer read.
 */
async function storeLinks(links) {
   if (!links.size) return;
   const issues = [...links.values()].map(({ ref }) => [ref.repo, ref.number]);
   await db.query(
      'DELETE k FROM `issue_pull_links` k LEFT JOIN `pulls` p ' +
         'ON p.`repo` = k.`pull_repo` AND p.`number` = k.`pull_number` ' +
         'WHERE (k.`issue_repo`, k.`issue_number`) IN (?) AND p.`date_merged` IS NULL',
      [issues]
   );
   const rows = [...links.values()].flatMap(({ ref, prs }) =>
      prs.map(pr => [ref.repo, ref.number, pr.repo, pr.number, pr.closes ? 1 : 0])
   );
   if (rows.length) {
      // IGNORE: the key ignores case, so a link spelled two ways is one row
      await db.query(
         'INSERT IGNORE INTO `issue_pull_links` (`issue_repo`, `issue_number`, `pull_repo`, ' +
            '`pull_number`, `closes`) VALUES ?',
         [rows]
      );
   }
}

/** The LIKE pattern for every project label: the prefix's own wildcards
 * match literally. */
const likePrefix = settings => settings.prefix.replace(/[\\%_]/g, '\\$&') + '%';

/** Issues carrying a project label, with the label: project issues and the
 * issues people labeled into a project. */
function labeledIssueRows(settings) {
   return db.query(
      'SELECT i.repo, i.number, i.title, i.status, i.state_reason, i.date_closed, i.author, ' +
         'i.date_created, l.title AS label, l.date AS labeled_at FROM issues i ' +
         'JOIN pull_labels l ON l.repo = i.repo AND l.number = i.number WHERE l.title LIKE ?',
      [likePrefix(settings)]
   );
}

const HAND_COLUMNS =
   '`project`, `repo`, `number`, `title`, `state`, `closed_at`, `author`, `created_at`, ' +
   '`added_by`, `linked_by`, `added_at`';

/**
 * Which projects each PR links (shared/model/projects.ts PullLinks), by
 * issueKey of the PR: every project with an issue it links, by the
 * project's label, by hand or by a link (none taken off), or whose own
 * issue it links, as each issue's side lists its PRs. Misc holds one-off
 * work, not a project, so an issue labeled with it adds none.
 */
function pullLinksFrom(settings, labelRows, handRows, linkRows) {
   const projectsOf = new Map();
   const add = (ref, slug) => {
      if (!slug || slug === MISC_SLUG) return;
      projectsOf.set(issueKey(ref), new Set([...(projectsOf.get(issueKey(ref)) ?? []), slug]));
   };
   for (const r of labelRows) add(r, r.label.slice(settings.prefix.length));
   for (const r of handRows) if (r.removed_at == null) add(r, r.project);
   const out = {};
   for (const r of linkRows) {
      const slugs = projectsOf.get(issueKey({ repo: r.issue_repo, number: r.issue_number }));
      if (!slugs) continue;
      const pr = issueKey({ repo: r.pull_repo, number: r.pull_number });
      out[pr] = [...new Set([...(out[pr] ?? []), ...slugs])].sort();
   }
   return out;
}

/** Which projects each PR links (pullLinksFrom), read fresh: what a PR with
 * no project label counts toward, in the window's numbers, Look back, Today
 * and the work model alike (shared/model/projectLabel.ts projectOf). */
export async function loadPullLinks(settings) {
   const [labelRows, handRows, linkRows] = await Promise.all([
      labeledIssueRows(settings),
      db.query('SELECT `project`, `repo`, `number`, `removed_at` FROM `project_issues`'),
      db.query(
         'SELECT `issue_repo`, `issue_number`, `pull_repo`, `pull_number` FROM `issue_pull_links`'
      ),
   ]);
   return pullLinksFrom(settings, labelRows, handRows, linkRows);
}

// the issues the last sync read, so a webhook on one of them can ask for a
// fresh read
let watched = new Set();
let running = null;
let again = false;
let pending = null;

/** Whether a repo is one the board reads issues from. Not the whole
 * organization: the bot can read private repos a person can't. */
const trackedRepo = (settings, repo) =>
   issueRepos(settings).some(r => r.toLowerCase() === repo.toLowerCase());

/**
 * Add an issue to a project by hand, or put back one taken off. It's read
 * off GitHub first, with the PRs that link it, so its title, state and PRs
 * show at once (the hourly sync keeps them current). Resolves {issue,
 * inserted} (a project_issues row, and whether this put it in: false when
 * it puts back one taken off, or it was there already, so an Undo of this
 * add takes it off again rather than forgetting a Remove);
 * {missing} when GitHub has no such issue; or {refused} with why: a PR (its
 * project comes from its label), an issue outside the board's
 * repos, or a project's own issue, which names the project rather
 * than being one of its issues.
 */
export async function attachIssue(
   settings,
   project,
   ref,
   login,
   now = Math.floor(Date.now() / 1000)
) {
   if (!trackedRepo(settings, ref.repo)) {
      return { refused: 'This board doesn’t read issues from that repo.' };
   }
   const node = (await batch([ref], STATE_FIELDS)).get(issueKey(ref));
   if (node?.__typename === 'PullRequest') {
      return {
         refused:
            'That’s a PR. A PR joins a project by the project’s label, or by linking one of its issues.',
      };
   }
   if (!node || node.__typename !== 'Issue') return { missing: true };
   const key = issueKey(refOf(node));
   const records = await loadProjects(settings);
   if (records.some(p => issueKey(p) === key)) {
      return {
         refused:
            'That’s a project’s own issue: it names the project, so it isn’t one of its issues.',
      };
   }
   const row = {
      project,
      ...refOf(node),
      ...issueColumns(node),
      added_by: login,
      added_at: now,
   };
   // added already: keep who added it first (or the link that brought it);
   // taken off before: back as it was
   const { affectedRows } = await db.query('INSERT IGNORE INTO `project_issues` SET ?', [row]);
   await db.query(
      'UPDATE `project_issues` SET `removed_at` = NULL WHERE `project` = ? AND `repo` = ? AND `number` = ?',
      [project, row.repo, row.number]
   );
   const [kept] = await db.query(
      `SELECT ${HAND_COLUMNS} FROM \`project_issues\` WHERE \`project\` = ? AND \`repo\` = ? AND \`number\` = ?`,
      [project, row.repo, row.number]
   );
   try {
      await storeLinks(await fetchLinks([refOf(node)]));
   } catch (err) {
      // the hourly sync reads them instead
      console.error('Work: reading links for %s failed: %s', key, (err && err.message) || err);
   }
   watched.add(key);
   return { issue: kept ?? row, inserted: affectedRows > 0 };
}

/** Take an issue added by hand, or joined by a link, off a project. Its row
 * stays, marked, so a link never brings it back on its own; adding it again
 * clears the mark. With `forget`, the Undo of an add that put its row in
 * (attachIssue's `inserted`), the row goes instead, as if it was never
 * added. Resolves whether it was there. */
export async function detachIssue(
   project,
   ref,
   { forget = false, now = Math.floor(Date.now() / 1000) } = {}
) {
   const which = '`project` = ? AND `repo` = ? AND `number` = ? AND `removed_at` IS NULL';
   const res = forget
      ? await db.query(`DELETE FROM \`project_issues\` WHERE ${which}`, [
           project,
           ref.repo,
           ref.number,
        ])
      : await db.query(`UPDATE \`project_issues\` SET \`removed_at\` = ? WHERE ${which}`, [
           now,
           project,
           ref.repo,
           ref.number,
        ]);
   return res.affectedRows > 0;
}

/**
 * An issue GitHub no longer has (deleted, or transferred away): taken off
 * every project the way a hand removal does, so a link never brings it
 * back, and out of the issues and labels the board joins by label.
 */
export async function forgetIssue(ref, now = Math.floor(Date.now() / 1000)) {
   await db.query(
      'UPDATE `project_issues` SET `removed_at` = ? WHERE `repo` = ? AND `number` = ? AND `removed_at` IS NULL',
      [now, ref.repo, ref.number]
   );
   await db.query('DELETE FROM `pull_labels` WHERE `repo` = ? AND `number` = ?', [
      ref.repo,
      ref.number,
   ]);
   await db.query('DELETE FROM `issues` WHERE `repo` = ? AND `number` = ?', [ref.repo, ref.number]);
}

/** Read the issues added by hand or by a link off GitHub again, and keep
 * their titles and states current. Resolves their refs. */
async function refreshHandIssues() {
   const rows = await db.query(
      'SELECT DISTINCT `repo`, `number` FROM `project_issues` WHERE `removed_at` IS NULL'
   );
   const refs = uniqueRefs(rows.map(r => ({ repo: r.repo, number: Number(r.number) })));
   const nodes = refs.length ? await batch(refs, STATE_FIELDS, { skipFailed: true }) : new Map();
   for (const ref of refs) {
      const node = nodes.get(issueKey(ref));
      // deleted or transferred: it would stay open in its project forever
      if (!node && nodes.gone?.has(issueKey(ref))) await forgetIssue(ref);
      if (!node) continue;
      await db.query('UPDATE `project_issues` SET ? WHERE `repo` = ? AND `number` = ?', [
         issueColumns(node),
         ref.repo,
         ref.number,
      ]);
   }
   return refs;
}

/**
 * Read the issues added by hand or by a link, and the PRs that link every
 * attached issue, off GitHub and store them; then let the issues the
 * projects' PRs link join on their own (joinLinkedIssues). One sync at a
 * time: a call during a sync gets one more sync after it.
 */
// called after each sync of the attached issues and their links (app.js
// tells open boards); one listener is all this needs
let onSynced = () => {};
export function setOnWorkSynced(listener) {
   onSynced = listener;
}

export function syncWork(settings) {
   if (!settings) return Promise.resolve();
   if (running) {
      again = true;
      return running;
   }
   running = (async () => {
      do {
         again = false;
         await doSync(settings);
      } while (again);
      onSynced();
   })().finally(() => {
      running = null;
   });
   return running;
}

async function doSync(settings) {
   let failed = 0;
   let hand = [];
   try {
      hand = await refreshHandIssues();
   } catch (err) {
      failed++;
      console.error(
         'Work: reading the issues added by hand failed: %s',
         (err && err.message) || err
      );
   }
   const labeled = (await labeledIssueRows(settings)).map(r => ({
      repo: r.repo,
      number: Number(r.number),
   }));
   const all = uniqueRefs([...labeled, ...hand]);
   try {
      await storeLinks(await fetchLinks(all));
   } catch (err) {
      failed++;
      console.error('Work: reading links failed: %s', (err && err.message) || err);
   }
   let joined = [];
   try {
      joined = await joinLinkedIssues(settings);
      // their own PRs count toward the project from this sync on
      if (joined.length) await storeLinks(await fetchLinks(joined));
   } catch (err) {
      failed++;
      console.error('Work: joining the issues PRs link failed: %s', (err && err.message) || err);
   }
   // added to, never replaced: an issue added by hand during this sync stays
   // watched (a key left over only costs a sync a webhook asked for)
   for (const ref of [...all, ...joined]) watched.add(issueKey(ref));
   workDebug('synced %d attached issues, %d joined, %d failed', all.length, joined.length, failed);
}

/**
 * The issues the projects' recent PRs link that join on their own
 * (shared/model/work.ts projectWork `joins`), stored as joined by a link
 * from the first PR that opened of those that link each, at the time of
 * this sync (workInputs dates its pace from that PR). An issue taken off a
 * project keeps its row there, so it never comes back this way. Each is
 * read off GitHub first, for its title and state, and to leave out what
 * isn't an issue. Resolves the refs it stored.
 */
async function joinLinkedIssues(settings, now = Math.floor(Date.now() / 1000)) {
   const inputs = await workInputs(settings, {}, { since: now - SUGGEST_DAYS * DAY });
   // every project with a PR: by its label, or the first one a PR links
   const slugs = new Set([
      ...inputs.pulls.keys(),
      ...inputs.unlabeled.map(pr => inputs.linked[issueKey(pr)]?.[0]).filter(Boolean),
   ]);
   const joins = [];
   for (const slug of slugs) {
      for (const s of projectWork(inputs, slug, now).suggested) {
         if (!s.joins) continue;
         joins.push({ slug, ref: { repo: s.repo, number: s.number }, by: s.linkedBy[0] });
      }
   }
   if (!joins.length) return [];
   const nodes = await batch(uniqueRefs(joins.map(j => j.ref)), STATE_FIELDS, { skipFailed: true });
   const rows = [];
   for (const { slug, ref, by } of joins) {
      const node = nodes.get(issueKey(ref));
      if (node?.__typename !== 'Issue') continue;
      const issue = issueColumns(node);
      // closed before the PRs' days: not this project's work now
      if (issue.state !== 'open' && (issue.closed_at ?? 0) < now - SUGGEST_DAYS * DAY) continue;
      const { repo, number } = refOf(node);
      rows.push([
         slug,
         repo,
         number,
         issue.title,
         issue.state,
         issue.closed_at,
         issue.author,
         issue.created_at,
         issueText(by),
         now,
      ]);
   }
   if (!rows.length) return [];
   // IGNORE: one taken off keeps its row, and so stays off
   await db.query(
      'INSERT IGNORE INTO `project_issues` (`project`, `repo`, `number`, `title`, `state`, ' +
         '`closed_at`, `author`, `created_at`, `linked_by`, `added_at`) VALUES ?',
      [rows]
   );
   return uniqueRefs(rows.map(([, repo, number]) => ({ repo, number })));
}

/**
 * A webhook touched an issue: when it's attached to a project, or carries a
 * project label now (just labeled into one), read the work again a minute
 * from now (one read covers a burst of edits).
 */
export function workIssueTouched(settings, repo, number, labels = []) {
   if (!settings || pending) return;
   const labeled = labels.some(l => String(l?.name ?? '').startsWith(settings.prefix));
   if (!labeled && !watched.has(issueKey({ repo, number }))) return;
   pending = setTimeout(() => {
      pending = null;
      syncWork(settings).catch(err =>
         console.error('Work sync failed: %s', (err && err.message) || err)
      );
   }, 60 * 1000);
}

/**
 * A webhook opened or edited a PR: when its body links an issue a project
 * has, or it carries a project label and links any (its links may join),
 * read the work again a minute from now, so a "Parts of #N" PR counts
 * toward its project as soon as a labeled one does, not at the hourly sync.
 */
export function workPullTouched(settings, repo, body, labels = []) {
   for (const ref of bodyLinks(body, repo))
      workIssueTouched(settings, ref.repo, ref.number, labels);
}

/** A pulls row as the work model reads a PR; its body's links when read. */
const workPull = row => ({
   repo: row.repo,
   number: Number(row.number),
   title: row.title,
   author: row.owner,
   createdAt: Number(row.date),
   mergedAt: num(row.date_merged),
   closedAt: num(row.date_closed),
   state: row.state,
   links: row.body ? bodyLinks(row.body, row.repo) : [],
});

/** A PR open now, or opened or closed since the given epoch secs, as SQL
 * over `pulls p` (two parameters). */
const RECENT = "(p.state = 'open' OR p.date >= ? OR p.date_closed >= ?)";

/** A PR's body, for the issues it links, when it's RECENT since a time (two
 * parameters), else null: a year of bodies is megabytes, and the links that
 * matter are on PRs moving now. */
const RECENT_BODY = `IF(${RECENT}, p.body, NULL) AS body, `;

/** Every PR (people's) whose project by its labels is one of `slugs` (null:
 * any project's), by slug: the label half of the rule Today uses; one with
 * no project label joins by the issues it links (workInputs `unlabeled`).
 * Only PRs carrying a project label are read, each with all its project
 * labels, since the rule weighs them all; `since` keeps the ones RECENT
 * since then, and `bodiesSince` reads the bodies of those RECENT since then,
 * for the issues they link. */
async function projectPulls(settings, slugs, { since = null, bodiesSince = null } = {}) {
   if (slugs && !slugs.length) return new Map();
   const where = ['l.title LIKE ?'];
   const params = [
      ...(bodiesSince == null ? [] : [bodiesSince, bodiesSince]),
      likePrefix(settings),
   ];
   if (slugs) {
      where.push(
         '(p.repo, p.number) IN (SELECT `repo`, `number` FROM pull_labels WHERE `title` IN (?))'
      );
      params.push(slugs.map(slug => settings.prefix + slug));
   }
   if (since != null) {
      where.push(RECENT);
      params.push(since, since);
   }
   const rows = await db.query(
      'SELECT p.repo, p.number, p.title, p.owner, p.date, p.date_merged, p.date_closed, p.state, ' +
         `${bodiesSince == null ? '' : RECENT_BODY}l.title AS label ` +
         'FROM pulls p JOIN pull_labels l ON l.repo = p.repo AND l.number = p.number ' +
         `WHERE ${where.join(' AND ')}`,
      params
   );
   const byPull = new Map();
   for (const r of rows) {
      const k = issueKey(r);
      const pull = byPull.get(k) ?? { row: r, labels: [] };
      pull.labels.push({ title: r.label });
      byPull.set(k, pull);
   }
   const wanted = slugs && new Set(slugs);
   const out = new Map();
   for (const { row, labels } of byPull.values()) {
      const slug = projectOf(labels, settings.prefix);
      // misc holds one-off work, not a project
      if (slug == null || slug === MISC_SLUG || (wanted && !wanted.has(slug))) continue;
      if (isBot(row.owner) || row.date == null) continue;
      out.set(slug, [...(out.get(slug) ?? []), workPull(row)]);
   }
   return out;
}

/**
 * What projects' work is built from (shared/model/work.ts WorkInputs), out
 * of what's stored: each project's attached issues (by its label, by hand
 * or by a link, as one issue), the ones taken off, the PRs that link them,
 * which projects each PR links, and the projects' PRs. Pass the plans and
 * project issues when they're already loaded. With `since` (epoch secs),
 * every project's PRs RECENT since then come with their bodies (the issues
 * they link), with the board's knowledge of linked PRs and issues, for the
 * sync that lets linked issues join (joinLinkedIssues); with `slug` too,
 * for its page, the same, so the page says what the sync will join, plus
 * every PR of that project and every PR an issue links, for their titles
 * and states, the bodies of only the ones RECENT since then.
 */
async function workInputs(settings, loaded = {}, { slug = null, since = null } = {}) {
   const bodies = since != null;
   // the sync reads only what moved lately; a page, every PR it names
   const recentOnly = bodies && slug == null;
   const [plans, records, linkRows, labelRows, handRows, linkedRows] = await Promise.all([
      loaded.plans ?? listItems(),
      loaded.projects ?? loadProjects(settings),
      db.query(
         'SELECT `issue_repo`, `issue_number`, `pull_repo`, `pull_number` FROM `issue_pull_links`'
      ),
      labeledIssueRows(settings),
      db.query(`SELECT ${HAND_COLUMNS}, \`removed_at\` FROM \`project_issues\``),
      // every PR that links an attached issue, with whether a project's label
      // claims it (misc holds unsorted work, not a project)
      db.query(
         'SELECT DISTINCT p.repo, p.number, p.title, p.owner, p.date, p.date_merged, p.date_closed, ' +
            `p.state, ${
               bodies ? RECENT_BODY : ''
            }EXISTS (SELECT 1 FROM pull_labels l WHERE l.repo = p.repo AND ` +
            'l.number = p.number AND l.title LIKE ? AND l.title <> ?) AS labeled ' +
            'FROM `issue_pull_links` k ' +
            'JOIN pulls p ON p.repo = k.pull_repo AND p.number = k.pull_number' +
            (recentOnly ? ` WHERE ${RECENT}` : ''),
         [
            ...(bodies ? [since, since] : []),
            likePrefix(settings),
            settings.prefix + MISC_SLUG,
            ...(recentOnly ? [since, since] : []),
         ]
      ),
   ]);
   // a project's own issue names it; it isn't one of its issues
   const notIssues = new Set(records.map(p => issueKey(p)));
   const bySlug = new Map();
   const attach = (project, issue) => {
      if (notIssues.has(issueKey(issue.ref))) return;
      const issues = bySlug.get(project) ?? new Map();
      const was = issues.get(issueKey(issue.ref));
      issues.set(
         issueKey(issue.ref),
         was
            ? {
                 ...was,
                 via: [...new Set([...was.via, ...issue.via])],
                 attachedAt: Math.min(was.attachedAt ?? Infinity, issue.attachedAt ?? Infinity),
                 addedBy: was.addedBy ?? issue.addedBy,
                 linkedBy: was.linkedBy ?? issue.linkedBy,
                 joinedAt: was.joinedAt ?? issue.joinedAt,
              }
            : issue
      );
      bySlug.set(project, issues);
   };
   // when each PR an issue links opened: one that joined by a link dates
   // from its PR's opening, not from the sync that noticed it, or every
   // issue a first sync joins would read as arriving that day, and its
   // project's pace as issues arriving faster than they close for weeks
   const opened = new Map(linkedRows.map(r => [issueKey(r), num(r.date)]));
   for (const r of labelRows) {
      attach(r.label.slice(settings.prefix.length), {
         ref: { repo: r.repo, number: Number(r.number) },
         title: r.title ?? '',
         state: itemState(r.status, r.state_reason),
         closedAt: num(r.date_closed),
         author: r.author ?? null,
         createdAt: num(r.date_created),
         via: ['label'],
         attachedAt: num(r.labeled_at),
         addedBy: null,
      });
   }
   const removed = new Map();
   for (const r of handRows) {
      if (r.removed_at != null) {
         removed.set(r.project, new Set([...(removed.get(r.project) ?? []), issueKey(r)]));
         continue;
      }
      // joined by a link when no one added it by hand
      const byLink = r.linked_by != null && r.added_by == null;
      const linkedBy = byLink ? parseIssueRef(r.linked_by) : null;
      attach(r.project, {
         ref: { repo: r.repo, number: Number(r.number) },
         title: r.title,
         state: r.state,
         closedAt: num(r.closed_at),
         author: r.author ?? null,
         createdAt: num(r.created_at),
         via: [byLink ? 'link' : 'hand'],
         attachedAt: (linkedBy && opened.get(issueKey(linkedBy))) ?? Number(r.added_at),
         addedBy: r.added_by ?? null,
         linkedBy,
         joinedAt: byLink ? Number(r.added_at) : null,
      });
   }
   const attached = new Map(
      [...bySlug].map(([project, issues]) => [
         project,
         [...issues.values()].map(i =>
            Number.isFinite(i.attachedAt) ? i : { ...i, attachedAt: null }
         ),
      ])
   );
   const links = new Map();
   for (const r of linkRows) {
      const k = issueKey({ repo: r.issue_repo, number: r.issue_number });
      links.set(k, [...(links.get(k) ?? []), { repo: r.pull_repo, number: Number(r.pull_number) }]);
   }
   // a bot's PR never joins a project by a link (that's for people's work),
   // but one an issue links is still a PR its page names, with its state
   const linkedPulls = linkedRows.filter(r => r.date != null);
   const people = linkedPulls.filter(r => !isBot(r.owner));
   const planned = plans.map(p => p.project).filter(Boolean);
   const [pulls, own] = await Promise.all([
      bodies
         ? projectPulls(settings, null, { since, bodiesSince: since })
         : projectPulls(settings, [...new Set(planned)]),
      // the page's project: every PR of it
      slug ? projectPulls(settings, [slug], { bodiesSince: since }) : null,
   ]);
   if (slug) pulls.set(slug, own.get(slug) ?? []);
   const inputs = {
      plans,
      attached,
      pulls,
      unlabeled: people.filter(r => !Number(r.labeled)).map(workPull),
      linked: pullLinksFrom(settings, labelRows, handRows, linkRows),
      links,
      knownPulls: new Map(linkedPulls.map(r => [issueKey(r), workPull(r)])),
      notIssues,
      ownIssues: new Map(records.map(p => [p.slug, { repo: p.repo, number: p.number }])),
      removed,
   };
   if (bodies) inputs.knownIssues = await knownIssues(settings, inputs, slug);
   return inputs;
}

/**
 * What the board knows of the issues projects' PRs link that aren't
 * attached: the suggestions' titles and states, by issueKey. The PRs among
 * them go into `knownPulls`, so a PR is never suggested as an issue, and the
 * issues outside the tracked organizations into `notIssues`, since adding
 * one is refused. Reads the links of one project's labeled PRs (every
 * project's with no `slug`) and of every PR with no project label (a few
 * more than its own; the extra answers go unused).
 */
async function knownIssues(settings, inputs, slug) {
   const attachedKeys = new Set(
      (slug ? inputs.attached.get(slug) ?? [] : []).map(i => issueKey(i.ref))
   );
   const theirs = slug ? inputs.pulls.get(slug) ?? [] : [...inputs.pulls.values()].flat();
   const linked = uniqueRefs(
      [...theirs, ...inputs.unlabeled]
         .flatMap(pr => pr.links)
         .filter(r => !attachedKeys.has(issueKey(r)))
   );
   const refs = [];
   for (const ref of linked) {
      if (trackedRepo(settings, ref.repo)) refs.push(ref);
      else inputs.notIssues.add(issueKey(ref));
   }
   if (!refs.length) return new Map();
   const pairs = [refs.map(r => [r.repo, r.number])];
   const [rows, prRows] = await Promise.all([
      db.query(
         'SELECT `repo`, `number`, `title`, `status`, `state_reason`, `author`, `date_created`, ' +
            '`date_closed` FROM `issues` WHERE (`repo`, `number`) IN (?)',
         pairs
      ),
      db.query(
         'SELECT `repo`, `number`, `title`, `owner`, `date`, `date_merged`, `date_closed`, `state` ' +
            'FROM `pulls` WHERE (`repo`, `number`) IN (?)',
         pairs
      ),
   ]);
   for (const r of prRows) inputs.knownPulls.set(issueKey(r), workPull(r));
   return new Map(
      rows.map(r => [
         issueKey(r),
         {
            repo: r.repo,
            number: Number(r.number),
            title: r.title ?? '',
            state: itemState(r.status, r.state_reason),
            author: r.author ?? null,
            createdAt: num(r.date_created),
            closedAt: num(r.date_closed),
         },
      ])
   );
}

/**
 * Every plan's PRs by the dates (shared/model/work.ts planWork), and how
 * every project's issues stand, by slug. Pass the plans and the project
 * issues when they're already loaded.
 */
export async function loadWork(settings, loaded = {}) {
   const inputs = await workInputs(settings, loaded);
   const now = Date.now() / 1000;
   return {
      plans: planWork(inputs),
      projects: Object.fromEntries(projectCounts(inputs)),
      // each project's issues closed and added lately, for the roadmap's
      // rule on whether a plan still owes an update (shared/model/roadmap.ts)
      pace: Object.fromEntries(
         [...inputs.attached].map(([slug, issues]) => [slug, issuePace(issues, now)])
      ),
   };
}

/** One project's page (shared/model/work.ts projectWork), read the way the
 * sync reads every project (joinLinkedIssues), so the issues it says join
 * on their own are the ones the sync joins. */
export async function loadProjectWork(settings, slug, now = Date.now() / 1000) {
   const since = Math.floor(now) - SUGGEST_DAYS * DAY;
   return projectWork(await workInputs(settings, {}, { slug, since }), slug, now);
}

const SEARCH_QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 10) {
    nodes { ... on Issue { number title state stateReason closedAt createdAt author { login } repository { nameWithOwner } } }
  }
}`;
const SEARCH_CACHE_MS = 60 * 1000;
const searched = new Map();

/** An issue node as a search hit (shared/model/work.ts IssueHit). */
const hitOf = node => ({
   ...refOf(node),
   title: node.title,
   state: itemState(node.state, node.stateReason),
   author: node.author?.login ?? null,
   createdAt: epochOf(node.createdAt),
   closedAt: epochOf(node.closedAt),
});

// GitHub reads only the first 256 characters of a search
const SEARCH_MAX_CHARS = 256;

/**
 * The `repo:` qualifiers for a search of `words`, in as few strings as fit
 * GitHub's query length limit; one search runs per string.
 * ponytail: a single repo name that can't fit beside the words is skipped,
 * and long words leave room for few repos per search.
 */
export function searchQualifiers(words, repos) {
   const room = SEARCH_MAX_CHARS - `${words} is:issue `.length;
   const out = [];
   let cur = '';
   for (const repo of repos) {
      const qual = `repo:${repo}`;
      if (qual.length > room) continue;
      if (cur && cur.length + 1 + qual.length > room) {
         out.push(cur);
         cur = '';
      }
      cur = cur ? `${cur} ${qual}` : qual;
   }
   if (cur) out.push(cur);
   return out;
}

/**
 * Issues to pick from, for what a person typed (shared/model/work.ts
 * issueQuery): the issue a link or "owner/repo#123" names (in one of the
 * board's repos), the issues with that number in every one of them, or
 * GitHub's search of issue titles and bodies in them. Answers are kept
 * a minute. Each hit says which projects have it already.
 */
export async function searchIssues(settings, text) {
   const q = issueQuery(text);
   if (!q) return [];
   const key = JSON.stringify(q);
   const kept = searched.get(key);
   if (kept && Date.now() - kept.at < SEARCH_CACHE_MS) return withProjects(settings, kept.issues);
   let issues;
   if (q.kind === 'words') {
      // only the board's repos, whatever qualifier the words carry
      const repos = new Set(issueRepos(settings).map(r => r.toLowerCase()));
      const search = async quals => {
         const { data, errors } = await queryWithErrors(SEARCH_QUERY, {
            q: `${q.words} is:issue ${quals}`,
         });
         // a rejected search arrives as errors beside a null `search`
         if (!data?.search && errors.length) throw new Error(errors[0].message);
         return data;
      };
      // an answer missing a part isn't kept, so the next try asks again
      let partial = false;
      const found = await Promise.all(
         searchQualifiers(q.words, issueRepos(settings)).map(async quals => {
            try {
               return await search(quals);
            } catch (err) {
               // GitHub rejects the whole search over one repo it can't read
               // (gone, renamed, private), saying so: only then ask for each
               // repo alone and skip the bad. Anything else (a rate limit, a
               // 5xx) would only multiply the calls, so it's the caller's.
               const each = quals.split(' ');
               if (each.length < 2 || !/cannot be searched/i.test(err?.message ?? '')) throw err;
               partial = true;
               const results = await Promise.all(
                  each.map(one =>
                     search(one).catch(e => {
                        console.error('Work: searching %s failed: %s', one, (e && e.message) || e);
                        return null;
                     })
                  )
               );
               if (results.every(r => r == null)) throw err;
               return { search: { nodes: results.flatMap(d => d?.search?.nodes ?? []) } };
            }
         })
      );
      if (partial) {
         return withProjects(
            settings,
            found
               .flatMap(data => data?.search?.nodes ?? [])
               .filter(node => repos.has(node?.repository?.nameWithOwner.toLowerCase()))
               .map(hitOf)
         );
      }
      issues = found
         .flatMap(data => data?.search?.nodes ?? [])
         .filter(node => repos.has(node?.repository?.nameWithOwner.toLowerCase()))
         .map(hitOf);
   } else {
      let refs = issueRepos(settings).map(repo => ({ repo, number: q.number }));
      if (q.kind === 'ref') refs = trackedRepo(settings, q.ref.repo) ? [q.ref] : [];
      const nodes = refs.length ? await batch(refs, STATE_FIELDS) : new Map();
      issues = [...nodes.values()].filter(node => node.__typename === 'Issue').map(hitOf);
   }
   searched.set(key, { at: Date.now(), issues });
   // forget the oldest answers past a hundred
   for (const old of [...searched.keys()].slice(0, Math.max(0, searched.size - 100))) {
      searched.delete(old);
   }
   return withProjects(settings, issues);
}

/** Search hits with the projects each one is in already, by its label, by
 * hand or by a link, read fresh on every search (the hits are kept a
 * minute). */
async function withProjects(settings, hits) {
   if (!hits.length) return hits;
   const [labelRows, handRows] = await Promise.all([
      labeledIssueRows(settings),
      db.query(
         'SELECT `project`, `repo`, `number` FROM `project_issues` WHERE `removed_at` IS NULL'
      ),
   ]);
   const projects = new Map();
   const note = (repo, number, slug) => {
      const k = issueKey({ repo, number: Number(number) });
      projects.set(k, [...new Set([...(projects.get(k) ?? []), slug])]);
   };
   for (const r of labelRows) note(r.repo, r.number, r.label.slice(settings.prefix.length));
   for (const r of handRows) note(r.repo, r.number, r.project);
   return hits.map(hit => ({ ...hit, projects: projects.get(issueKey(hit)) ?? [] }));
}
