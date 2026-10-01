import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import db from '../lib/db.js';
import git from '../lib/git-manager.js';
import { fetchSpec, loadScope, syncScope } from '../lib/scope.js';

const at = day => Date.parse(`${day}T12:00:00Z`) / 1000;
const iso = day => `${day}T12:00:00Z`;
const repo = nameWithOwner => ({ nameWithOwner });

// What GitHub holds: a spec epic with two sub-issues and a checklist, and
// the issues and PRs it names.
const SPEC = {
   __typename: 'Issue',
   title: 'Workbench launch',
   body: [
      '- [x] #101 already a sub-issue',
      '- [ ] iFixit/ops#7 nightly export',
      '- [x] Decide the default units',
   ].join('\n'),
   subIssues: {
      nodes: [
         {
            number: 101,
            title: 'Save drafts',
            state: 'CLOSED',
            stateReason: 'COMPLETED',
            closedAt: iso('2026-08-20'),
            repository: repo('iFixit/ifixit'),
         },
         {
            number: 102,
            title: 'Share a bench',
            state: 'OPEN',
            stateReason: null,
            closedAt: null,
            repository: repo('iFixit/ifixit'),
         },
      ],
   },
   timelineItems: {
      nodes: [
         {
            createdAt: iso('2026-08-05'),
            subIssue: { number: 101, repository: repo('iFixit/ifixit') },
         },
         {
            createdAt: iso('2026-08-06'),
            subIssue: { number: 102, repository: repo('iFixit/ifixit') },
         },
         // taken off and added again: the later time counts
         {
            createdAt: iso('2026-08-10'),
            subIssue: { number: 102, repository: repo('iFixit/ifixit') },
         },
      ],
   },
};
const STATES = {
   'iFixit/ops#7': {
      __typename: 'Issue',
      title: 'Nightly export',
      state: 'CLOSED',
      stateReason: 'NOT_PLANNED',
      closedAt: iso('2026-09-01'),
   },
};
const pr = (number, closes) => ({ number, repository: repo('iFixit/ifixit'), closes });
const LINKS = {
   'iFixit/ifixit#101': {
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
   'iFixit/ifixit#102': {
      __typename: 'Issue',
      closedByPullRequestsReferences: { nodes: [] },
      // "Parts of #102"
      timelineItems: { nodes: [{ source: { __typename: 'PullRequest', ...pr(202) } }] },
   },
};

/** Answer a query the way GitHub would, from the tables above. */
function fakeGraphql(query, variables) {
   if (variables) {
      const { owner, name, number } = variables;
      const key = `${owner}/${name}#${number}`;
      const node =
         key === 'iFixit/ifixit#100'
            ? SPEC
            : key === 'iFixit/ifixit#201'
            ? { __typename: 'PullRequest', title: 'A PR' }
            : null;
      return Promise.resolve({ repository: { issueOrPullRequest: node } });
   }
   const table = query.includes('closedByPullRequestsReferences') ? LINKS : STATES;
   const data = {};
   for (const block of query.split(/(?=r\d+: repository\()/).slice(1)) {
      const [, alias, owner, name] =
         /^(r\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/.exec(block);
      data[alias] = {};
      for (const [, n] of block.matchAll(/i(\d+): issueOrPullRequest/g)) {
         data[alias][`i${n}`] = table[`${owner}/${name}#${n}`] ?? null;
      }
   }
   return Promise.resolve(data);
}

// The tables lib/scope.js reads and writes, in memory.
let tables;
const PLAN = {
   id: 1,
   name: 'Ship Workbench',
   project: 'workbench',
   team: null,
   lead_login: null,
   status: 'active',
   origin: null,
   spec_repo: 'iFixit/ifixit',
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
const LABELED = [
   // the project's own issue
   {
      repo: 'test/projects',
      number: 1,
      title: 'Workbench',
      status: 'open',
      state_reason: null,
      date_closed: null,
      label: 'project:workbench',
      labeled_at: at('2026-05-01'),
   },
   // an issue someone labeled into the project
   {
      repo: 'iFixit/ifixit',
      number: 103,
      title: 'Print a bench',
      status: 'open',
      state_reason: null,
      date_closed: null,
      label: 'project:workbench',
      labeled_at: at('2026-08-12'),
   },
];
const pullRow = (number, owner, date, merged = null) => ({
   repo: 'iFixit/ifixit',
   number,
   title: `PR ${number}`,
   owner,
   date: at(date),
   date_merged: merged && at(merged),
   state: merged ? 'closed' : 'open',
   label: 'project:workbench',
});

function fakeQuery(sql, params) {
   if (sql.includes('FROM `roadmap_items`')) return [PLAN];
   if (sql.includes('FROM `roadmap_updates`')) return [];
   if (sql.startsWith('SELECT i.repo, i.number, i.title')) return LABELED;
   if (sql.startsWith('SELECT i.* FROM issues'))
      return [{ ...LABELED[0], assignee: null, milestone_title: null, milestone_due_on: null }];
   if (sql.startsWith('SELECT l.repo, l.number, l.title FROM pull_labels')) {
      return [{ repo: 'test/projects', number: 1, title: 'project:workbench' }];
   }
   if (sql.startsWith('SELECT p.repo, p.number')) {
      return [
         pullRow(201, 'dana', '2026-08-01', '2026-08-19'),
         // opened after the plan's end (Aug 30)
         pullRow(202, 'erin', '2026-09-10'),
         pullRow(203, 'renovate[bot]', '2026-09-12'),
      ];
   }
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
      const gone = new Set(params[0].map(([r, n]) => `${r}#${n}`));
      tables.links = tables.links.filter(l => !gone.has(`${l[0]}#${l[1]}`));
      return {};
   }
   if (sql.startsWith('INSERT INTO `issue_pull_links`')) {
      tables.links.push(...params[0]);
      return {};
   }
   // specs no plan names: there are none here
   if (sql.startsWith('DELETE FROM')) return {};
   if (sql.includes('FROM `scope_specs`')) return tables.specs;
   if (sql.includes('FROM `scope_items`')) {
      return tables.items.map(
         ([
            spec_repo,
            spec_number,
            position,
            source,
            r,
            number,
            title,
            state,
            closed_at,
            joined_at,
         ]) => ({
            spec_repo,
            spec_number,
            position,
            source,
            repo: r,
            number,
            title,
            state,
            closed_at,
            joined_at,
         })
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

afterEach(() => mock.restoreAll());

test('fetchSpec reads sub-issues, then checklist lines, each issue once', async () => {
   mock.method(git, 'graphql', fakeGraphql);
   const spec = await fetchSpec({ repo: 'iFixit/ifixit', number: 100 });
   assert.equal(spec.title, 'Workbench launch');
   assert.equal(spec.found, true);
   assert.deepEqual(
      spec.items.map(i => [i.source, i.ref && `${i.ref.repo}#${i.ref.number}`, i.title, i.state]),
      [
         ['sub', 'iFixit/ifixit#101', 'Save drafts', 'done'],
         ['sub', 'iFixit/ifixit#102', 'Share a bench', 'open'],
         // a box goes stale: the line takes its issue's state and title
         ['check', 'iFixit/ops#7', 'Nightly export', 'dropped'],
         ['check', null, 'Decide the default units', 'done'],
      ]
   );
   assert.equal(spec.items[1].joinedAt, at('2026-08-10'));
   // a PR isn't a spec
   assert.equal((await fetchSpec({ repo: 'iFixit/ifixit', number: 201 })).found, false);
});

test('a sync stores each spec and its links, and loadScope builds the plan’s scope from them', async () => {
   tables = { items: [], specs: [], links: [] };
   mock.method(git, 'graphql', fakeGraphql);
   mock.method(db, 'query', async (sql, params) => fakeQuery(sql, params));
   await syncScope(settings);
   // a closing reference beats a mention of the same PR
   assert.deepEqual(tables.links, [
      ['iFixit/ifixit', 101, 'iFixit/ifixit', 201, 1],
      ['iFixit/ifixit', 102, 'iFixit/ifixit', 202, 0],
   ]);
   const [scope] = await loadScope(settings);
   assert.equal(scope.specTitle, 'Workbench launch');
   // the labeled issue joins; the project's own issue doesn't
   assert.deepEqual(
      scope.items.map(i => i.ref?.number ?? i.title),
      [101, 102, 7, 'Decide the default units', 103]
   );
   assert.deepEqual([scope.done, scope.open, scope.dropped], [2, 2, 1]);
   assert.deepEqual(scope.items[0].prs, [
      { repo: 'iFixit/ifixit', number: 201, title: 'PR 201', state: 'merged' },
   ]);
   assert.deepEqual(scope.items[1].prs, [
      { repo: 'iFixit/ifixit', number: 202, title: 'PR 202', state: 'open' },
   ]);
   // a bot's PR never counts
   assert.deepEqual(
      scope.afterEnd.map(p => p.number),
      [202]
   );
});
