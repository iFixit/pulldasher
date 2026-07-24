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
import apiController from './controllers/api.js';
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
app.post('/hooks/main', hooksController.main);

// /api/v1: machine-to-machine JSON for the review skills, Bearer-authed with
// the caller's own GitHub token (see lib/api-auth). Independent of the
// cookie-session gate -- setupRoutes never registers these paths, so the
// session `auth` middleware doesn't run for them.
app.get('/api/v1/me', apiAuth, apiController.getMe);
app.get('/api/v1/pulls', apiAuth, apiController.getPulls);

// Warm the bot-login cache (used to tell a pulldasher claim apart from a
// GitHub-UI self-request) before any webhook or socket traffic needs it.
// Memoized in git-manager, so this just avoids the first caller paying for
// the lookup.
git.getBotLogin();

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
