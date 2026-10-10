import debug from './debug.js';
import pullQueue from './pull-queue.js';
import config from './config-loader.js';
import _ from 'underscore';
import dbManager from './db-manager.js';
import Pull from '../models/pull.js';
import { projectSettings } from './projects.js';
import { developerTeams } from './review-model.js';
import buildId from './build-id.js';

const pmDebug = debug('pulldasher:pull-manager');

const sockets = [];
let pulls = [];

const pullManager = {
   getOldestAllowedPullTimestamp: function () {
      // Keep the same or higher than the value in leader-list.tsx
      const includePullsClosedWithinDays = 14;
      return new Date(Date.now() - 86400 * 1000 * includePullsClosedWithinDays);
   },

   // The live board: every open (and recently-closed) pull, hydrated from the
   // DB on boot and kept fresh by webhooks -- the same set the socket ships.
   // The /api/v1 endpoint derives its classification from this, so it serves
   // exactly what the board shows without a second DB round-trip.
   getPulls: function () {
      return pulls;
   },

   addSocket: function (socket) {
      sockets.push(socket);
      sendInitialData(socket);
      socket.on('disconnect', function () {
         removeSocket(socket);
      });
   },

   updatePull: function (updatedPull) {
      var pull = getPull(updatedPull.data.repo, updatedPull.data.number);

      if (pull) {
         _.extend(pull, updatedPull);
      } else {
         pull = updatedPull;
         pulls.push(pull);
      }

      notifyAboutPullStateChange(pull);
   },

   /** Send `event` to every connected board. */
   broadcast: function (event, payload) {
      sockets.forEach(function (socket) {
         socket.emit(event, payload);
      });
   },
};

/**
 * Something the Projects tab shows changed (a roadmap write, an issue added
 * or removed, a setting, a sync of the issues and their links): open boards
 * fetch it again rather than drift until a reload.
 */
pullManager.projectsChanged = function () {
   sockets.forEach(function (socket) {
      socket.emit('projectsChanged');
   });
};

function sendInitialData(socket) {
   pmDebug('Emitting `initialize`: %s pulls altogether', pulls.length);
   socket.emit('initialize', {
      pulls: _.invoke(pulls, 'toObject'),
      repos: config.repos,
      // deployment config the server owns, delivered with the board instead of
      // a separate static config.json fetch (see shared/types InitializePayload)
      bots: config.bots || [],
      weightLabels: config.weightLabels || {},
      // the project label prefix, sent only when this install uses projects
      // (config.js `projects`); the board shows its Projects tab only then
      projectLabelPrefix: projectSettings()?.prefix,
      // who reviews their own pulls, and what a team request means (shared reviewPolicy)
      developerTeams: developerTeams(),
      // names the served frontend build, so an open tab can tell a deploy happened
      build: buildId,
   });
}

function notifyAboutPullStateChange(pull) {
   pmDebug(
      'Emitting `pullChange`: sending Pull #%s in repo %s to %s sockets',
      pull.data.number,
      pull.data.repo,
      sockets.length
   );
   sockets.forEach(function (socket) {
      socket.emit('pullChange', pull.toObject());
   });
}

/**
 * Removes the given socket from the collection
 */
function removeSocket(socket) {
   var index = sockets.indexOf(socket);
   if (index !== -1) {
      sockets.splice(index, 1);
   }
}

function getPull(repo, number) {
   return _.find(pulls, function (pull) {
      return pull.data.repo === repo && Number(pull.data.number) === Number(number);
   });
}

pullQueue.on('pullsChanged', function (pulls) {
   pulls.forEach(function (pullId) {
      pmDebug(
         'Got pull changed event, loading pull #%s in repo %s from DB.',
         pullId.number,
         pullId.repo
      );
      dbManager
         .getPull(pullId.repo, pullId.number)
         .then(function (pull) {
            if (pull !== null) {
               pullManager.updatePull(pull);
            }
         })
         .catch(function (err) {
            pmDebug(
               'Failed to load changed pull #%s in %s: %s',
               pullId.number,
               pullId.repo,
               (err && err.message) || err
            );
         });
   });
});

// Cull old closed pulls from memory every once in a while. unref() so this
// background timer never keeps the process alive on its own -- the running
// server stays up via its http/socket handles, and a short-lived importer
// (a test, a CLI that just needs the board model) can still exit cleanly.
//
// Also prunes models/pull.js's reviewRequestsByPull cache down to the same
// surviving set -- otherwise that cache keeps one outer entry per pull ever
// seen and grows unbounded across the process's lifetime.
setInterval(() => {
   const oldestAllowed = pullManager.getOldestAllowedPullTimestamp();
   pulls = pulls.filter(
      pull => pull.isOpen() || !pull.data.closed_at || pull.data.closed_at > oldestAllowed
   );
   const liveKeys = new Set(
      pulls.map(pull => Pull.reviewRequestsKey(pull.data.repo, pull.data.number))
   );
   Pull.pruneReviewRequests(liveKeys);
}, 3600 * 1000).unref();

export default pullManager;
