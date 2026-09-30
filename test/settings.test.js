import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import bodyParser from 'body-parser';
import config from '../lib/config-loader.js';
import db from '../lib/db.js';
import { projectSettings } from '../lib/projects.js';
import { _resetSettings, loadSettings } from '../lib/settings.js';
import settingsController from '../controllers/settings.js';
import { canWrite } from '../controllers/roadmap.js';

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
      from: { developer_teams: 'config' },
   });
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

test('a login on two teams, or a missing field, is a 400 that says why', async () => {
   const twice = await patch({ developer_teams: { Store: ['alice'], FixBot: ['Alice'] } });
   assert.equal(twice.status, 400);
   assert.match(twice.body.error, /both Store and FixBot/);
   assert.equal((await patch({})).status, 400);
   assert.equal(table.size, 0);
});
