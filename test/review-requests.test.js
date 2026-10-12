import { test } from 'node:test';
import assert from 'node:assert/strict';
import Pull from '../models/pull.js';

const payload = (number, reviewers) => ({
   number,
   state: 'open',
   title: 't',
   body: '',
   created_at: '2026-09-19T00:00:00Z',
   updated_at: '2026-09-20T10:01:00Z',
   user: { login: 'author' },
   head: { ref: 'f', sha: 'abc', repo: { name: 'r', owner: { login: 'o' } } },
   base: { ref: 'master', repo: { full_name: 'o/r' } },
   requested_reviewers: reviewers.map(login => ({ login })),
   requested_teams: [],
});
const requests = pull => pull.toObject().review_requests.map(r => [r.login, Boolean(r.answered)]);

test('a webhook-only update keeps a request GitHub cleared after the review', () => {
   // bob was asked, then reviewed: GitHub drops him from requested_reviewers
   // with no pull update, so the cache still has him as unanswered
   Pull.recordReviewRequested('o/r', 30, 'bob', { at: 1000, self: false });
   Pull.fromGithubApi(payload(30, ['bob']));
   assert.deepEqual(requests(Pull.fromGithubApi(payload(30, []))), [['bob', true]]);
});
