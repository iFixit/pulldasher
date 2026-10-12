import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
   RETRY_LIMIT,
   _resetIssueSync,
   _syncedAt,
   syncRepoIssues,
} from '../lib/project-issue-sync.js';

const R = 'iFixit/ifixit';
let calls;
let list;
let single;
const refresh = {
   issuesChangedSince: async (repo, since) => {
      calls.push(['list', since]);
      return list();
   },
   issue: async (repo, number) => {
      calls.push(['issue', number]);
      return single(number);
   },
};
beforeEach(() => {
   calls = [];
   _resetIssueSync();
   mock.method(console, 'error', () => {});
});

test('the marker moves past a run with a stuck issue, which is retried on its own', async () => {
   list = () => ({ failedRepos: [], failedItems: [{ repo: R, number: 9 }], refreshed: 0 });
   single = () => Promise.reject(new Error('timeout'));
   assert.equal(await syncRepoIssues(refresh, R, 'lookback', 'T1'), false);
   assert.equal(_syncedAt(R), 'T1');
   // the next run reads only since T1, and asks for #9 by itself
   list = () => ({ failedRepos: [], failedItems: [], refreshed: 0 });
   // a retry that fails again tells no board to fetch
   assert.equal(await syncRepoIssues(refresh, R, 'lookback', 'T2'), false);
   assert.deepEqual(calls.slice(1), [
      ['issue', 9],
      ['list', 'T1'],
   ]);
   // after RETRY_LIMIT runs in a row it is given up on
   calls = [];
   for (let i = 0; i < RETRY_LIMIT; i++) await syncRepoIssues(refresh, R, 'x', 'T3');
   calls = [];
   await syncRepoIssues(refresh, R, 'x', 'T4');
   assert.deepEqual(calls, [['list', 'T3']]);
});

test('a retry that works counts as a change; a repo that could not be listed keeps its marker', async () => {
   list = () => ({ failedRepos: [], failedItems: [{ repo: R, number: 9 }], refreshed: 0 });
   single = () => Promise.reject(new Error('timeout'));
   await syncRepoIssues(refresh, R, 'x', 'T1');
   single = async () => {};
   list = () => ({ failedRepos: [R], failedItems: [], refreshed: 0 });
   assert.equal(await syncRepoIssues(refresh, R, 'x', 'T2'), true);
   assert.equal(_syncedAt(R), 'T1');
});
