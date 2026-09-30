import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import config from '../lib/config-loader.js';
import db from '../lib/db.js';
import Pull from '../models/pull.js';
import Label from '../models/label.js';
import pullManager from '../lib/pull-manager.js';
import {
   parseWindow,
   projectSettings,
   projectsFromRows,
   reviewsFromRows,
   spansFromRows,
   MAX_WINDOW_DAYS,
} from '../lib/projects.js';
import projectsController from '../controllers/projects.js';

const DAY = 86400;
// 2026-09-29 12:00 UTC
const NOW = Date.UTC(2026, 8, 29, 12) / 1000;

test('parseWindow defaults to the 30 days ending today', () => {
   assert.deepEqual(parseWindow({}, NOW), { start: '2026-08-31', end: '2026-09-29' });
   assert.deepEqual(parseWindow({ end: '2026-09-10' }, NOW), {
      start: '2026-08-12',
      end: '2026-09-10',
   });
});

test('parseWindow rejects bad days, backwards and oversized windows, repeats', () => {
   assert.ok(parseWindow({ start: '9/1/2026' }, NOW).error);
   assert.ok(parseWindow({ start: '2026-09-20', end: '2026-09-10' }, NOW).error);
   assert.ok(parseWindow({ start: '2020-01-01', end: '2026-09-10' }, NOW).error);
   assert.ok(parseWindow({ start: ['2026-09-01', '2026-09-02'] }, NOW).error);
   // the longest allowed window still passes
   const start = new Date((NOW - (MAX_WINDOW_DAYS - 1) * DAY) * 1000).toISOString().slice(0, 10);
   assert.equal(parseWindow({ start }, NOW).error, undefined);
});

const issueRow = over => ({
   repo: 'test/projects',
   number: 1,
   title: 'Alpha',
   status: 'open',
   state_reason: null,
   assignee: null,
   milestone_title: null,
   milestone_due_on: null,
   ...over,
});

test('projectsFromRows reads name, lead, target, parents and ongoing off the issue', () => {
   const projects = projectsFromRows(
      [
         issueRow({ number: 1, assignee: 'lee', milestone_title: 'October', milestone_due_on: NOW }),
         issueRow({ number: 2, title: 'Not a project' }),
      ],
      [
         { number: 1, title: 'project:alpha' },
         { number: 1, title: 'parent:store' },
         { number: 1, title: 'parent:checkout' },
         { number: 1, title: 'ongoing' },
         { number: 2, title: 'bug' },
      ],
      'project:'
   );
   assert.deepEqual(projects, [
      {
         slug: 'alpha',
         name: 'Alpha',
         repo: 'test/projects',
         number: 1,
         state: 'open',
         state_reason: null,
         ongoing: true,
         parents: ['checkout', 'store'],
         lead: 'lee',
         target: { title: 'October', due_on: '2026-09-29T12:00:00.000Z' },
         created_at: null,
         closed_at: null,
      },
   ]);
});

test('projectsFromRows fills created_at and closed_at from the issue dates', () => {
   const projects = projectsFromRows(
      [issueRow({ number: 9, date_created: 1700000000, date_closed: 1700100000 })],
      [{ number: 9, title: 'project:gamma' }],
      'project:'
   );
   assert.equal(projects[0].created_at, new Date(1700000000 * 1000).toISOString());
   assert.equal(projects[0].closed_at, new Date(1700100000 * 1000).toISOString());
});

test('projectsFromRows keeps the open issue when two carry one label', () => {
   const projects = projectsFromRows(
      [
         issueRow({ number: 5, title: 'Old', status: 'closed', state_reason: 'completed' }),
         issueRow({ number: 3, title: 'Current' }),
      ],
      [
         { number: 5, title: 'project:alpha' },
         { number: 3, title: 'project:alpha' },
      ],
      'project:'
   );
   assert.equal(projects.length, 1);
   assert.equal(projects[0].name, 'Current');
});

test('spansFromRows files PRs by label, leaves bots out, falls back to the merge time', () => {
   const spans = spansFromRows(
      [
         { repo: 'Test/Repo-A', number: 1, owner: 'alice', date: 100, date_closed: 200, date_merged: 200 },
         { repo: 'test/repo-a', number: 2, owner: 'fixture-bot', date: 100, date_closed: null, date_merged: null },
         { repo: 'test/repo-a', number: 3, owner: 'bob', date: 150, date_closed: null, date_merged: 300 },
      ],
      [{ repo: 'test/repo-a', number: 1, title: 'project:alpha' }],
      'project:'
   );
   assert.deepEqual(spans, [
      { author: 'alice', project: 'alpha', opened: 100, closed: 200, merged: true },
      { author: 'bob', project: null, opened: 150, closed: 300, merged: true },
   ]);
});

test('reviewsFromRows keeps repo and number, drops a bot on either side, leaves a self-stamp for windowStats to ignore', () => {
   const reviews = reviewsFromRows([
      { reviewer: 'carol', repo: 'test/repo-a', number: 11, author: 'alice', at: 100 },
      { reviewer: 'fixture-bot', repo: 'test/repo-a', number: 12, author: 'alice', at: 100 },
      { reviewer: 'carol', repo: 'test/repo-a', number: 14, author: 'fixture-bot', at: 100 },
      { reviewer: 'alice', repo: 'test/repo-a', number: 11, author: 'alice', at: 100 },
   ]);
   assert.deepEqual(reviews, [
      { reviewer: 'carol', author: 'alice', at: 100, repo: 'test/repo-a', number: 11 },
      { reviewer: 'alice', author: 'alice', at: 100, repo: 'test/repo-a', number: 11 },
   ]);
});

// ---- the endpoints, over HTTP, with the DB stubbed ----

function pullRow(number, owner, over = {}) {
   return {
      repo: 'test/repo-a',
      number,
      state: 'open',
      title: `PR ${number}`,
      body: '',
      draft: 0,
      date: NOW - 3 * DAY,
      date_updated: NOW - DAY,
      date_closed: null,
      mergeable: 1,
      date_merged: null,
      difficulty: null,
      additions: 10,
      deletions: 1,
      changed_files: 1,
      milestone_title: null,
      milestone_due_on: null,
      head_branch: `b${number}`,
      head_sha: `sha${number}`,
      base_branch: 'main',
      owner,
      assignees: [],
      requested_reviewers: [],
      cr_req: 1,
      qa_req: 1,
      ...over,
   };
}

// the roadmap_items rows the stubbed db answers with; a test sets its own
let roadmapRows = [];

const label = (title, number) => new Label({ name: title }, number, 'test/repo-a', 'job-bot');

function makeApp() {
   const app = express();
   app.get('/projects-data', projectsController.getBoardData);
   app.get('/api/v1/projects', projectsController.getProjects);
   app.get('/api/v1/people', projectsController.getPeople);
   app.get('/api/v1/decide', projectsController.getDecide);
   app.get('/api/v1/load', projectsController.getLoad);
   return app;
}

function listen(app) {
   return new Promise(resolve => {
      const server = app.listen(0, () => resolve({ port: server.address().port, server }));
   });
}

before(() => {
   // Alice is on a developer team; Bob and Carol (a reviewer with no PRs of
   // her own) aren't, so the window's dev/non-dev and review splits have
   // something real to split. 'Alice' is capitalized on purpose: teamOf must
   // still match the lowercase 'alice' pulls are seeded with.
   config.projects = { repo: 'test/projects', developerTeams: { Store: ['Alice'] } };
   const now = Math.floor(Date.now() / 1000);
   // two open PRs in alpha (one person), one unsorted, one bot PR in alpha
   const seed = (row, labels) =>
      pullManager.updatePull(Pull.getFromDB(row, [], [], [], [], labels));
   seed(pullRow(11, 'alice'), [label('project:alpha', 11)]);
   seed(pullRow(12, 'alice'), [label('project:alpha', 12)]);
   seed(pullRow(13, 'bob'), []);
   seed(pullRow(14, 'fixture-bot'), [label('project:alpha', 14)]);
   // merged yesterday in alpha: alice's third PR there
   seed(pullRow(15, 'alice', { state: 'closed', date_closed: now - DAY, date_merged: now - DAY }), [
      label('project:alpha', 15),
   ]);
   mock.method(db, 'query', async sql => {
      if (sql.startsWith('SELECT * FROM issues')) {
         return [
            issueRow({ number: 7, title: 'Alpha work', assignee: 'alice' }),
            issueRow({ number: 8, title: 'Beta', status: 'closed', state_reason: 'not_planned' }),
         ];
      }
      if (sql.startsWith('SELECT number, title FROM pull_labels')) {
         return [
            { number: 7, title: 'project:alpha' },
            { number: 8, title: 'project:beta' },
         ];
      }
      if (sql.startsWith('SELECT repo, number, owner')) {
         return [
            { repo: 'test/repo-a', number: 11, owner: 'alice', date: now - 3 * DAY, date_closed: null, date_merged: null },
            { repo: 'test/repo-a', number: 13, owner: 'bob', date: now - 3 * DAY, date_closed: null, date_merged: null },
            { repo: 'test/repo-a', number: 15, owner: 'alice', date: now - 5 * DAY, date_closed: now - DAY, date_merged: now - DAY },
         ];
      }
      if (sql.startsWith('SELECT repo, number, title FROM pull_labels')) {
         return [
            { repo: 'test/repo-a', number: 11, title: 'project:alpha' },
            { repo: 'test/repo-a', number: 15, title: 'project:alpha' },
         ];
      }
      if (sql.startsWith('SELECT s.user AS reviewer')) {
         return [
            // carol CRs alice's PR in alpha: a developer's PR
            { reviewer: 'carol', repo: 'test/repo-a', number: 11, author: 'alice', at: now - 2 * DAY },
            // carol QAs bob's unsorted PR: a non-developer's PR
            { reviewer: 'carol', repo: 'test/repo-a', number: 13, author: 'bob', at: now - DAY },
            // a bot's stamp, dropped by reviewsFromRows
            { reviewer: 'fixture-bot', repo: 'test/repo-a', number: 11, author: 'alice', at: now - DAY },
            // alice reviewing her own PR, dropped by windowStats (not reviewsFromRows)
            { reviewer: 'alice', repo: 'test/repo-a', number: 11, author: 'alice', at: now - DAY },
         ];
      }
      if (sql.includes('FROM `roadmap_items`')) return roadmapRows;
      if (sql.includes('FROM `roadmap_updates`')) return [];
      throw new Error(`unexpected query: ${sql}`);
   });
});

after(() => {
   mock.restoreAll();
   delete config.projects;
});

async function get(path) {
   const { port, server } = await listen(makeApp());
   const res = await fetch(`http://127.0.0.1:${port}${path}`);
   const body = await res.json();
   server.close();
   return { status: res.status, body };
}

test('projectSettings.teamOf matches a listed login case-insensitively', () => {
   const settings = projectSettings();
   assert.equal(settings.teamOf('alice'), 'Store');
   assert.equal(settings.teamOf('ALICE'), 'Store');
   assert.equal(settings.teamOf('bob'), null);
   assert.deepEqual(settings.teams, { Store: ['Alice'] });
});

test('/api/v1/projects lists each project with today and the window', async () => {
   const { status, body } = await get('/api/v1/projects');
   assert.equal(status, 200);
   const alpha = body.projects.find(p => p.slug === 'alpha');
   assert.equal(alpha.name, 'Alpha work');
   assert.equal(alpha.standing, 'live');
   assert.equal(alpha.lead, 'alice');
   // the bot PR is left out; alice alone has three PRs here, and both open
   // ones still need their CR
   assert.deepEqual(alpha.open, ['test/repo-a#11', 'test/repo-a#12']);
   assert.deepEqual(alpha.merged_recently, ['test/repo-a#15']);
   assert.deepEqual(alpha.flags, ['one_person', 'waiting_on_review']);
   assert.equal(alpha.window.merged, 1);
   const beta = body.projects.find(p => p.slug === 'beta');
   assert.equal(beta.standing, 'dropped');
   assert.deepEqual(body.unsorted.open, ['test/repo-a#13']);
   assert.equal(body.totals.backlog_end, 2);
   assert.equal(body.days.length, 30);
});

test('/api/v1/people puts the live projects and open PRs beside the window', async () => {
   const { status, body } = await get('/api/v1/people');
   assert.equal(status, 200);
   const alice = body.people.find(p => p.login === 'alice');
   assert.deepEqual(alice.live_projects, ['alpha']);
   assert.equal(alice.open_now, 2);
   assert.deepEqual(alice.projects_in_window, ['alpha']);
   assert.equal(alice.window.merged, 1);
   assert.equal(body.people[0].login, 'alice');
   assert.ok(!body.people.some(p => p.login === 'fixture-bot'));
});

test('/api/v1/people carries team and review counts, and a reviewer with no PRs still appears', async () => {
   const { status, body } = await get('/api/v1/people');
   assert.equal(status, 200);
   const alice = body.people.find(p => p.login === 'alice');
   assert.equal(alice.team, 'Store');
   const bob = body.people.find(p => p.login === 'bob');
   assert.equal(bob.team, null);
   const carol = body.people.find(p => p.login === 'carol');
   assert.ok(carol, 'carol only reviewed in the window and has no PRs, but still gets a row');
   assert.equal(carol.team, null);
   // one CR on alice (a developer) and one QA on bob (not one); the bot's
   // stamp and alice's self-stamp are both left out of the count
   assert.equal(carol.reviews, 2);
   assert.equal(carol.reviews_on_non_dev, 1);
});

test('/projects-data sends the registry and the window, and 400s a bad window', async () => {
   const ok = await get('/projects-data?start=2026-09-01&end=2026-09-29');
   assert.equal(ok.status, 200);
   assert.equal(ok.body.label_prefix, 'project:');
   assert.deepEqual(
      ok.body.projects.map(p => p.slug),
      ['alpha', 'beta']
   );
   assert.equal(ok.body.window.start, '2026-09-01');
   const bad = await get('/projects-data?start=2026-09-29&end=2026-09-01');
   assert.equal(bad.status, 400);
});

test('project= narrows the window to one project and rejects a repeated one', async () => {
   const one = await get('/projects-data?project=alpha');
   assert.equal(one.status, 200);
   // alpha holds #11 (open) and #15 (merged); bob's unsorted #13 drops out
   assert.equal(one.body.window.totals.backlog_end, 1);
   assert.equal(one.body.window.totals.merged, 1);
   assert.deepEqual(Object.keys(one.body.window.people), ['alice', 'carol']);
   // carol's CR on alice's #11 is in alpha and stays; her QA on bob's #13
   // (unsorted) drops out along with the PR itself
   assert.equal(one.body.window.people.carol.reviews, 1);
   assert.equal(one.body.window.people.carol.reviews_on_non_dev, 0);
   const bad = await get('/projects-data?project=a&project=b');
   assert.equal(bad.status, 400);
});

test('the endpoints 404 when this install has no projects config', async () => {
   const saved = config.projects;
   delete config.projects;
   const { status } = await get('/api/v1/projects');
   config.projects = saved;
   assert.equal(status, 404);
});

/** A roadmap_items row, as lib/roadmap.js selects it. */
function roadmapRow(over) {
   return {
      id: 1,
      name: 'Alpha plan',
      project: 'alpha',
      team: null,
      lead_login: 'alice',
      status: 'active',
      start: '2026-01-05',
      weeks: 4,
      priority: 0,
      notes: '',
      waits_on: null,
      updated_by: 'alice',
      updated_at: 1767600000,
      ...over,
   };
}

test('/api/v1/decide lists a live project with no plan as new, then a slipped plan as over', async () => {
   roadmapRows = [];
   const fresh = await get('/api/v1/decide');
   assert.equal(fresh.status, 200);
   const alpha = fresh.body.decisions.find(d => d.project === 'alpha');
   assert.equal(alpha.name, 'Alpha work');
   assert.equal(alpha.lead, 'alice');
   assert.equal(alpha.open, 2);
   assert.equal(alpha.item, null);
   assert.equal(alpha.reasons[0].kind, 'new');

   // a plan that ended in February, its project still in flight
   roadmapRows = [roadmapRow()];
   const slipped = await get('/api/v1/decide');
   const row = slipped.body.decisions.find(d => d.project === 'alpha');
   assert.equal(row.name, 'Alpha plan');
   assert.deepEqual(row.item, {
      id: 1,
      status: 'active',
      start: '2026-01-05',
      weeks: 4,
      end: '2026-02-01',
   });
   assert.ok(row.reasons.some(r => r.kind === 'over' && r.weeks > 0));

   // parking it is a decision: nothing is owed until its PRs move again
   roadmapRows = [roadmapRow({ status: 'parked', updated_at: Math.floor(Date.now() / 1000) })];
   const parked = await get('/api/v1/decide');
   assert.ok(!parked.body.decisions.some(d => d.project === 'alpha'));
   roadmapRows = [];
});

test('/api/v1/load counts this week and runs undecided projects ahead', async () => {
   roadmapRows = [];
   const { status, body } = await get('/api/v1/load');
   assert.equal(status, 200);
   assert.equal(body.developers, 1);
   assert.deepEqual(
      { on: body.this_week.on_plan, off: body.this_week.off_plan },
      { on: 0, off: 1 }
   );
   // 12 weeks back, this one, and 26 ahead
   assert.equal(body.weeks.length, 39);
   const last = body.weeks.at(-1);
   assert.equal(last.projected, true);
   assert.equal(last.off_plan, 1);
   assert.deepEqual(body.peak, { count: 1, week: body.this_week.week });

   // once the roadmap has a word on it, the weeks ahead stop counting it
   roadmapRows = [roadmapRow({ status: 'dropped' })];
   const dropped = await get('/api/v1/load');
   assert.equal(dropped.body.weeks.at(-1).off_plan, 0);
   roadmapRows = [];

   const bad = await get('/api/v1/load?start=nope');
   assert.equal(bad.status, 400);
});
