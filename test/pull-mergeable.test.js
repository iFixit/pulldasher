import { test } from 'node:test';
import assert from 'node:assert/strict';
import Pull from '../models/pull.js';

// A `pulls` row as mysql2 hands it back: tinyint(1) columns are raw numbers
// (0/1) or null, never JS booleans.
function row(mergeable) {
   return {
      repo: 'test/repo-a',
      number: 1,
      state: 'open',
      title: 't',
      body: '',
      draft: 0,
      date: 1753200000,
      date_updated: 1753300000,
      date_closed: null,
      mergeable,
      date_merged: null,
      difficulty: null,
      additions: 1,
      deletions: 1,
      changed_files: 1,
      milestone_title: null,
      milestone_due_on: null,
      head_branch: 'f',
      head_sha: 'sha',
      base_branch: 'main',
      owner: 'alice',
      assignees: [],
      requested_reviewers: [],
      cr_req: 2,
      qa_req: 1,
   };
}

const mergeableOf = m => Pull.getFromDB(row(m), [], [], [], [], []).data.mergeable;

test('getFromDB normalizes tinyint mergeable to a real boolean|null', () => {
   // 1 -> true, so a mergeable PR is mergeable
   assert.equal(mergeableOf(1), true);
   // 0 -> false (not the raw 0), so derive()'s strict `mergeable === false`
   // registers the conflict instead of silently passing
   assert.equal(mergeableOf(0), false);
   // null stays null: GitHub hasn't recomputed, don't assert either way
   assert.equal(mergeableOf(null), null);
});
