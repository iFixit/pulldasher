import { test } from 'node:test';
import assert from 'node:assert/strict';
import Pull from '../models/pull.js';
import DBPull from '../models/db_pull.js';

const payload = (number, teams) => ({
   number,
   state: 'open',
   title: 't',
   body: '',
   created_at: '2026-09-19T00:00:00Z',
   updated_at: '2026-09-20T10:01:00Z',
   user: { login: 'author' },
   head: { ref: 'f', sha: 'abc', repo: { name: 'r', owner: { login: 'o' } } },
   base: { ref: 'master', repo: { full_name: 'o/r' } },
   requested_reviewers: [],
   requested_teams: teams.map(slug => ({ slug })),
});
const wire = pull => {
   const o = pull.toObject();
   return [o.requested_teams, o.team_requests];
};

test('a team request webhook gives the team a time, a removal drops it', () => {
   Pull.recordTeamRequested('o/r', 20, 'platform', 1000);
   assert.deepEqual(wire(Pull.fromGithubApi(payload(20, ['platform']))), [
      ['platform'],
      [{ slug: 'platform', at: 1000 }],
   ]);
   Pull.recordTeamRequestRemoved('o/r', 20, 'platform');
   assert.deepEqual(wire(Pull.fromGithubApi(payload(20, []))), [[], []]);
   // asked again with no webhook seen: no time
   assert.deepEqual(wire(Pull.fromGithubApi(payload(20, ['platform'])))[1], [
      { slug: 'platform', at: null },
   ]);
});

test('a refresh keeps known times and adds new teams without one', () => {
   Pull.recordTeamRequested('o/r', 21, 'platform', 1000);
   Pull.fromGithubApi(payload(21, ['platform']));
   const [slugs, requests] = wire(Pull.fromGithubApi(payload(21, ['platform', 'design'])));
   assert.deepEqual(slugs, ['platform', 'design']);
   assert.deepEqual(requests, [
      { slug: 'platform', at: 1000 },
      { slug: 'design', at: null },
   ]);
});

test('the times survive the database round trip; old string rows read as no time', () => {
   Pull.recordTeamRequested('o/r', 22, 'design', 5000);
   const pull = Pull.fromGithubApi(payload(22, ['design']));
   const stored = JSON.parse(new DBPull(pull).data.requested_teams);
   assert.deepEqual(stored, [{ slug: 'design', at: 5000 }]);

   const row = n => ({
      repo: 'o/r',
      number: n,
      state: 'open',
      title: 't',
      body: '',
      draft: 0,
      date: 1753200000,
      date_updated: 1753300000,
      head_branch: 'f',
      head_sha: 'abc',
      base_branch: 'master',
      owner: 'author',
      assignees: [],
      requested_reviewers: [],
      cr_req: 2,
      qa_req: 1,
   });
   const back = Pull.getFromDB({ ...row(22), requested_teams: stored }, [], [], [], [], []);
   assert.deepEqual(wire(back), [['design'], [{ slug: 'design', at: 5000 }]]);
   const old = Pull.getFromDB({ ...row(23), requested_teams: ['design'] }, [], [], [], [], []);
   assert.deepEqual(wire(old), [['design'], [{ slug: 'design', at: null }]]);
});
