import db from './db.js';
import debug from './debug.js';
import git from './git-manager.js';
import { loadProjects } from './projects.js';
import { isBot } from './review-model.js';
import { listItems } from './roadmap.js';
import {
   issueKey,
   itemState,
   parseChecklist,
   planScopes,
   projectOf,
} from '../shared/dist/index.js';

/**
 * Plans' scopes (the model is shared/model/scope.ts). A plan names the issue
 * that specs it; this keeps each spec's sub-issues and checklist lines in
 * `scope_items`, and which PRs close or mention each scope issue in
 * `issue_pull_links`, read off GitHub's GraphQL API. A mention is how
 * "Parts of #N" links a PR to an epic here, so links come from the issue's
 * side: its closing PRs and its cross-references. Reads only; nothing here
 * writes to GitHub.
 *
 * It syncs at startup, hourly, right after a plan's spec changes, and a
 * minute after a webhook touches a spec or scope issue.
 */

const scopeDebug = debug('pulldasher:scope');
/** issues per batched GraphQL query */
const BATCH = 40;
const TITLE_MAX = 255;

const epochOf = iso => (iso ? Math.floor(Date.parse(iso) / 1000) : null);
const clip = text => String(text ?? '').slice(0, TITLE_MAX);
const splitRepo = repo => {
   const [owner, name] = repo.split('/');
   return { owner, name };
};
const uniqueRefs = refs => [...new Map(refs.map(ref => [issueKey(ref), ref])).values()];

const SPEC_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issueOrPullRequest(number: $number) {
      __typename
      ... on Issue {
        title
        body
        subIssues(first: 100) {
          nodes { number title state stateReason closedAt repository { nameWithOwner } }
        }
        timelineItems(last: 100, itemTypes: [SUB_ISSUE_ADDED_EVENT]) {
          nodes { ... on SubIssueAddedEvent { createdAt subIssue { number repository { nameWithOwner } } } }
        }
      }
    }
  }
}`;

const STATE_FIELDS =
   '__typename ... on Issue { title state stateReason closedAt } ' +
   '... on PullRequest { title state merged closedAt }';

const LINK_FIELDS = `__typename ... on Issue {
  closedByPullRequestsReferences(first: 20, includeClosedPrs: true) {
    nodes { number repository { nameWithOwner } }
  }
  timelineItems(first: 60, itemTypes: [CROSS_REFERENCED_EVENT]) {
    nodes { ... on CrossReferencedEvent { source { __typename ... on PullRequest { number repository { nameWithOwner } } } } }
  }
}`;

/**
 * One query for many issues: each repo once, each issue under it by an
 * alias. GitHub answers what it can and lists the rest (a deleted issue) in
 * errors, so a partial answer still counts. Values by issueKey.
 */
async function batch(refs, fields) {
   const out = new Map();
   for (let i = 0; i < refs.length; i += BATCH) {
      const byRepo = new Map();
      for (const ref of refs.slice(i, i + BATCH)) {
         byRepo.set(ref.repo, [...new Set([...(byRepo.get(ref.repo) ?? []), ref.number])]);
      }
      const repos = [...byRepo.keys()];
      const query =
         'query {\n' +
         repos
            .map((repo, r) => {
               const { owner, name } = splitRepo(repo);
               const issues = byRepo
                  .get(repo)
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
         data = await git.graphql(query);
      } catch (err) {
         if (!err || !err.data) throw err;
         data = err.data;
      }
      repos.forEach((repo, r) => {
         for (const [alias, value] of Object.entries(data?.[`r${r}`] ?? {})) {
            if (value) out.set(`${repo}#${alias.slice(1)}`, value);
         }
      });
   }
   return out;
}

/** A GraphQL issue or PR as a scope item's state: a merged PR is done, one
 * closed unmerged dropped. */
function stateOf(node) {
   if (node.__typename === 'PullRequest') {
      return node.merged ? 'done' : node.state === 'CLOSED' ? 'dropped' : 'open';
   }
   return itemState(node.state, node.stateReason);
}

/**
 * Read one spec issue: its sub-issues, each with when it joined (its
 * latest sub-issue-added event), then its checklist lines. A line naming an
 * issue takes that issue's state, since boxes go stale; a plain line is
 * done when checked. An issue listed twice counts once.
 */
export async function fetchSpec(spec) {
   const { owner, name } = splitRepo(spec.repo);
   const data = await git.graphql(SPEC_QUERY, { owner, name, number: spec.number });
   const issue = data?.repository?.issueOrPullRequest;
   if (!issue || issue.__typename !== 'Issue') {
      return { title: issue?.title ? clip(issue.title) : null, found: false, items: [] };
   }
   const joined = new Map();
   for (const event of issue.timelineItems?.nodes ?? []) {
      if (!event?.subIssue) continue;
      const k = `${event.subIssue.repository.nameWithOwner}#${event.subIssue.number}`;
      joined.set(k, Math.max(joined.get(k) ?? 0, epochOf(event.createdAt) ?? 0));
   }
   const items = [];
   const seen = new Set();
   for (const sub of issue.subIssues?.nodes ?? []) {
      const ref = { repo: sub.repository.nameWithOwner, number: sub.number };
      seen.add(issueKey(ref));
      items.push({
         source: 'sub',
         ref,
         title: clip(sub.title),
         state: itemState(sub.state, sub.stateReason),
         closedAt: epochOf(sub.closedAt),
         joinedAt: joined.get(issueKey(ref)) || null,
      });
   }
   const lines = parseChecklist(issue.body, spec.repo);
   const named = uniqueRefs(lines.filter(l => l.ref && !seen.has(issueKey(l.ref))).map(l => l.ref));
   const states = named.length ? await batch(named, STATE_FIELDS) : new Map();
   for (const line of lines) {
      if (line.ref && seen.has(issueKey(line.ref))) continue;
      if (line.ref) seen.add(issueKey(line.ref));
      const node = line.ref ? states.get(issueKey(line.ref)) : null;
      items.push({
         source: 'check',
         ref: line.ref,
         title: clip(node?.title ?? line.text),
         state: node ? stateOf(node) : line.checked ? 'done' : 'open',
         closedAt: epochOf(node?.closedAt),
         joinedAt: null,
      });
   }
   return { title: clip(issue.title), found: true, items };
}

/**
 * Which PRs close or mention each issue: its closing references (a closing
 * keyword or the Development sidebar) and every PR that cross-references
 * it, which is how "Parts of #N" shows up. Values by issueKey.
 */
export async function fetchLinks(refs) {
   const nodes = await batch(refs, LINK_FIELDS);
   const out = new Map();
   for (const [k, node] of nodes) {
      if (node.__typename !== 'Issue') continue;
      const prs = new Map();
      for (const pr of node.timelineItems?.nodes ?? []) {
         const source = pr?.source;
         if (source?.__typename !== 'PullRequest') continue;
         const ref = { repo: source.repository.nameWithOwner, number: source.number };
         prs.set(issueKey(ref), { ...ref, closes: false });
      }
      for (const pr of node.closedByPullRequestsReferences?.nodes ?? []) {
         const ref = { repo: pr.repository.nameWithOwner, number: pr.number };
         prs.set(issueKey(ref), { ...ref, closes: true });
      }
      out.set(k, [...prs.values()]);
   }
   return out;
}

async function storeSpec(spec, result, now) {
   await db.query('DELETE FROM `scope_items` WHERE `spec_repo` = ? AND `spec_number` = ?', [
      spec.repo,
      spec.number,
   ]);
   if (result.items.length) {
      await db.query(
         'INSERT INTO `scope_items` (`spec_repo`, `spec_number`, `position`, `source`, `repo`, ' +
            '`number`, `title`, `state`, `closed_at`, `joined_at`) VALUES ?',
         [
            result.items.map((item, i) => [
               spec.repo,
               spec.number,
               i,
               item.source,
               item.ref?.repo ?? null,
               item.ref?.number ?? null,
               item.title,
               item.state,
               item.closedAt,
               item.joinedAt,
            ]),
         ]
      );
   }
   await db.query('REPLACE INTO `scope_specs` SET ?', [
      {
         repo: spec.repo,
         number: spec.number,
         title: result.title,
         found: result.found ? 1 : 0,
         synced_at: now,
      },
   ]);
}

async function storeLinks(links) {
   if (!links.size) return;
   const issues = [...links.keys()].map(k => {
      const at = k.lastIndexOf('#');
      return [k.slice(0, at), Number(k.slice(at + 1))];
   });
   await db.query('DELETE FROM `issue_pull_links` WHERE (`issue_repo`, `issue_number`) IN (?)', [
      issues,
   ]);
   const rows = issues.flatMap(([repo, number]) =>
      links
         .get(`${repo}#${number}`)
         .map(pr => [repo, number, pr.repo, pr.number, pr.closes ? 1 : 0])
   );
   if (rows.length) {
      await db.query(
         'INSERT INTO `issue_pull_links` (`issue_repo`, `issue_number`, `pull_repo`, ' +
            '`pull_number`, `closes`) VALUES ?',
         [rows]
      );
   }
}

/** Issues carrying a project label, with the label: project issues and the
 * issues people labeled into a project's scope. */
function labeledIssueRows(settings) {
   const like = settings.prefix.replace(/[\\%_]/g, '\\$&') + '%';
   return db.query(
      'SELECT i.repo, i.number, i.title, i.status, i.state_reason, i.date_closed, ' +
         'l.title AS label, l.date AS labeled_at FROM issues i ' +
         'JOIN pull_labels l ON l.repo = i.repo AND l.number = i.number WHERE l.title LIKE ?',
      [like]
   );
}

// the spec and scope issues the last sync read, so a webhook on one of them
// can ask for a fresh read
let watched = new Set();
let running = null;
let pending = null;

/**
 * Read every plan's spec and every scope issue's links off GitHub and store
 * them. One sync at a time: a second caller gets the running one.
 */
export function syncScope(settings) {
   if (!settings) return Promise.resolve();
   if (!running) {
      running = doSync(settings).finally(() => {
         running = null;
      });
   }
   return running;
}

async function doSync(settings) {
   const now = Math.floor(Date.now() / 1000);
   const plans = await listItems();
   const specs = uniqueRefs(plans.filter(p => p.spec).map(p => p.spec));
   const refs = [];
   let failed = 0;
   for (const spec of specs) {
      try {
         const result = await fetchSpec(spec);
         await storeSpec(spec, result, now);
         refs.push(...result.items.filter(i => i.ref).map(i => i.ref));
      } catch (err) {
         failed++;
         console.error('Scope: reading %s failed: %s', issueKey(spec), (err && err.message) || err);
      }
   }
   // specs no plan names anymore
   if (specs.length) {
      const keys = specs.map(s => [s.repo, s.number]);
      await db.query('DELETE FROM `scope_items` WHERE (`spec_repo`, `spec_number`) NOT IN (?)', [
         keys,
      ]);
      await db.query('DELETE FROM `scope_specs` WHERE (`repo`, `number`) NOT IN (?)', [keys]);
   } else {
      await db.query('DELETE FROM `scope_items`');
      await db.query('DELETE FROM `scope_specs`');
   }
   const labeled = (await labeledIssueRows(settings)).map(r => ({
      repo: r.repo,
      number: Number(r.number),
   }));
   const all = uniqueRefs([...refs, ...labeled]);
   try {
      await storeLinks(await fetchLinks(all));
   } catch (err) {
      failed++;
      console.error('Scope: reading links failed: %s', (err && err.message) || err);
   }
   watched = new Set([...specs, ...all].map(issueKey));
   scopeDebug('synced %d specs and %d scope issues, %d failed', specs.length, all.length, failed);
}

/**
 * A webhook touched an issue: when it's a spec or a scope issue, read the
 * scopes again a minute from now (one read covers a burst of edits).
 */
export function scopeIssueTouched(settings, repo, number) {
   if (!settings || !watched.has(`${repo}#${number}`) || pending) return;
   pending = setTimeout(() => {
      pending = null;
      syncScope(settings).catch(err =>
         console.error('Scope sync failed: %s', (err && err.message) || err)
      );
   }, 60 * 1000);
}

/**
 * Every plan's scope, built from what's stored: the specs' items, the
 * issues labeled into a project, the projects' PRs (people's, not bots'),
 * and the links between them (shared/model/scope.ts planScopes).
 */
export async function loadScope(settings) {
   const plans = await listItems();
   const [specRows, itemRows, linkRows, labelRows, records] = await Promise.all([
      db.query('SELECT `repo`, `number`, `title`, `found` FROM `scope_specs`'),
      db.query(
         'SELECT `spec_repo`, `spec_number`, `source`, `repo`, `number`, `title`, `state`, ' +
            '`closed_at`, `joined_at` FROM `scope_items` ORDER BY `spec_repo`, `spec_number`, `position`'
      ),
      db.query(
         'SELECT `issue_repo`, `issue_number`, `pull_repo`, `pull_number` FROM `issue_pull_links`'
      ),
      labeledIssueRows(settings),
      loadProjects(settings),
   ]);
   const specs = new Map(
      specRows.map(r => [
         `${r.repo}#${r.number}`,
         { title: r.title || null, found: Boolean(r.found), items: [] },
      ])
   );
   for (const r of itemRows) {
      specs.get(`${r.spec_repo}#${r.spec_number}`)?.items.push({
         source: r.source,
         ref: r.repo ? { repo: r.repo, number: Number(r.number) } : null,
         title: r.title,
         state: r.state,
         closedAt: r.closed_at == null ? null : Number(r.closed_at),
         joinedAt: r.joined_at == null ? null : Number(r.joined_at),
      });
   }
   // a project's own issue and a plan's spec issue aren't scope items
   const notScope = new Set([
      ...records.map(p => `${p.repo}#${p.number}`),
      ...plans.filter(p => p.spec).map(p => issueKey(p.spec)),
   ]);
   const labeled = new Map();
   for (const r of labelRows) {
      const k = `${r.repo}#${r.number}`;
      if (notScope.has(k)) continue;
      const slug = r.label.slice(settings.prefix.length);
      labeled.set(slug, [
         ...(labeled.get(slug) ?? []),
         {
            source: 'label',
            ref: { repo: r.repo, number: Number(r.number) },
            title: r.title,
            state: itemState(r.status, r.state_reason),
            closedAt: r.date_closed == null ? null : Number(r.date_closed),
            joinedAt: r.labeled_at == null ? null : Number(r.labeled_at),
         },
      ]);
   }
   const pulls = await projectPulls(settings, [
      ...new Set(plans.map(p => p.project).filter(Boolean)),
   ]);
   const links = new Map();
   for (const r of linkRows) {
      const pr = `${r.pull_repo}#${r.pull_number}`;
      links.set(pr, [
         ...(links.get(pr) ?? []),
         { repo: r.issue_repo, number: Number(r.issue_number) },
      ]);
   }
   return planScopes({ plans, specs, labeled, pulls, links });
}

/** Every PR (people's) whose project is one of `slugs`, by slug, by the
 * same project rule Today uses. */
async function projectPulls(settings, slugs) {
   if (!slugs.length) return new Map();
   const like = settings.prefix.replace(/[\\%_]/g, '\\$&') + '%';
   const rows = await db.query(
      'SELECT p.repo, p.number, p.title, p.owner, p.date, p.date_merged, p.state, l.title AS label ' +
         'FROM pulls p JOIN pull_labels l ON l.repo = p.repo AND l.number = p.number ' +
         'WHERE l.title LIKE ?',
      [like]
   );
   const byPull = new Map();
   for (const r of rows) {
      const k = `${r.repo}#${r.number}`;
      const pull = byPull.get(k) ?? { row: r, labels: [] };
      pull.labels.push({ title: r.label });
      byPull.set(k, pull);
   }
   const wanted = new Set(slugs);
   const out = new Map();
   for (const { row, labels } of byPull.values()) {
      const slug = projectOf(labels, settings.prefix);
      if (!wanted.has(slug) || isBot(row.owner) || row.date == null) continue;
      out.set(slug, [
         ...(out.get(slug) ?? []),
         {
            repo: row.repo,
            number: Number(row.number),
            title: row.title,
            author: row.owner,
            createdAt: Number(row.date),
            mergedAt: row.date_merged == null ? null : Number(row.date_merged),
            state: row.state,
         },
      ]);
   }
   return out;
}
