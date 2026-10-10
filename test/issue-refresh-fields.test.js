import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import config from '../lib/config-loader.js';
import db from '../lib/db.js';
import git from '../lib/git-manager.js';

config.projects = {};
afterEach(() => mock.restoreAll());

// GitHub answers the events call, and refuses the GraphQL fields read
function githubWithFieldsDown() {
   mock.method(globalThis, 'fetch', async url => {
      const { pathname } = new URL(typeof url === 'string' ? url : url.url);
      const labeled = {
         event: 'labeled',
         label: { name: 'project:workbench' },
         actor: { login: 'dana' },
         created_at: '2026-09-20T10:01:00Z',
      };
      const ok = body =>
         new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
         });
      if (/\/issues\/9\/events$/.test(pathname)) return ok([labeled]);
      return new Response(JSON.stringify({ message: 'Bad Gateway' }), {
         status: 502,
         headers: { 'content-type': 'application/json' },
      });
   });
}

const ghIssue = {
   repo: 'test/repo-a',
   number: 9,
   title: 'Closed now',
   state: 'closed',
   user: { login: 'gus' },
   created_at: '2026-09-01T00:00:00Z',
   closed_at: '2026-09-21T00:00:00Z',
};

test('a failed fields read still refreshes the issue, keeping the stored fields', async () => {
   githubWithFieldsDown();
   mock.method(db, 'query', async () => [
      { field_start: '2026-09-01', field_target: '2026-10-01', field_priority: 'high' },
   ]);
   const issue = await git.parseIssue({ ...ghIssue });
   assert.equal(issue.title, 'Closed now');
   assert.equal(issue.status, 'closed');
   assert.deepEqual(issue.fields, {
      start: '2026-09-01',
      target: '2026-10-01',
      priority: 'high',
   });
});

test('a failed fields read on an issue never saved has no fields', async () => {
   githubWithFieldsDown();
   mock.method(db, 'query', async () => []);
   const issue = await git.parseIssue({ ...ghIssue });
   assert.equal(issue.status, 'closed');
   assert.equal(issue.fields, null);
});
