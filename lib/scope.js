import db from './db.js';
import debug from './debug.js';
import git from './git-manager.js';
import { loadProjects } from './projects.js';
import { isBot } from './review-model.js';
import { listItems } from './roadmap.js';
import {
   MISC_SLUG,
   bodyLinks,
   issueKey,
   issueText,
   itemState,
   parseChecklist,
   planScopes,
   projectOf,
} from '../shared/dist/index.js';

/**
 * Plans' scopes (the model is shared/model/scope.ts). A plan names the issue
 * that specs it; this keeps each spec's sub-issues and checklist lines in
 * `scope_items`, and which PRs link each scope issue (and each spec issue)
 * in `issue_pull_links`, read off GitHub's GraphQL API. "Parts of #N" in a
 * PR's body is how a PR links an epic here, and GitHub records it only as
 * a mention, so links come from the issue's side: its closing PRs, and the
 * PRs that mention it with a linking phrase (shared/model/scope.ts
 * bodyLinks). Reads only; nothing here writes to GitHub.
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
const refOf = node => ({ repo: node.repository.nameWithOwner, number: node.number });
const uniqueRefs = refs => [...new Map(refs.map(ref => [issueKey(ref), ref])).values()];

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

const SPEC_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issueOrPullRequest(number: $number) {
      __typename
      ... on Issue {
        title
        body
        state
        stateReason
        closedAt
        createdAt
        lastEditedAt
        repository { nameWithOwner }
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
   '__typename ... on Issue { number title state stateReason closedAt ' +
   'repository { nameWithOwner } parent { number repository { nameWithOwner } } } ' +
   '... on PullRequest { number title state merged closedAt repository { nameWithOwner } }';

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
         console.error('Scope: a batch of %d issues failed: %s', chunk.length, why);
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

/** A GraphQL issue or PR as a scope item's state: a merged PR is done, one
 * closed unmerged dropped. */
function stateOf(node) {
   if (node.__typename === 'PullRequest') {
      return node.merged ? 'done' : node.state === 'CLOSED' ? 'dropped' : 'open';
   }
   return itemState(node.state, node.stateReason);
}

/**
 * Read one spec issue: its sub-issues, each with when it joined (its latest
 * sub-issue-added event), then its checklist lines. A line standing for an
 * issue takes that issue's state, since boxes go stale, and is left out
 * when its issue's parent is already in the scope (it's part of that one).
 * A plain line is done when checked, as of the spec's last edit; once the
 * spec issue is closed, its plain lines close with it. An issue listed
 * twice counts once.
 */
export async function fetchSpec(spec) {
   const { owner, name } = splitRepo(spec.repo);
   const data = await query(SPEC_QUERY, { owner, name, number: spec.number });
   const issue = data?.repository?.issueOrPullRequest;
   if (!issue || issue.__typename !== 'Issue') {
      return { title: issue?.title ? clip(issue.title) : null, found: false, items: [] };
   }
   const joined = new Map();
   for (const event of issue.timelineItems?.nodes ?? []) {
      if (!event?.subIssue) continue;
      const k = issueKey(refOf(event.subIssue));
      joined.set(k, Math.max(joined.get(k) ?? 0, epochOf(event.createdAt) ?? 0));
   }
   const items = [];
   const seen = new Set();
   for (const sub of issue.subIssues?.nodes ?? []) {
      if (!sub) continue;
      const ref = refOf(sub);
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
   // "#123" means the spec's own repo, as GitHub spells it
   const home = issue.repository?.nameWithOwner ?? spec.repo;
   const lines = parseChecklist(issue.body, home);
   const named = uniqueRefs(lines.filter(l => l.ref && !seen.has(issueKey(l.ref))).map(l => l.ref));
   const states = named.length ? await batch(named, STATE_FIELDS) : new Map();
   const inScope = new Set([...seen, ...states.keys()]);
   const specClosed = issue.state === 'CLOSED';
   const edited = epochOf(issue.lastEditedAt ?? issue.createdAt);
   for (const line of lines) {
      const k = line.ref ? issueKey(line.ref) : null;
      if (k && seen.has(k)) continue;
      if (k) seen.add(k);
      const node = k ? states.get(k) : null;
      if (node?.parent && inScope.has(issueKey(refOf(node.parent)))) continue;
      let state;
      let closedAt = null;
      if (node) {
         state = stateOf(node);
         closedAt = epochOf(node.closedAt);
      } else if (line.checked) {
         state = 'done';
         closedAt = edited;
      } else if (specClosed) {
         state = itemState('closed', issue.stateReason);
         closedAt = epochOf(issue.closedAt);
      } else {
         state = 'open';
      }
      items.push({
         source: 'check',
         ref: node?.repository ? refOf(node) : line.ref,
         title: clip(node?.title ?? line.text),
         state,
         closedAt,
         joinedAt: null,
      });
   }
   // the spec as GitHub spells it, for its links
   return {
      title: clip(issue.title),
      found: true,
      items,
      ref: { repo: home, number: spec.number },
   };
}

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
 * issues people labeled into a project's scope. */
function labeledIssueRows(settings) {
   return db.query(
      'SELECT i.repo, i.number, i.title, i.status, i.state_reason, i.date_closed, ' +
         'l.title AS label, l.date AS labeled_at FROM issues i ' +
         'JOIN pull_labels l ON l.repo = i.repo AND l.number = i.number WHERE l.title LIKE ?',
      [likePrefix(settings)]
   );
}

// the spec and scope issues the last sync read, so a webhook on one of them
// can ask for a fresh read
let watched = new Set();
let running = null;
let again = false;
let pending = null;

/**
 * Read every plan's spec and every scope issue's links off GitHub and store
 * them. One sync at a time: a call during a sync gets one more sync after
 * it, since the running one may have read the plans before a change.
 */
export function syncScope(settings) {
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
   const now = Math.floor(Date.now() / 1000);
   const plans = await listItems();
   const specs = uniqueRefs(plans.filter(p => p.spec).map(p => p.spec));
   const refs = [];
   const read = [];
   let failed = 0;
   for (const spec of specs) {
      try {
         const result = await fetchSpec(spec);
         await storeSpec(spec, result, now);
         if (result.ref) read.push(result.ref);
         refs.push(...result.items.filter(i => i.ref).map(i => i.ref));
      } catch (err) {
         failed++;
         const why = (err && err.message) || err;
         console.error('Scope: reading %s failed: %s', issueText(spec), why);
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
   // a PR saying "Parts of #N" about the spec issue itself links its plan too
   const all = uniqueRefs([...read, ...refs, ...labeled]);
   try {
      await storeLinks(await fetchLinks(all));
   } catch (err) {
      failed++;
      console.error('Scope: reading links failed: %s', (err && err.message) || err);
   }
   // a spec whose read failed is watched too, so a fix to it is read soon
   watched = new Set([...specs, ...all].map(issueKey));
   scopeDebug('synced %d specs and %d scope issues, %d failed', specs.length, all.length, failed);
}

/**
 * A webhook touched an issue: when it's a spec or a scope issue, read the
 * scopes again a minute from now (one read covers a burst of edits).
 */
export function scopeIssueTouched(settings, repo, number) {
   if (!settings || !watched.has(issueKey({ repo, number })) || pending) return;
   pending = setTimeout(() => {
      pending = null;
      syncScope(settings).catch(err =>
         console.error('Scope sync failed: %s', (err && err.message) || err)
      );
   }, 60 * 1000);
}

/** A pulls row as the scope reads a PR. */
const workPull = row => ({
   repo: row.repo,
   number: Number(row.number),
   title: row.title,
   author: row.owner,
   createdAt: Number(row.date),
   mergedAt: row.date_merged == null ? null : Number(row.date_merged),
   state: row.state,
});

/**
 * Every plan's scope, built from what's stored: the specs' items, the
 * issues labeled into a project, the projects' PRs (people's, not bots'),
 * the PRs with no project label that link a scope, and the links between
 * them (shared/model/scope.ts planScopes). Pass the plans and the project
 * issues when they're already loaded.
 */
export async function loadScope(settings, loaded = {}) {
   const [plans, records, specRows, itemRows, linkRows, labelRows, unlabeledRows] =
      await Promise.all([
         loaded.plans ?? listItems(),
         loaded.projects ?? loadProjects(settings),
         db.query('SELECT `repo`, `number`, `title`, `found` FROM `scope_specs`'),
         db.query(
            'SELECT `spec_repo`, `spec_number`, `source`, `repo`, `number`, `title`, `state`, ' +
               '`closed_at`, `joined_at` FROM `scope_items` ' +
               'ORDER BY `spec_repo`, `spec_number`, `position`'
         ),
         db.query(
            'SELECT `issue_repo`, `issue_number`, `pull_repo`, `pull_number` FROM `issue_pull_links`'
         ),
         labeledIssueRows(settings),
         // the linked PRs no project claims; misc holds unsorted work, not a project
         db.query(
            'SELECT DISTINCT p.repo, p.number, p.title, p.owner, p.date, p.date_merged, p.state ' +
               'FROM `issue_pull_links` k ' +
               'JOIN pulls p ON p.repo = k.pull_repo AND p.number = k.pull_number ' +
               'WHERE NOT EXISTS (SELECT 1 FROM pull_labels l WHERE l.repo = p.repo AND ' +
               'l.number = p.number AND l.title LIKE ? AND l.title <> ?)',
            [likePrefix(settings), settings.prefix + MISC_SLUG]
         ),
      ]);
   const specs = new Map(
      specRows.map(r => [
         issueKey({ repo: r.repo, number: r.number }),
         { title: r.title || null, found: Boolean(r.found), items: [] },
      ])
   );
   for (const r of itemRows) {
      specs.get(issueKey({ repo: r.spec_repo, number: r.spec_number }))?.items.push({
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
      ...records.map(p => issueKey(p)),
      ...plans.filter(p => p.spec).map(p => issueKey(p.spec)),
   ]);
   const labeled = new Map();
   for (const r of labelRows) {
      const ref = { repo: r.repo, number: Number(r.number) };
      if (notScope.has(issueKey(ref))) continue;
      const slug = r.label.slice(settings.prefix.length);
      labeled.set(slug, [
         ...(labeled.get(slug) ?? []),
         {
            source: 'label',
            ref,
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
      const pr = issueKey({ repo: r.pull_repo, number: r.pull_number });
      links.set(pr, [
         ...(links.get(pr) ?? []),
         { repo: r.issue_repo, number: Number(r.issue_number) },
      ]);
   }
   const unlabeled = unlabeledRows.filter(r => !isBot(r.owner) && r.date != null).map(workPull);
   return planScopes({ plans, specs, labeled, pulls, links, unlabeled });
}

/** Every PR (people's) whose project is one of `slugs`, by slug, by the
 * same project rule Today uses. Only PRs carrying one of those labels are
 * read, each with all its project labels, since the rule weighs them all. */
async function projectPulls(settings, slugs) {
   if (!slugs.length) return new Map();
   const rows = await db.query(
      'SELECT p.repo, p.number, p.title, p.owner, p.date, p.date_merged, p.state, l.title AS label ' +
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
