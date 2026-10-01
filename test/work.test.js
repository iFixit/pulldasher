import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import db from '../lib/db.js';
import git from '../lib/git-manager.js';
import {
   attachIssue,
   detachIssue,
   loadProjectWork,
   loadWork,
   searchIssues,
   syncWork,
} from '../lib/work.js';

const at = day => Date.parse(`${day}T12:00:00Z`) / 1000;
const iso = day => `${day}T12:00:00Z`;
const repo = nameWithOwner => ({ nameWithOwner });
const ifixit = repo('iFixit/ifixit');

// What GitHub holds: issues as single lookups see them, and which PRs link
// each attached issue from the issue's side.
const issueNode = (number, title, over = {}) => ({
   __typename: 'Issue',
   number,
   title,
   state: 'OPEN',
   stateReason: null,
   closedAt: null,
   createdAt: iso('2026-07-01'),
   author: { login: 'gus' },
   repository: ifixit,
   ...over,
});
const STATES = {
   'ifixit/ifixit#106': issueNode(106, 'Print stickers', { createdAt: iso('2026-09-02') }),
   'ifixit/ifixit#201': {
      __typename: 'PullRequest',
      number: 201,
      title: 'PR 201',
      repository: ifixit,
   },
   'test/projects#1': issueNode(1, 'Workbench', { repository: repo('test/projects') }),
   'test/repo-a#5': issueNode(5, 'Print stickers for the bench', {
      repository: repo('test/repo-a'),
   }),
};
const pr = (number, body = '') => ({ number, body, repository: ifixit });
const LINKS = {
   'ifixit/ifixit#101': {
      __typename: 'Issue',
      closedByPullRequestsReferences: { nodes: [pr(201)] },
      timelineItems: {
         nodes: [
            { source: { __typename: 'PullRequest', ...pr(202, 'Parts of #101') } },
            // a mention in passing isn't a link
            { source: { __typename: 'PullRequest', ...pr(205, 'Unlike #101, this keeps it') } },
            { source: { __typename: 'Issue' } },
         ],
      },
   },
   'ifixit/ifixit#102': {
      __typename: 'Issue',
      closedByPullRequestsReferences: { nodes: [] },
      timelineItems: {
         nodes: [{ source: { __typename: 'PullRequest', ...pr(203, 'Parts of #102') } }],
      },
   },
   'ifixit/ifixit#106': {
      __typename: 'Issue',
      closedByPullRequestsReferences: { nodes: [] },
      timelineItems: {
         nodes: [{ source: { __typename: 'PullRequest', ...pr(207, 'Parts of #106') } }],
      },
   },
};

let searches = [];
/** Answer a query the way GitHub would: repo names in any case. */
function fakeGraphql(query, variables) {
   if (variables?.q) {
      searches.push(variables.q);
      // a tracked repo's issue, and one from an org the board doesn't track
      const nodes = /stickers/.test(variables.q)
         ? [
              STATES['test/repo-a#5'],
              { ...STATES['ifixit/ifixit#106'], repository: repo('other/thing') },
           ]
         : [];
      return Promise.resolve({ search: { nodes } });
   }
   const table = query.includes('closedByPullRequestsReferences') ? LINKS : STATES;
   const data = {};
   for (const block of query.split(/(?=r\d+: repository\()/).slice(1)) {
      const [, alias, owner, name] =
         /^(r\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/.exec(block);
      data[alias] = {};
      for (const [, n] of block.matchAll(/i(\d+): issueOrPullRequest/g)) {
         data[alias][`i${n}`] = table[`${owner}/${name}#${n}`.toLowerCase()] ?? null;
      }
   }
   return Promise.resolve(data);
}

// The tables lib/work.js reads and writes, in memory.
let tables;
const PLAN = {
   id: 1,
   name: 'Ship Workbench',
   project: 'workbench',
   team: null,
   lead_login: null,
   status: 'active',
   origin: null,
   start: '2026-05-18',
   weeks: 15,
   priority: 1,
   notes: null,
   waits_on: null,
   updated_by: null,
   updated_at: null,
   created_at: at('2026-05-18'),
};
const issueRow = (number, over) => ({
   repo: 'iFixit/ifixit',
   number,
   status: 'open',
   state_reason: null,
   date_closed: null,
   author: 'gus',
   date_created: at('2026-07-01'),
   label: 'project:workbench',
   ...over,
});
const LABELED = [
   // the project's own issue: it names the project, so it isn't one of its issues
   issueRow(1, { repo: 'test/projects', title: 'Workbench', labeled_at: at('2026-05-01') }),
   issueRow(101, { title: 'Share a bench', labeled_at: at('2026-08-01') }),
   issueRow(102, {
      title: 'Save drafts',
      status: 'closed',
      state_reason: 'completed',
      date_closed: at('2026-08-20'),
      labeled_at: at('2026-08-02'),
   }),
];
// an issue the board knows that a PR links but no one attached
const KNOWN_ISSUES = [issueRow(110, { title: 'Make the bench printable', label: undefined })];
const pullRow = (number, owner, date, over = {}) => ({
   repo: 'iFixit/ifixit',
   number,
   title: `PR ${number}`,
   owner,
   date: at(date),
   date_merged: null,
   date_closed: null,
   state: 'open',
   body: '',
   ...over,
});
const merged = (day, over = {}) => ({
   state: 'closed',
   date_merged: at(day),
   date_closed: at(day),
   ...over,
});
// PRs with the project's label
const LABELED_PULLS = [
   pullRow(201, 'dana', '2026-08-01', merged('2026-08-19')),
   // after the plan's end (Aug 30)
   pullRow(202, 'erin', '2026-09-10', { body: 'Parts of #101' }),
   // links an issue no one attached: a suggestion
   pullRow(204, 'faye', '2026-09-25', { body: 'Parts of #110' }),
   // links nothing
   pullRow(208, 'gus', '2026-09-26'),
   pullRow(209, 'renovate[bot]', '2026-09-27'),
];
// PRs with no project label
const OTHER_PULLS = [
   pullRow(203, 'hal', '2026-08-05', merged('2026-08-06')),
   pullRow(207, 'ivy', '2026-09-28'),
];

function fakeQuery(sql, params) {
   if (sql.includes('FROM `roadmap_items`')) return [PLAN];
   if (sql.includes('FROM `roadmap_updates`')) return [];
   if (sql.startsWith('SELECT i.repo, i.number, i.title')) return LABELED;
   if (sql.startsWith('SELECT i.* FROM issues')) {
      return [{ ...LABELED[0], assignee: null, milestone_title: null, milestone_due_on: null }];
   }
   if (sql.startsWith('SELECT l.repo, l.number, l.title FROM pull_labels')) {
      return [{ repo: 'test/projects', number: 1, title: 'project:workbench' }];
   }
   if (sql.includes('FROM `issues` WHERE (`repo`, `number`) IN')) {
      const wanted = new Set(params[0].map(([r, n]) => `${r}#${n}`.toLowerCase()));
      return KNOWN_ISSUES.filter(i => wanted.has(`${i.repo}#${i.number}`.toLowerCase()));
   }
   // the project's PRs, with their bodies when asked
   if (sql.startsWith('SELECT p.repo, p.number')) {
      const bodies = sql.includes('p.body');
      return LABELED_PULLS.map(p => ({
         ...p,
         body: bodies ? p.body : undefined,
         label: 'project:workbench',
      }));
   }
   // every PR that links an attached issue, and whether a project's label claims it
   if (sql.startsWith('SELECT DISTINCT p.repo')) {
      const linked = new Set(tables.links.map(l => `${l[2]}#${l[3]}`.toLowerCase()));
      return [
         ...LABELED_PULLS.map(p => ({ ...p, labeled: 1 })),
         ...OTHER_PULLS.map(p => ({ ...p, labeled: 0 })),
      ]
         .filter(p => linked.has(`${p.repo}#${p.number}`.toLowerCase()))
         .map(p => ({ ...p, body: undefined }));
   }
   if (sql.startsWith('DELETE FROM `issue_pull_links`')) {
      const gone = new Set(params[0].map(([r, n]) => `${r}#${n}`.toLowerCase()));
      tables.links = tables.links.filter(l => !gone.has(`${l[0]}#${l[1]}`.toLowerCase()));
      return {};
   }
   if (sql.startsWith('INSERT IGNORE INTO `issue_pull_links`')) {
      // the key ignores case, like the table's
      const key = row => row.slice(0, 4).join('#').toLowerCase();
      for (const row of params[0]) {
         if (!tables.links.some(l => key(l) === key(row))) tables.links.push(row);
      }
      return {};
   }
   if (sql.includes('FROM `issue_pull_links`')) {
      return tables.links.map(([issue_repo, issue_number, pull_repo, pull_number]) => ({
         issue_repo,
         issue_number,
         pull_repo,
         pull_number,
      }));
   }
   const sameIssue = (h, r, n) =>
      h.repo.toLowerCase() === String(r).toLowerCase() && Number(h.number) === Number(n);
   if (sql.startsWith('SELECT DISTINCT `repo`, `number` FROM `project_issues`')) {
      tables.handReads++;
      return tables.hand.map(({ repo: r, number }) => ({ repo: r, number }));
   }
   if (sql.startsWith('INSERT IGNORE INTO `project_issues`')) {
      const row = params[0];
      if (!tables.hand.some(h => h.project === row.project && sameIssue(h, row.repo, row.number))) {
         tables.hand.push({ ...row });
      }
      return {};
   }
   if (sql.startsWith('SELECT') && sql.includes('FROM `project_issues` WHERE `project` = ?')) {
      return tables.hand.filter(h => h.project === params[0] && sameIssue(h, params[1], params[2]));
   }
   if (sql.startsWith('DELETE FROM `project_issues`')) {
      const before = tables.hand.length;
      tables.hand = tables.hand.filter(
         h => !(h.project === params[0] && sameIssue(h, params[1], params[2]))
      );
      return { affectedRows: before - tables.hand.length };
   }
   if (sql.startsWith('UPDATE `project_issues` SET ?')) {
      for (const h of tables.hand)
         if (sameIssue(h, params[1], params[2])) Object.assign(h, params[0]);
      return {};
   }
   if (sql.includes('FROM `project_issues`')) return tables.hand;
   throw new Error(`unexpected query: ${sql}`);
}

const settings = { repo: 'test/projects', prefix: 'project:' };

function fresh() {
   tables = { links: [], hand: [], handReads: 0 };
   mock.method(git, 'graphql', fakeGraphql);
   mock.method(db, 'query', async (sql, params) => fakeQuery(sql, params));
}

afterEach(() => mock.restoreAll());

test('a sync stores which PRs link each attached issue, from the issue’s side', async () => {
   fresh();
   await syncWork(settings);
   // a closing reference counts, and a mention only with a linking phrase
   assert.deepEqual(tables.links.map(l => l.join(' ')).sort(), [
      'iFixit/ifixit 101 iFixit/ifixit 201 1',
      'iFixit/ifixit 101 iFixit/ifixit 202 0',
      'iFixit/ifixit 102 iFixit/ifixit 203 0',
   ]);
});

test('a project’s page lists each issue with its PRs, the PRs that link none, and suggestions', async () => {
   fresh();
   await syncWork(settings);
   const { issue } = await attachIssue(
      settings,
      'workbench',
      { repo: 'ifixit/ifixit', number: 106 },
      'dana',
      at('2026-09-20')
   );
   // GitHub's spelling, not the one typed
   assert.equal(issue.repo, 'iFixit/ifixit');
   const work = await loadProjectWork(settings, 'workbench');
   assert.deepEqual(
      work.issues.map(i => [i.ref.number, i.via, i.prs.map(p => [p.number, p.state])]),
      [
         [
            101,
            ['label'],
            [
               [202, 'open'],
               [201, 'merged'],
            ],
         ],
         // linked by a PR with no project label
         [102, ['label'], [[203, 'merged']]],
         // added by hand: its PRs show at once
         [106, ['hand'], [[207, 'open']]],
      ]
   );
   assert.equal(work.issues[2].addedBy, 'dana');
   // the project's own issue isn't one of its issues
   assert.ok(!work.issues.some(i => i.ref.repo === 'test/projects'));
   // a bot's PR never lists
   assert.deepEqual(
      work.unlinked.map(p => p.number),
      [208, 204]
   );
   assert.deepEqual(
      work.suggested.map(i => [i.number, i.title]),
      [[110, 'Make the bench printable']]
   );
   assert.deepEqual([work.counts.total, work.counts.open, work.counts.done], [3, 2, 1]);
});

test('every plan’s PRs by the dates, with the PRs that link its project’s issues', async () => {
   fresh();
   await syncWork(settings);
   await attachIssue(settings, 'workbench', { repo: 'iFixit/ifixit', number: 106 }, 'dana');
   const work = await loadWork(settings);
   const [plan] = work.plans;
   // #207 has no project label but links #106
   assert.deepEqual(
      plan.afterEnd.map(p => p.number),
      [202, 204, 208, 207]
   );
   assert.equal(plan.openPulls, 4);
   assert.deepEqual(work.projects.workbench, {
      total: 3,
      open: 2,
      done: 1,
      dropped: 0,
      lastClosedAt: at('2026-08-20'),
   });
});

test('adding by hand keeps who added it first, refuses a project’s own issue, and comes off', async () => {
   fresh();
   const add = (number, login = 'dana', r = 'iFixit/ifixit') =>
      attachIssue(settings, 'workbench', { repo: r, number }, login);
   assert.equal((await add(106)).issue.added_by, 'dana');
   await add(106, 'erin');
   assert.deepEqual(
      tables.hand.map(h => h.added_by),
      ['dana']
   );
   // a PR, or an issue GitHub doesn't have, can't be added
   assert.deepEqual(await add(201), { missing: true });
   assert.deepEqual(await add(999), { missing: true });
   assert.match((await add(1, 'dana', 'test/projects')).refused, /project’s own issue/);
   // the hourly sync keeps its title current
   STATES['ifixit/ifixit#106'].title = 'Print the stickers';
   await syncWork(settings);
   assert.equal(tables.hand[0].title, 'Print the stickers');
   assert.equal(await detachIssue('workbench', { repo: 'iFixit/ifixit', number: 106 }), true);
   assert.equal(await detachIssue('workbench', { repo: 'iFixit/ifixit', number: 106 }), false);
});

test('a sync asked for while one runs runs again after it', async () => {
   fresh();
   const first = syncWork(settings);
   // asked again while the first is reading
   const second = syncWork(settings);
   await Promise.all([first, second]);
   assert.equal(tables.handReads, 2);
});

test('searchIssues finds an issue by link, by number in any tracked repo, or by words', async () => {
   fresh();
   searches = [];
   const [byLink] = await searchIssues(settings, 'https://github.com/iFixit/ifixit/issues/106');
   assert.deepEqual([byLink.repo, byLink.number, byLink.state], ['iFixit/ifixit', 106, 'open']);
   // a PR isn't an issue to pick
   assert.deepEqual(await searchIssues(settings, 'iFixit/ifixit#201'), []);
   // only issues in the tracked repos' organizations, whatever the words ask
   assert.deepEqual(
      (await searchIssues(settings, 'stickers')).map(h => `${h.repo}#${h.number}`),
      ['test/repo-a#5']
   );
   assert.match(searches[0], /^stickers is:issue org:test/);
   // answered again from what it kept
   await searchIssues(settings, 'stickers');
   assert.equal(searches.length, 1);
   // a number too big for GitHub is no search at all
   assert.deepEqual(await searchIssues(settings, '#30000000000'), []);
   assert.deepEqual(await searchIssues(settings, ' '), []);
});
