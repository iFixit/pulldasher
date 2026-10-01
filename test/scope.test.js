import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import db from '../lib/db.js';
import git from '../lib/git-manager.js';
import { fetchSpec, loadScope, syncScope } from '../lib/scope.js';

const at = day => Date.parse(`${day}T12:00:00Z`) / 1000;
const iso = day => `${day}T12:00:00Z`;
const repo = nameWithOwner => ({ nameWithOwner });
const ifixit = repo('iFixit/ifixit');

// What GitHub holds: a spec epic with two sub-issues and a checklist, an
// old epic closed with its boxes unticked, and the issues and PRs they name.
const SPEC = {
   __typename: 'Issue',
   title: 'Workbench launch',
   state: 'OPEN',
   stateReason: null,
   closedAt: null,
   createdAt: iso('2026-08-01'),
   lastEditedAt: iso('2026-08-15'),
   repository: ifixit,
   body: [
      '- [x] #101 already a sub-issue',
      '- [ ] iFixit/ops#7 nightly export',
      '- [x] Decide the default units',
      '- [ ] ifixit/IFIXIT#102 the same issue, typed another way',
      '- [ ] #104 a piece of the drafts work',
      '- [ ] Keep the language row from #105',
   ].join('\n'),
   subIssues: {
      nodes: [
         {
            number: 101,
            title: 'Save drafts',
            state: 'CLOSED',
            stateReason: 'COMPLETED',
            closedAt: iso('2026-08-20'),
            repository: ifixit,
         },
         {
            number: 102,
            title: 'Share a bench',
            state: 'OPEN',
            stateReason: null,
            closedAt: null,
            repository: ifixit,
         },
      ],
   },
   timelineItems: {
      nodes: [
         { createdAt: iso('2026-08-05'), subIssue: { number: 101, repository: ifixit } },
         { createdAt: iso('2026-08-06'), subIssue: { number: 102, repository: ifixit } },
         // taken off and added again: the later time counts
         { createdAt: iso('2026-08-10'), subIssue: { number: 102, repository: ifixit } },
      ],
   },
};
const CLOSED_SPEC = {
   __typename: 'Issue',
   title: 'Old epic',
   state: 'CLOSED',
   stateReason: 'COMPLETED',
   closedAt: iso('2026-09-22'),
   createdAt: iso('2026-06-01'),
   lastEditedAt: iso('2026-06-10'),
   repository: ifixit,
   body: '- [ ] dev\n- [x] test',
   subIssues: { nodes: [] },
   timelineItems: { nodes: [] },
};
const STATES = {
   'ifixit/ops#7': {
      __typename: 'Issue',
      number: 7,
      title: 'Nightly export',
      state: 'CLOSED',
      stateReason: 'NOT_PLANNED',
      closedAt: iso('2026-09-01'),
      repository: repo('iFixit/ops'),
      parent: null,
   },
   // a sub-issue of #101, which the spec already holds
   'ifixit/ifixit#104': {
      __typename: 'Issue',
      number: 104,
      title: 'Autosave every minute',
      state: 'OPEN',
      stateReason: null,
      closedAt: null,
      repository: ifixit,
      parent: { number: 101, repository: ifixit },
   },
};
const pr = (number, body = '') => ({ number, body, repository: ifixit });
const LINKS = {
   'ifixit/ifixit#101': {
      __typename: 'Issue',
      closedByPullRequestsReferences: { nodes: [pr(201)] },
      timelineItems: {
         nodes: [
            { source: { __typename: 'PullRequest', ...pr(201) } },
            // an issue mentioning it isn't a PR
            { source: { __typename: 'Issue' } },
         ],
      },
   },
   'ifixit/ifixit#102': {
      __typename: 'Issue',
      closedByPullRequestsReferences: { nodes: [] },
      timelineItems: {
         nodes: [
            { source: { __typename: 'PullRequest', ...pr(202, 'Parts of #102') } },
            // a mention in passing isn't a link
            { source: { __typename: 'PullRequest', ...pr(205, 'Unlike #102, this keeps it') } },
         ],
      },
   },
   // "Parts of #100": the spec epic itself
   'ifixit/ifixit#100': {
      __typename: 'Issue',
      closedByPullRequestsReferences: { nodes: [] },
      timelineItems: {
         nodes: [{ source: { __typename: 'PullRequest', ...pr(204, 'Parts of #100') } }],
      },
   },
};

/** Answer a query the way GitHub would, from the tables above: repo names
 * in any case, and a missing issue as an error beside the data. */
let failStates = false;
function fakeGraphql(query, variables) {
   if (failStates && !variables && !query.includes('closedByPullRequestsReferences')) {
      return Promise.reject(new Error('Bad gateway'));
   }
   if (variables) {
      const key = `${variables.owner}/${variables.name}#${variables.number}`.toLowerCase();
      const node = {
         'ifixit/ifixit#100': SPEC,
         'ifixit/ifixit#300': CLOSED_SPEC,
         'ifixit/ifixit#201': { __typename: 'PullRequest', title: 'A PR' },
      }[key];
      const data = { repository: { issueOrPullRequest: node ?? null } };
      if (node) return Promise.resolve(data);
      return Promise.reject(Object.assign(new Error('Could not resolve to an issue'), { data }));
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

// The tables lib/scope.js reads and writes, in memory.
let tables;
let planReads;
const PLAN = {
   id: 1,
   name: 'Ship Workbench',
   project: 'workbench',
   team: null,
   lead_login: null,
   status: 'active',
   origin: null,
   // typed in lowercase on the roadmap
   spec_repo: 'ifixit/ifixit',
   spec_number: 100,
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
   label: 'project:workbench',
   ...over,
});
const LABELED = [
   // the project's own issue
   issueRow(1, { repo: 'test/projects', title: 'Workbench', labeled_at: at('2026-05-01') }),
   // an issue someone labeled into the project
   issueRow(103, { title: 'Print a bench', labeled_at: at('2026-08-12') }),
];
const pullRow = (number, owner, date, merged = null) => ({
   repo: 'iFixit/ifixit',
   number,
   title: `PR ${number}`,
   owner,
   date: at(date),
   date_merged: merged && at(merged),
   state: merged ? 'closed' : 'open',
});
const labeledPull = (...args) => ({ ...pullRow(...args), label: 'project:workbench' });

function fakeQuery(sql, params) {
   if (sql.includes('FROM `roadmap_items`')) {
      planReads++;
      return [PLAN];
   }
   if (sql.includes('FROM `roadmap_updates`')) return [];
   if (sql.startsWith('SELECT i.repo, i.number, i.title')) return LABELED;
   if (sql.startsWith('SELECT i.* FROM issues')) {
      return [{ ...LABELED[0], assignee: null, milestone_title: null, milestone_due_on: null }];
   }
   if (sql.startsWith('SELECT l.repo, l.number, l.title FROM pull_labels')) {
      return [{ repo: 'test/projects', number: 1, title: 'project:workbench' }];
   }
   if (sql.startsWith('SELECT p.repo, p.number')) {
      return [
         labeledPull(201, 'dana', '2026-08-01', '2026-08-19'),
         // opened after the plan's end (Aug 30)
         labeledPull(202, 'erin', '2026-09-10'),
         labeledPull(203, 'renovate[bot]', '2026-09-12'),
      ];
   }
   // the linked PRs no project label claims
   if (sql.startsWith('SELECT DISTINCT p.repo')) return [pullRow(204, 'faye', '2026-09-12')];
   if (sql.startsWith('DELETE FROM `scope_items` WHERE `spec_repo`')) {
      tables.items = tables.items.filter(r => !(r[0] === params[0] && r[1] === params[1]));
      return {};
   }
   if (sql.startsWith('INSERT INTO `scope_items`')) {
      tables.items.push(...params[0]);
      return {};
   }
   if (sql.startsWith('REPLACE INTO `scope_specs`')) {
      tables.specs = [...tables.specs.filter(s => s.number !== params[0].number), params[0]];
      return {};
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
   // specs no plan names: there are none here
   if (sql.startsWith('DELETE FROM')) return {};
   if (sql.includes('FROM `scope_specs`')) return tables.specs;
   if (sql.includes('FROM `scope_items`')) {
      const names = ['spec_repo', 'spec_number', 'position', 'source', 'repo', 'number'];
      return tables.items.map(row =>
         Object.fromEntries(
            [...names, 'title', 'state', 'closed_at', 'joined_at'].map((name, i) => [name, row[i]])
         )
      );
   }
   if (sql.includes('FROM `issue_pull_links`')) {
      return tables.links.map(([issue_repo, issue_number, pull_repo, pull_number]) => ({
         issue_repo,
         issue_number,
         pull_repo,
         pull_number,
      }));
   }
   throw new Error(`unexpected query: ${sql}`);
}

const settings = { repo: 'test/projects', prefix: 'project:' };
const shape = items =>
   items.map(i => [i.source, i.ref && `${i.ref.repo}#${i.ref.number}`, i.title, i.state]);

afterEach(() => mock.restoreAll());

test('fetchSpec reads sub-issues, then the lines that start with an issue, each issue once', async () => {
   mock.method(git, 'graphql', fakeGraphql);
   // typed in lowercase: "#N" still means the epic's repo as GitHub spells it
   const spec = await fetchSpec({ repo: 'ifixit/ifixit', number: 100 });
   assert.equal(spec.title, 'Workbench launch');
   assert.equal(spec.found, true);
   assert.deepEqual(shape(spec.items), [
      ['sub', 'iFixit/ifixit#101', 'Save drafts', 'done'],
      ['sub', 'iFixit/ifixit#102', 'Share a bench', 'open'],
      // a box goes stale: the line takes its issue's state and title
      ['check', 'iFixit/ops#7', 'Nightly export', 'dropped'],
      ['check', null, 'Decide the default units', 'done'],
      // #102 typed another way counts once, and #104 is part of #101
      ['check', null, 'Keep the language row from #105', 'open'],
   ]);
   assert.equal(spec.items[1].joinedAt, at('2026-08-10'));
   // a ticked plain line closed when the epic was last edited
   assert.equal(spec.items[3].closedAt, at('2026-08-15'));
});

test('fetchSpec says when a spec can’t be read, and closes a closed epic’s plain lines', async () => {
   mock.method(git, 'graphql', fakeGraphql);
   assert.equal((await fetchSpec({ repo: 'iFixit/ifixit', number: 999 })).found, false);
   // a PR isn't a spec
   assert.equal((await fetchSpec({ repo: 'iFixit/ifixit', number: 201 })).found, false);
   const old = await fetchSpec({ repo: 'iFixit/ifixit', number: 300 });
   assert.deepEqual(
      old.items.map(i => [i.title, i.state, i.closedAt]),
      [
         ['dev', 'done', at('2026-09-22')],
         ['test', 'done', at('2026-06-10')],
      ]
   );
});

test('a failed read of a spec’s checklist issues fails the spec, so its stored rows stay', async () => {
   mock.method(git, 'graphql', fakeGraphql);
   failStates = true;
   await assert.rejects(fetchSpec({ repo: 'iFixit/ifixit', number: 100 }), /Bad gateway/);
   failStates = false;
});

test('a sync stores each spec and its links, and loadScope builds the plan’s scope from them', async () => {
   tables = { items: [], specs: [], links: [] };
   planReads = 0;
   mock.method(git, 'graphql', fakeGraphql);
   mock.method(db, 'query', async (sql, params) => fakeQuery(sql, params));
   await syncScope(settings);
   // a closing reference beats a mention of the same PR
   assert.deepEqual(tables.links.map(l => l.join(' ')).sort(), [
      'iFixit/ifixit 100 iFixit/ifixit 204 0',
      'iFixit/ifixit 101 iFixit/ifixit 201 1',
      'iFixit/ifixit 102 iFixit/ifixit 202 0',
   ]);
   const [scope] = await loadScope(settings);
   assert.equal(scope.specTitle, 'Workbench launch');
   // the labeled issue joins; the project's own issue doesn't
   assert.deepEqual(
      scope.items.map(i => i.ref?.number ?? i.title),
      [101, 102, 7, 'Decide the default units', 'Keep the language row from #105', 103]
   );
   assert.deepEqual([scope.done, scope.open, scope.dropped], [2, 3, 1]);
   assert.deepEqual(scope.items[0].prs, [
      { repo: 'iFixit/ifixit', number: 201, title: 'PR 201', state: 'merged' },
   ]);
   assert.deepEqual(scope.items[1].prs, [
      { repo: 'iFixit/ifixit', number: 202, title: 'PR 202', state: 'open' },
   ]);
   // a bot's PR never counts; #204 has no project label, but it names the epic
   assert.deepEqual(
      scope.afterEnd.map(p => p.number),
      [202, 204]
   );
});

test('a sync asked for while one runs runs again after it', async () => {
   tables = { items: [], specs: [], links: [] };
   planReads = 0;
   mock.method(git, 'graphql', fakeGraphql);
   mock.method(db, 'query', async (sql, params) => fakeQuery(sql, params));
   const first = syncScope(settings);
   // a plan's spec changed while the first sync was reading
   const second = syncScope(settings);
   await Promise.all([first, second]);
   assert.equal(planReads, 2);
});
