import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBaseMerge, stampSurvivesBaseMerges } from '../lib/base-merge.js';

const commit = (message, parents, date = '2026-10-02T00:00:00Z') => ({
   parents: parents.map(sha => ({ sha })),
   commit: { message, committer: { date } },
});

test('recognises git and GitHub merges of the base into the branch', () => {
   for (const message of [
      "Merge branch 'master' into foo",
      "Merge branch 'master' of github.com:iFixit/ifixit into foo",
      "Merge remote-tracking branch 'origin/master' into foo",
      "Merge branch 'master' into foo\n\n# Conflicts:\n#\tapp.js",
   ]) {
      assert.ok(isBaseMerge(commit(message, ['a', 'b']), 'master'), message);
   }
   assert.ok(isBaseMerge(commit("Merge branch 'main' into foo", ['a', 'b']), 'main'));
});

test('other merges and plain commits are not base merges', () => {
   assert.ok(!isBaseMerge(commit("Merge branch 'master' into foo", ['a']), 'master'));
   assert.ok(!isBaseMerge(commit("Merge branch 'other' into foo", ['a', 'b']), 'master'));
   assert.ok(!isBaseMerge(commit("Merge branch 'master2' into foo", ['a', 'b']), 'master'));
   assert.ok(!isBaseMerge(commit('Fix the thing', ['a', 'b']), 'master'));
});

test('a stamp survives only when every later commit is a base merge', () => {
   const stamp = new Date('2026-10-01T00:00:00Z');
   const before = commit('Work', ['a'], '2026-09-30T00:00:00Z');
   const merge = commit("Merge branch 'master' into foo", ['a', 'b']);
   assert.ok(stampSurvivesBaseMerges(stamp, [before, merge, merge], 'master'));
   assert.ok(!stampSurvivesBaseMerges(stamp, [before, merge, commit('More', ['c'])], 'master'));
});
