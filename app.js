import config from './lib/config-loader.js';
import express from 'express';
import bodyParser from 'body-parser';
import expressSession from 'express-session';
import authManager from './lib/authentication.js';
import socketAuthenticator from './lib/socket-auth.js';
import refresh from './lib/refresh.js';
import pullManager from './lib/pull-manager.js';
import git from './lib/git-manager.js';
import dbManager from './lib/db-manager.js';
import pullQueue from './lib/pull-queue.js';
import mainController from './controllers/main.js';
import hooksController from './controllers/githubHooks.js';
import statsController from './controllers/stats.js';
import userNamesController from './controllers/user-names.js';
import projectsController from './controllers/projects.js';
import roadmapController, { canWrite } from './controllers/roadmap.js';
import { API_ROUTES, apiIndex } from './controllers/api-routes.js';
import settingsController from './controllers/settings.js';
import { loadSettings } from './lib/settings.js';
import { issueRepos, projectSettings } from './lib/projects.js';
import { syncWork } from './lib/work.js';
import apiAuth from './lib/api-auth.js';
import Debug from './lib/debug.js';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const reqLogger = Debug('pulldasher:server:request');
const debug = Debug('pulldasher');

const app = express();
const httpServer = createServer(app);
const maxPostSize = 1024 * 1024;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.set('view engine', 'html');

/**
 * Middleware
 */
app.use('/public', express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({ limit: maxPostSize, extended: false }));
app.use(bodyParser.json({ limit: maxPostSize }));
app.use(
   expressSession({
      secret: config.session.secret,
      resave: false,
      saveUninitialized: false,
   })
);
app.use(authManager.passport.initialize());
app.use(authManager.passport.session());

app.use(function (req, res, next) {
   reqLogger('%s %s', req.method, req.url);
   next();
});

/**
 * Routes
 */
authManager.setupRoutes(app);
// v2 is the primary board at the root; the legacy v1 board runs side-by-side
// under /v1 (its assets are built with a matching /v1/ publicPath). Both share
// the same /token + socket.io API below. The /v1 mount is more specific, so it
// must precede the '/' catch-all static mount.
app.use('/v1', express.static(__dirname + '/frontend/dist'));
app.use('/', express.static(__dirname + '/frontend-v2/dist'));
app.get('/token', mainController.getToken);
app.get('/stats-history', statsController.getHistory);
app.get('/user-names', userNamesController.getNames);
app.get('/projects-data', projectsController.getBoardData);
app.get('/retro-data', projectsController.getRetro);
app.get('/work-data', projectsController.getWork);
app.get('/issue-search', projectsController.searchIssues);
app.get('/project-work', projectsController.getProjectWork);
app.post('/project-issues', canWrite, projectsController.attachIssue);
app.delete('/project-issues', canWrite, projectsController.detachIssue);
// the roadmap is the one part of the Projects tab people edit here: reads are
// gated like the other board data (lib/authentication.js), writes by canWrite
app.get('/roadmap', roadmapController.list);
app.post('/roadmap', canWrite, roadmapController.create);
app.put('/roadmap/order', canWrite, roadmapController.reorder);
app.patch('/roadmap/:id', canWrite, roadmapController.update);
app.delete('/roadmap/:id', canWrite, roadmapController.remove);
app.get('/roadmap/:id/updates', roadmapController.updates);
app.post('/roadmap/:id/updates', canWrite, roadmapController.postUpdate);
app.get('/settings', settingsController.get);
app.patch('/settings', canWrite, settingsController.update);
app.post('/hooks/main', hooksController.main);

// /api/v1: machine-to-machine JSON for the review skills and scripts,
// Bearer-authed with the caller's own GitHub token (see lib/api-auth). Every
// route is in controllers/api-routes.js, and GET /api/v1 lists them.
// Independent of the cookie-session gate -- setupRoutes never registers these
// paths, so the session `auth` middleware doesn't run for them.
app.get('/api/v1', apiAuth, apiIndex);
for (const { method, path, handlers } of API_ROUTES) app[method](path, apiAuth, ...handlers);

// Warm the bot-login cache (used to tell a pulldasher claim apart from a
// GitHub-UI self-request) before any webhook or socket traffic needs it.
// Memoized in git-manager, so this just avoids the first caller paying for
// the lookup.
git.getBotLogin();

// Saved settings (the developer teams) replace config.js's once loaded;
// until then, and if the table can't be read, config.js's stand.
loadSettings().catch(err => console.error('loading saved settings failed:', err));

debug('Loading all recent pulls from the DB');
dbManager
   .getRecentPulls(pullManager.getOldestAllowedPullTimestamp())
   .then(function (pulls) {
      debug('Loaded %s pulls', pulls.length);
      pullQueue.pause();
      pulls.forEach(function (pull) {
         pullManager.updatePull(pull);
      });
      pullQueue.resume();
   })
   .then(function () {
      debug('Refreshing all open pulls from the API');
      refresh.openPulls();
      syncProjectIssues();
      syncAttachedIssues();
   })
   .done();

// Webhooks get lost, and a lost `closed` left a PR open on the board until the
// next restart (pulldasher#501 repairs it only at startup), which inflates every
// backlog number. Once an hour, list each repo's open pulls and refresh just the
// ones the DB has wrong, and pick up project issues that changed.
const RECONCILE_MS = 60 * 60 * 1000;
setInterval(function () {
   refresh.reconcileOpenPulls().catch(function (err) {
      console.error('Hourly open-pull repair failed: %s', (err && err.message) || err);
   });
   syncProjectIssues();
   syncAttachedIssues();
}, RECONCILE_MS);

// The issues added to projects by hand, and which PRs link each issue a
// project has (lib/work.js), read off GitHub once an hour; a webhook on one
// of those issues reads them sooner.
function syncAttachedIssues() {
   syncWork(projectSettings()).catch(function (err) {
      console.error('Work sync failed: %s', (err && err.message) || err);
   });
}

// Project issues can live in any tracked repo (lib/projects.js issueRepos).
// The projects repo is synced whole at startup; a tracked repo only from
// TRACKED_ISSUES_DAYS back, since listing every issue of a big repo costs
// thousands of calls, and webhooks already keep its issues current. So an
// issue labeled while webhooks were down for longer than that waits for its
// next change (or bin/refresh-open-issues). After that, only what changed.
// `since` backs off a few minutes so GitHub's clock can't skip an update.
const TRACKED_ISSUES_DAYS = 7;
const projectIssuesSyncedAt = new Map();
function syncProjectIssues() {
   const projects = projectSettings();
   if (!projects) return;
   const startedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
   const lookback = new Date(Date.now() - TRACKED_ISSUES_DAYS * 86400 * 1000).toISOString();
   for (const repo of issueRepos(projects)) {
      const since = projectIssuesSyncedAt.get(repo) ?? (repo === projects.repo ? null : lookback);
      refresh
         .issuesChangedSince(repo, since)
         .then(function (report) {
            // move the marker only past a clean run, so a failed issue is retried
            if (!report.failedRepos.length && !report.failedItems.length) {
               projectIssuesSyncedAt.set(repo, startedAt);
            }
         })
         .catch(function (err) {
            console.error('Project issue sync failed in %s: %s', repo, (err && err.message) || err);
         });
   }
}

//====================================================
// Socket.IO
const io = new Server(httpServer);
io.on('connection', function (socket) {
   var unauthenticated_timeout =
      config.unauthenticated_timeout !== undefined ? config.unauthenticated_timeout : 10 * 1000;

   var autoDisconnect = setTimeout(function () {
      socket.disconnect();
   }, unauthenticated_timeout);

   socket.once('authenticate', function (token) {
      // They did respond. No need to drop their connection for not responding.
      clearTimeout(autoDisconnect);

      var user = socketAuthenticator.retrieveUser(token);
      if (user) {
         socket.user = user;
         socket.emit('authenticated');
         pullManager.addSocket(socket);
      } else {
         socket.emit('unauthenticated');
         socket.disconnect();
      }
   });

   socket.on('refresh', function (repo, number) {
      refresh.pull(repo, number).catch(function (err) {
         console.error(
            'Socket "refresh" failed for %s#%s: %s',
            repo,
            number,
            (err && err.message) || err
         );
      });
   });

   // GitHub's requested_reviewers is now the only claim state (see
   // review_requests on the pull payload). `ttlMs` may still arrive from
   // older clients that used to size a claim's expiry; it's meaningless now
   // and ignored. Requesting the reviewer on GitHub, then refreshing the pull
   // from the API, is what makes the claim show up for every client -- there's
   // no separate broadcast to do here.
   socket.on('claimReview', function (repo, number) {
      if (!socket.user) {
         return;
      }
      git.requestReviewer(repo, number, socket.user.username)
         .then(function () {
            return refresh.pull(repo, number);
         })
         .catch(function (err) {
            console.error(
               'Socket "claimReview" failed for %s#%s (user %s): %s',
               repo,
               number,
               socket.user.username,
               (err && err.message) || err
            );
         });
   });

   socket.on('releaseReview', function (repo, number) {
      if (!socket.user) {
         return;
      }
      git.removeReviewer(repo, number, socket.user.username)
         .then(function () {
            return refresh.pull(repo, number);
         })
         .catch(function (err) {
            console.error(
               'Socket "releaseReview" failed for %s#%s (user %s): %s',
               repo,
               number,
               socket.user.username,
               (err && err.message) || err
            );
         });
   });
});

debug('Listening on port %s', config.port);
httpServer.listen(config.port);
