import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import bodyParser from 'body-parser';
import config from '../lib/config-loader.js';
import db from '../lib/db.js';
import { projectSettings } from '../lib/projects.js';
import { _resetSettings, loadSettings, loadSettingsWithRetry } from '../lib/settings.js';
import settingsController from '../controllers/settings.js';
import { canWrite } from '../controllers/roadmap.js';
import { mondayOf, utcDay } from '../shared/dist/index.js';

// an in-memory project_settings table behind a stubbed db.query
let table = new Map();
function fakeQuery(sql, params = []) {
   if (sql.startsWith('SELECT `name`, `value` FROM `project_settings`')) {
      return [...table.values()];
   }
   if (sql.startsWith('REPLACE INTO `project_settings` SET ?')) {
      table.set(params[0].name, params[0]);
      return { affectedRows: 1 };
   }
   if (sql.startsWith('DELETE FROM `project_settings`')) {
      table.delete(params[0]);
      return { affectedRows: 1 };
   }
   throw new Error(`unexpected query: ${sql}`);
}

let server;
let base;
const savedProjects = config.projects;
before(async () => {
   mock.method(db, 'query', async (sql, params) => fakeQuery(sql, params));
   config.projects = { repo: 'test/projects', developerTeams: { Store: ['alice'] } };
   const app = express();
   app.use(bodyParser.json());
   app.use((req, res, next) => {
      req.isAuthenticated = () => true;
      req.user = { username: 'dana' };
      next();
   });
   app.get('/settings', settingsController.get);
   app.patch('/settings', canWrite, settingsController.update);
   await new Promise(resolve => {
      server = app.listen(0, () => {
         base = `http://127.0.0.1:${server.address().port}`;
         resolve();
      });
   });
});
after(() => {
   mock.restoreAll();
   config.projects = savedProjects;
   _resetSettings();
   server.close();
});
beforeEach(() => {
   table = new Map();
   _resetSettings();
});

const patch = async body => {
   const res = await fetch(`${base}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
   });
   return { status: res.status, body: await res.json() };
};

test('teams come from config.js until someone saves them', async () => {
   const res = await fetch(`${base}/settings`);
   assert.deepEqual(await res.json(), {
      developer_teams: { Store: ['alice'] },
      decide_rotation: null,
      ongoing_projects: [],
      from: { developer_teams: 'config' },
   });
});

test('who runs Decide takes turns from this week, first in the list first', async () => {
   const saved = await patch({ decide_rotation: [' alice ', 'bo', 'Alice'] });
   assert.equal(saved.status, 200);
   const monday = mondayOf(utcDay(Date.now() / 1000));
   assert.deepEqual(saved.body.decide_rotation, { logins: ['alice', 'bo'], from: monday });
   assert.deepEqual(projectSettings().decideRotation, { logins: ['alice', 'bo'], from: monday });
   // the teams weren't sent, so they stay
   assert.equal(table.has('developer_teams'), false);
   const bad = await patch({ decide_rotation: ['two words'] });
   assert.equal(bad.status, 400);
   assert.match(bad.body.error, /isn't a GitHub login/);
   assert.equal((await patch({ decide_rotation: null })).body.decide_rotation, null);
});

test('saved teams replace config.js for every count, and null goes back', async () => {
   const saved = await patch({ developer_teams: { Store: ['alice', 'bo'], FixBot: [' erin '] } });
   assert.equal(saved.status, 200);
   assert.deepEqual(saved.body.developer_teams, { Store: ['alice', 'bo'], FixBot: ['erin'] });
   assert.equal(saved.body.from.developer_teams, 'saved');
   assert.equal(table.get('developer_teams').updated_by, 'dana');
   assert.equal(projectSettings().teamOf('Erin'), 'FixBot');
   // a restart reads the table back
   _resetSettings();
   await loadSettings();
   assert.equal(projectSettings().teamOf('bo'), 'Store');
   const reset = await patch({ developer_teams: null });
   assert.equal(reset.body.from.developer_teams, 'config');
   assert.equal(projectSettings().teamOf('bo'), null);
});

test('ongoing projects save as a sorted list, and an empty one clears the row', async () => {
   const saved = await patch({ ongoing_projects: ['translations', 'docs', 'translations'] });
   assert.equal(saved.status, 200);
   assert.deepEqual(saved.body.ongoing_projects, ['docs', 'translations']);
   assert.deepEqual(projectSettings().ongoing, ['docs', 'translations']);
   assert.equal((await patch({ ongoing_projects: ['two words'] })).status, 400);
   assert.deepEqual((await patch({ ongoing_projects: [] })).body.ongoing_projects, []);
   assert.equal(table.has('ongoing_projects'), false);
});

test('ongoing_project marks one project at a time, and quick clicks keep each other', async () => {
   await patch({ ongoing_projects: ['docs'] });
   // a slow save, so the second click lands while the first is saving
   const slow = mock.method(db, 'query', async (sql, params) => {
      if (sql.startsWith('REPLACE')) await new Promise(done => setTimeout(done, 30));
      return fakeQuery(sql, params);
   });
   const both = await Promise.all([
      patch({ ongoing_project: { slug: 'translations', ongoing: true } }),
      patch({ ongoing_project: { slug: 'upkeep', ongoing: true } }),
   ]);
   slow.mock.restore();
   assert.deepEqual(
      both.map(r => r.status),
      [200, 200]
   );
   assert.deepEqual(projectSettings().ongoing, ['docs', 'translations', 'upkeep']);
   const off = await patch({ ongoing_project: { slug: 'docs', ongoing: false } });
   assert.deepEqual(off.body.ongoing_projects, ['translations', 'upkeep']);
   assert.equal((await patch({ ongoing_project: { slug: 'docs' } })).status, 400);
   assert.equal(
      (await patch({ ongoing_project: { slug: 'two words', ongoing: true } })).status,
      400
   );
   await patch({ ongoing_projects: null });
});

test('a login on two teams, or a missing field, is a 400 that says why', async () => {
   const twice = await patch({ developer_teams: { Store: ['alice'], FixBot: ['Alice'] } });
   assert.equal(twice.status, 400);
   assert.match(twice.body.error, /both Store and FixBot/);
   assert.equal((await patch({})).status, 400);
   assert.equal(table.size, 0);
});

test('a save waits for the first load, so config defaults never overwrite saved settings', async () => {
   table.set('ongoing_projects', { name: 'ongoing_projects', value: '["keep"]' });
   _resetSettings(false);
   const refused = await patch({ ongoing_project: { slug: 'new', ongoing: true } });
   assert.equal(refused.status, 503);
   assert.match(refused.body.error, /still loading/);
   assert.equal((await fetch(`${base}/settings`)).status, 200);
   await loadSettings();
   const saved = await patch({ ongoing_project: { slug: 'new', ongoing: true } });
   assert.deepEqual(saved.body.ongoing_projects, ['keep', 'new']);
});

test('the startup load tries again until the table can be read', async () => {
   _resetSettings(false);
   let tries = 0;
   const real = db.query;
   mock.method(console, 'error', () => {});
   mock.method(db, 'query', async (sql, params) => {
      if (++tries < 3) throw new Error('down');
      return fakeQuery(sql, params);
   });
   await loadSettingsWithRetry(1, 2);
   assert.equal(tries, 3);
   mock.method(db, 'query', real);
});
