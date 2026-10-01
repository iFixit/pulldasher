import db from './db.js';
import debug from './debug.js';
import git from './git-manager.js';
import { issueRepos, loadProjects } from './projects.js';
import { isBot } from './review-model.js';
import { listItems } from './roadmap.js';
import {
   MISC_SLUG,
   bodyLinks,
   issueKey,
   issueQuery,
   itemState,
   planWork,
   projectCounts,
   projectOf,
   projectWork,
} from '../shared/dist/index.js';

/**
 * Projects' work (the model is shared/model/work.ts): the issues attached to
 * each project, by its label or by hand on the board, and the PRs that link
 * them. This keeps the issues added by hand in `project_issues`, and which
 * PRs link each attached issue in `issue_pull_links`, read off GitHub's
 * GraphQL API. "Parts of #N" in a PR's body is how a PR links an issue here,
 * and GitHub records it only as a mention, so links come from the issue's
 * side: its closing PRs, and the PRs that mention it with a linking phrase
 * (bodyLinks). It also searches GitHub's issues for the board's picker.
 * Reads only; nothing here writes to GitHub.
 *
 * It syncs at startup, hourly, and a minute after a webhook touches an
 * attached issue.
 */

const workDebug = debug('pulldasher:work');
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
 * issue as an error beside the data it could read. */
async function query(text, variables) {
   try {
      return await git.graphql(text, variables);
   } catch (err) {
      if (err && err.data) return err.data;
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
 * with `skipFailed` is left out, so the others still count.
 */
async function batch(refs, fields, { skipFailed = false } = {}) {
   const out = new Map();
   for (let i = 0; i < refs.length; i += BATCH) {
      const chunk = refs.slice(i, i + BATCH);
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
      try {
         data = await query(text);
      } catch (err) {
         if (!skipFailed) throw err;
         const why = (err && err.message) || err;
         console.error('Work: a batch of %d issues failed: %s', chunk.length, why);
         continue;
      }
      repos.forEach(({ name: repo }, r) => {
         for (const [alias, value] of Object.entries(data?.[`r${r}`] ?? {})) {
            if (value) out.set(issueKey({ repo, number: Number(alias.slice(1)) }), value);
         }
      });
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

async function storeLinks(links) {
   if (!links.size) return;
   const issues = [...links.values()].map(({ ref }) => [ref.repo, ref.number]);
   await db.query('DELETE FROM `issue_pull_links` WHERE (`issue_repo`, `issue_number`) IN (?)', [
      issues,
   ]);
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
   '`added_by`, `added_at`';

// the issues the last sync read, so a webhook on one of them can ask for a
// fresh read
let watched = new Set();
let running = null;
let again = false;
let pending = null;

/** Whether a repo is in an organization the board tracks. */
const trackedRepo = (settings, repo) =>
   issueRepos(settings).some(
      r => r.split('/')[0].toLowerCase() === repo.split('/')[0].toLowerCase()
   );

/**
 * Add an issue to a project by hand. It's read off GitHub first, with the
 * PRs that link it, so its title, state and PRs show at once (the hourly
 * sync keeps them current). Resolves {issue} (a project_issues row);
 * {missing} when GitHub has no such issue; or {refused} with why: a PR (its
 * project comes from its label), an issue outside the tracked
 * organizations, or a project's own issue, which names the project rather
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
      return { refused: 'That repo isn’t in an organization this board tracks.' };
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
   // added already: keep who added it first
   await db.query('INSERT IGNORE INTO `project_issues` SET ?', [row]);
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
   return { issue: kept ?? row };
}

/** Take an issue added by hand off a project. Resolves whether it was there. */
export async function detachIssue(project, ref) {
   const res = await db.query(
      'DELETE FROM `project_issues` WHERE `project` = ? AND `repo` = ? AND `number` = ?',
      [project, ref.repo, ref.number]
   );
   return res.affectedRows > 0;
}

/** Read the issues added by hand off GitHub again, and keep their titles
 * and states current. Resolves their refs. */
async function refreshHandIssues() {
   const rows = await db.query('SELECT DISTINCT `repo`, `number` FROM `project_issues`');
   const refs = uniqueRefs(rows.map(r => ({ repo: r.repo, number: Number(r.number) })));
   const nodes = refs.length ? await batch(refs, STATE_FIELDS, { skipFailed: true }) : new Map();
   for (const ref of refs) {
      const node = nodes.get(issueKey(ref));
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
 * Read the issues added by hand, and the PRs that link every attached
 * issue, off GitHub and store them. One sync at a time: a call during a
 * sync gets one more sync after it.
 */
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
   // added to, never replaced: an issue added by hand during this sync stays
   // watched (a key left over only costs a sync a webhook asked for)
   for (const ref of all) watched.add(issueKey(ref));
   workDebug('synced %d attached issues, %d failed', all.length, failed);
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

/** Every PR (people's) whose project is one of `slugs`, by slug, by the
 * same project rule Today uses. Only PRs carrying one of those labels are
 * read, each with all its project labels, since the rule weighs them all;
 * `bodies` reads their bodies too, for the issues they link. */
async function projectPulls(settings, slugs, bodies = false) {
   if (!slugs.length) return new Map();
   const rows = await db.query(
      'SELECT p.repo, p.number, p.title, p.owner, p.date, p.date_merged, p.date_closed, p.state, ' +
         `${bodies ? 'p.body, ' : ''}l.title AS label ` +
         'FROM pulls p JOIN pull_labels l ON l.repo = p.repo AND l.number = p.number ' +
         'WHERE l.title LIKE ? AND (p.repo, p.number) IN ' +
         '(SELECT `repo`, `number` FROM pull_labels WHERE `title` IN (?))',
      [likePrefix(settings), slugs.map(slug => settings.prefix + slug)]
   );
   const byPull = new Map();
   for (const r of rows) {
      const k = issueKey(r);
      const pull = byPull.get(k) ?? { row: r, labels: [] };
      pull.labels.push({ title: r.label });
      byPull.set(k, pull);
   }
   const wanted = new Set(slugs);
   const out = new Map();
   for (const { row, labels } of byPull.values()) {
      const slug = projectOf(labels, settings.prefix);
      if (!wanted.has(slug) || isBot(row.owner) || row.date == null) continue;
      out.set(slug, [...(out.get(slug) ?? []), workPull(row)]);
   }
   return out;
}

/**
 * What projects' work is built from (shared/model/work.ts WorkInputs), out
 * of what's stored: each project's attached issues (by its label, by hand,
 * or both, as one issue), the PRs that link them, and the projects' PRs.
 * Pass the plans and project issues when they're already loaded. With
 * `slug`, its PRs come with their bodies (the issues they link), and the
 * board's knowledge of linked PRs and issues comes along for its page.
 */
async function workInputs(settings, loaded = {}, slug = null) {
   const [plans, records, linkRows, labelRows, handRows, linkedRows] = await Promise.all([
      loaded.plans ?? listItems(),
      loaded.projects ?? loadProjects(settings),
      db.query(
         'SELECT `issue_repo`, `issue_number`, `pull_repo`, `pull_number` FROM `issue_pull_links`'
      ),
      labeledIssueRows(settings),
      db.query(`SELECT ${HAND_COLUMNS} FROM \`project_issues\``),
      // every PR that links an attached issue, with whether a project's label
      // claims it (misc holds unsorted work, not a project)
      db.query(
         'SELECT DISTINCT p.repo, p.number, p.title, p.owner, p.date, p.date_merged, p.date_closed, ' +
            `p.state, ${
               slug ? 'p.body, ' : ''
            }EXISTS (SELECT 1 FROM pull_labels l WHERE l.repo = p.repo AND ` +
            'l.number = p.number AND l.title LIKE ? AND l.title <> ?) AS labeled ' +
            'FROM `issue_pull_links` k ' +
            'JOIN pulls p ON p.repo = k.pull_repo AND p.number = k.pull_number',
         [likePrefix(settings), settings.prefix + MISC_SLUG]
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
              }
            : issue
      );
      bySlug.set(project, issues);
   };
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
   for (const r of handRows) {
      attach(r.project, {
         ref: { repo: r.repo, number: Number(r.number) },
         title: r.title,
         state: r.state,
         closedAt: num(r.closed_at),
         author: r.author ?? null,
         createdAt: num(r.created_at),
         via: ['hand'],
         attachedAt: Number(r.added_at),
         addedBy: r.added_by ?? null,
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
   const linked = linkedRows.filter(r => !isBot(r.owner) && r.date != null);
   const planned = plans.map(p => p.project).filter(Boolean);
   const pulls = await projectPulls(settings, [...new Set([...planned, ...(slug ? [slug] : [])])]);
   if (slug) {
      // the page's project: its PRs with their bodies, for the issues they link
      const withBodies = await projectPulls(settings, [slug], true);
      pulls.set(slug, withBodies.get(slug) ?? []);
   }
   const inputs = {
      plans,
      attached,
      pulls,
      unlabeled: linked.filter(r => !Number(r.labeled)).map(workPull),
      links,
      knownPulls: new Map(linked.map(r => [issueKey(r), workPull(r)])),
      notIssues,
   };
   if (slug) inputs.knownIssues = await knownIssues(inputs, slug);
   return inputs;
}

/**
 * What the board knows of the issues a project's PRs link that aren't
 * attached: the suggestions' titles and states, by issueKey. The PRs among
 * them go into `knownPulls`, so a PR is never suggested as an issue. Reads
 * the links of its labeled PRs and of every PR with no project label (a
 * few more than its own; the extra answers go unused).
 */
async function knownIssues(inputs, slug) {
   const attachedKeys = new Set((inputs.attached.get(slug) ?? []).map(i => issueKey(i.ref)));
   const refs = uniqueRefs(
      [...(inputs.pulls.get(slug) ?? []), ...inputs.unlabeled]
         .flatMap(pr => pr.links)
         .filter(r => !attachedKeys.has(issueKey(r)))
   );
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
   return {
      plans: planWork(inputs),
      projects: Object.fromEntries(projectCounts(inputs)),
   };
}

/** One project's page (shared/model/work.ts projectWork). */
export async function loadProjectWork(settings, slug) {
   return projectWork(await workInputs(settings, {}, slug), slug);
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

/**
 * Issues to pick from, for what a person typed (shared/model/work.ts
 * issueQuery): the issue a link or "owner/repo#123" names (in a tracked
 * organization), the issues with that number in every tracked repo, or
 * GitHub's search of issue titles and bodies in the tracked repos'
 * organizations. Answers are kept a minute. Each hit says which projects
 * have it already.
 */
export async function searchIssues(settings, text) {
   const q = issueQuery(text);
   if (!q) return [];
   const key = JSON.stringify(q);
   const kept = searched.get(key);
   if (kept && Date.now() - kept.at < SEARCH_CACHE_MS) return kept.issues;
   let issues;
   if (q.kind === 'words') {
      const owners = [...new Set(issueRepos(settings).map(repo => repo.split('/')[0]))];
      const data = await query(SEARCH_QUERY, {
         q: `${q.words} is:issue ${owners.map(o => `org:${o}`).join(' ')}`,
      });
      // a qualifier in the words ("org:other") widens GitHub's search, so
      // only the tracked repos' organizations count
      const tracked = new Set(owners.map(o => o.toLowerCase()));
      issues = (data?.search?.nodes ?? [])
         .filter(node => tracked.has(node?.repository?.nameWithOwner.split('/')[0].toLowerCase()))
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

/** Search hits with the projects each one is in already, by its label or
 * by hand, read fresh on every search (the hits are kept a minute). */
async function withProjects(settings, hits) {
   if (!hits.length) return hits;
   const [labelRows, handRows] = await Promise.all([
      labeledIssueRows(settings),
      db.query('SELECT `project`, `repo`, `number` FROM `project_issues`'),
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
