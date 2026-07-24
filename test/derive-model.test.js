import { test } from 'node:test';
import assert from 'node:assert/strict';
import Pull from '../models/pull.js';
import { derivePull } from '../lib/review-model.js';

// End-to-end for the server-side classification path: a mysql2-shaped row (+
// signature/status rows) -> Pull.getFromDB -> toObject -> the SHARED derive.
// This is what proves the compiled bundle, the wire normalization, the config
// spec lookup, and the mergeable fix all hang together the way the /api/v1
// endpoint relies on -- and that the buckets match the board's.

const NOW = 1753305600; // fixed clock

function row(o = {}) {
   return {
      repo: 'test/repo-a',
      number: 1,
      state: 'open',
      title: 't',
      body: '',
      draft: 0,
      date: 1753100000,
      date_updated: 1753300000,
      date_closed: null,
      mergeable: 1,
      date_merged: null,
      difficulty: null,
      additions: 100,
      deletions: 10,
      changed_files: 3,
      milestone_title: null,
      milestone_due_on: null,
      head_branch: 'f',
      head_sha: 'HEAD',
      base_branch: 'main',
      owner: 'alice',
      assignees: [],
      requested_reviewers: [],
      cr_req: 2,
      qa_req: 1,
      ...o,
   };
}
const crSig = (login, active) => ({
   data: {
      repo: 'test/repo-a',
      number: 1,
      user: { id: 1, login },
      type: 'CR',
      created_at: new Date('2026-07-21T00:00:00Z'),
      active,
      comment_id: 1,
   },
});
const status = (context, state) => ({
   data: {
      sha: 'HEAD',
      target_url: null,
      description: '',
      state,
      context,
      started_at: 1753300000,
      completed_at: 1753300060,
   },
});
const pullOf = (rowO = {}, sigs = [], statuses = []) =>
   Pull.getFromDB(row(rowO), sigs, [], [], statuses, []);

test('needs_cr: no sign-offs, no CI', () => {
   const d = derivePull(pullOf(), NOW);
   assert.equal(d.status, 'needs_cr');
   assert.equal(d.ci, 'none');
   assert.equal(d.weight, 'S'); // size 110 -> S, no weightLabels config
   assert.equal(d.crHave, 0);
});

test('ready: sign-offs met + green CI', () => {
   const d = derivePull(
      pullOf({ cr_req: 1, qa_req: 0 }, [crSig('bob', 1)], [status('build', 'success')]),
      NOW
   );
   assert.equal(d.status, 'ready');
   assert.equal(d.ci, 'success');
});

test('ci_red: sign-offs met but a required check failed', () => {
   const d = derivePull(
      pullOf({ cr_req: 1, qa_req: 0 }, [crSig('bob', 1)], [status('build', 'failure')]),
      NOW
   );
   assert.equal(d.status, 'ci_red');
   assert.equal(d.ci, 'failing');
   assert.deepEqual(d.ciFailing, ['build']);
});

test('needs_recr: only a stale CR stamp remains', () => {
   const d = derivePull(pullOf({ cr_req: 1, qa_req: 0 }, [crSig('bob', 0)]), NOW);
   assert.equal(d.status, 'needs_recr');
   assert.deepEqual(d.recrBy, ['bob']);
});

test('unmergeable: signed off + green, but mergeable=0 from the DB', () => {
   // The whole point of the mergeable tinyint fix: a raw 0 from the column
   // must reach derive as `false` so conflict registers and the pull lands in
   // unmergeable instead of ready.
   const d = derivePull(
      pullOf(
         { mergeable: 0, cr_req: 1, qa_req: 0 },
         [crSig('bob', 1)],
         [status('build', 'success')]
      ),
      NOW
   );
   assert.equal(d.data.mergeable, false);
   assert.equal(d.conflict, true);
   assert.equal(d.status, 'unmergeable');
});

test('draft: outranks everything', () => {
   const d = derivePull(pullOf({ draft: 1 }), NOW);
   assert.equal(d.status, 'draft');
});
