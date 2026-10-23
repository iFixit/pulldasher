import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import db from '../lib/db.js';
import { describe, projectActivity, projectPullsFrom } from '../lib/auto-calls.js';
import { autoWrite } from '../lib/roadmap.js';

const row = (number, over = {}) => ({
   repo: 'test/repo-a',
   number,
   pr_title: `PR ${number}`,
   owner: 'alice',
   date: 1000,
   ready_at: null,
   date_merged: null,
   date_pushed: null,
   state: 'open',
   draft: 0,
   ...over,
});

test('each PR lands in its project by the one rule, with who labeled it', () => {
   const labeled = [
      { ...row(1), title: 'project:alpha', label_user: 'dana', label_date: 1100 },
      // a real project before misc
      { ...row(2), title: 'project:misc', label_user: 'dana', label_date: 1100 },
      { ...row(2), title: 'project:beta', label_user: 'erin', label_date: 1200 },
      // left out: a bot's PR, a draft, a one-off
      { ...row(3, { owner: 'fixture-bot' }), title: 'project:alpha' },
      { ...row(4, { draft: 1 }), title: 'project:alpha' },
      { ...row(5), title: 'project:misc' },
   ];
   // no label: it joins alpha by the issue it links, labeled by nobody
   const linked = [row(6, { ready_at: 1500 })];
   const out = projectPullsFrom(labeled, linked, 'project:', { 'test/repo-a#6': ['alpha'] });
   assert.deepEqual(
      [...out].map(([slug, prs]) => [slug, prs.map(p => [p.number, p.labeledBy])]),
      [
         [
            'alpha',
            [
               [6, null],
               [1, 'dana'],
            ],
         ],
         ['beta', [[2, 'erin']]],
      ]
   );
   // a former draft counts from when it was marked ready
   assert.equal(out.get('alpha')[0].opened, 1500);
   assert.equal(out.get('alpha')[1].title, 'PR 1');
});

test('the examples put a person’s labels first, then the job’s, newest first, five at most', () => {
   const day = 86400;
   const pull = (number, at, labeledBy, over = {}) => ({
      repo: 'test/repo-a',
      number,
      title: `PR ${number}`,
      opened: at,
      merged: null,
      labeledAt: at,
      labeledBy,
      ...over,
   });
   const runs = [{ actor: 'jarstelfox', from: '2026-10-10T07:55:00Z', to: '2026-10-10T08:05:00Z' }];
   const inRun = Date.parse('2026-10-10T08:00:00Z') / 1000;
   const { last_activity, examples } = projectActivity(
      [
         pull(1, 10 * day, 'dana'),
         pull(2, 20 * day, 'job[bot]'),
         pull(3, inRun, 'jarstelfox'),
         pull(4, 5 * day, 'erin', { merged: 30 * day }),
         pull(5, 40 * day, null, { labeledAt: null }),
         pull(6, 1 * day, 'fixture-bot'),
         pull(7, 2 * day, 'job[bot]'),
      ],
      runs
   );
   assert.equal(last_activity, '2026-10-10');
   assert.deepEqual(
      examples.map(e => [e.number, e.by]),
      [
         [4, 'person'],
         [1, 'person'],
         [3, 'job'],
         [2, 'job'],
         [7, 'job'],
      ]
   );
   assert.equal(examples[0].merged_at, new Date(30 * day * 1000).toISOString());
   assert.deepEqual(projectActivity([], runs), { last_activity: null, examples: [] });
});

test("an automatic status change only lands while the plan's status is still what was read", async () => {
   const seen = [];
   mock.method(db, 'query', async (sql, params) => {
      seen.push({ sql, params });
      return { affectedRows: 0 };
   });
   const call = { kind: 'status', id: 4, from: 'done', status: 'active', note: 'Picked up again' };
   assert.equal(await autoWrite(call, 'pulldasher', 500), false);
   assert.match(seen[0].sql, /`status` = \? AND `removed_at` IS NULL/);
   assert.deepEqual(seen[0].params, [
      {
         status: 'active',
         status_at: 500,
         updated_by: 'pulldasher',
         updated_at: 500,
         auto_note: 'Picked up again',
         auto_at: 500,
      },
      4,
      'done',
   ]);
   // a lead only fills an empty one, and isn't a call: updated_at stays
   await autoWrite({ kind: 'lead', id: 4, lead: 'kim', note: 'Lead: kim' }, 'pulldasher', 500);
   assert.match(seen[1].sql, /`lead_login` IS NULL/);
   assert.deepEqual(seen[1].params[0], { lead_login: 'kim', auto_note: 'Lead: kim', auto_at: 500 });
   mock.restoreAll();
});

test('a call reads in one line', () => {
   assert.equal(
      describe({ kind: 'status', id: 4, from: 'active', status: 'parked', note: 'Put down: x' }),
      '#4 active -> parked: Put down: x'
   );
});
