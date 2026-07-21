import config from './lib/config-loader.js';
import express from 'express';
import bodyParser from 'body-parser';
import expressSession from 'express-session';
import authManager from './lib/authentication.js';
import socketAuthenticator from './lib/socket-auth.js';
import refresh from './lib/refresh.js';
import pullManager from './lib/pull-manager.js';
import claims, { SWEEP_INTERVAL_MS } from './lib/claims.js';
import git from './lib/git-manager.js';
import dbManager from './lib/db-manager.js';
import pullQueue from './lib/pull-queue.js';
import mainController from './controllers/main.js';
import hooksController from './controllers/githubHooks.js';
import statsController from './controllers/stats.js';
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
app.post('/hooks/main', hooksController.main);

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
   })
   .done();

/*
@TODO: Update pulls which were open last time Pulldasher ran but are closed now.
dbManager.closeStalePulls();
*/

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
         socket.emit('reviewClaims', claims.all());
         pullManager.addSocket(socket);
      } else {
         socket.emit('unauthenticated');
         socket.disconnect();
      }
   });

   socket.on('refresh', function (repo, number) {
      refresh.pull(repo, number);
   });

   socket.on('claimReview', function (repo, number, ttlMs) {
      if (!socket.user) {
         return;
      }
      claims.claim(repo, number, socket.user.username, Date.now(), ttlMs);
      io.emit('reviewClaims', claims.all());
      // Mirror the claim onto the PR itself: put the claimer in GitHub's
      // Reviewers list so the claim is visible to anyone not on the dashboard.
      // Best-effort and fire-and-forget — the local claim already succeeded, and
      // GitHub legitimately refuses this when the claimer authored the PR.
      git.requestReviewer(repo, number, socket.user.username);
   });

   socket.on('releaseReview', function (repo, number) {
      if (!socket.user) {
         return;
      }
      if (claims.release(repo, number, socket.user.username)) {
         io.emit('reviewClaims', claims.all());
         git.removeReviewer(repo, number, socket.user.username);
      }
   });
});

// Sweep expired review claims and re-broadcast the whole map on an interval,
// so a stale claim disappears from every client within one sweep even if
// nobody claims/releases/reads anything in the meantime. unref() so this
// timer never keeps the process (or a test run importing this module) alive
// on its own.
const claimsSweepTimer = setInterval(function () {
   claims.prune();
   io.emit('reviewClaims', claims.all());
}, SWEEP_INTERVAL_MS);
if (typeof claimsSweepTimer.unref === 'function') {
   claimsSweepTimer.unref();
}

debug('Listening on port %s', config.port);
httpServer.listen(config.port);
