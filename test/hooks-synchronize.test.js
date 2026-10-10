import { test } from 'node:test';
import assert from 'node:assert/strict';
import HooksController from '../controllers/githubHooks.js';
import dbManager from '../lib/db-manager.js';
import git from '../lib/git-manager.js';
import refresh from '../lib/refresh.js';

const merge = {
   parents: [{ sha: 'a' }, { sha: 'b' }],
   commit: { message: "Merge branch 'master' into f" },
};

async function push(t, getCommit, before = 'a') {
   const invalidated = [];
   t.mock.method(git, 'getCommit', getCommit);
   t.mock.method(dbManager, 'invalidateSignatures', async (...args) => invalidated.push(args));
   t.mock.method(dbManager, 'updatePull', async () => {});
   t.mock.method(refresh, 'pull', async () => {});
   const body = {
      action: 'synchronize',
      before,
      after: 'newhead',
      repository: { full_name: 'o/r' },
      pull_request: {
         number: 3,
         base: { ref: 'master', repo: { full_name: 'o/r' } },
         head: { ref: 'f', sha: 'newhead', repo: { owner: { login: 'o' } } },
         user: { login: 'u' },
         labels: [],
      },
   };
   const req = {
      query: { secret: 'test-hook-secret' },
      headers: { 'content-type': 'application/json' },
      body,
      get: () => 'pull_request',
   };
   await new Promise(resolve => {
      const res = { status: () => res, send: resolve, sendStatus: resolve, end: resolve };
      HooksController.main(req, res);
   });
   return invalidated;
}

test('a push whose head merges the base keeps the stamps for now', async t => {
   assert.equal((await push(t, async () => merge)).length, 0);
});

test('a plain push invalidates the stamps', async t => {
   const plain = { parents: [{ sha: 'a' }], commit: { message: 'Fix' } };
   assert.deepEqual(await push(t, async () => plain), [['o/r', 3, ['QA', 'CR']]]);
});

test('a failed commit lookup invalidates the stamps', async t => {
   const invalidated = await push(t, async () => {
      throw new Error('503');
   });
   assert.equal(invalidated.length, 1);
});

test('a base merge on top of new code invalidates: only a lone merge keeps stamps', async t => {
   // the merge's first parent is the code commit, not the head before the push
   const invalidated = await push(t, async () => merge, 'older-head');
   assert.equal(invalidated.length, 1);
});

test('a slow commit lookup is cut off and invalidates', async t => {
   t.mock.timers.enable({ apis: ['setTimeout'] });
   const pending = push(t, () => new Promise(() => {}));
   // let the handler reach its timer, then run it out
   await new Promise(resolve => setImmediate(resolve));
   t.mock.timers.tick(3000);
   assert.equal((await pending).length, 1);
});
