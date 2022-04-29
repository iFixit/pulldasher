var debug      = require('./debug')('pulldasher:pull-manager'),
    pullQueue  = require('./pull-queue'),
    config     = require('./config-loader'),
    _          = require('underscore'),
    dbManager  = require('./db-manager');

var sockets = [];
var pulls = [];

var pullManager = module.exports = {
   getOldestAllowedPullTimestamp: function() {
      // Keep the same or higher than the value in leader-list.tsx
      const includePullsClosedWithinDays = 14;
      return new Date(Date.now() - 86400 * 1000 * includePullsClosedWithinDays);
   },

   addSocket: function(socket) {
      sockets.push(socket);
      sendInitialData(socket);
      socket.on('disconnect', function() {
         removeSocket(socket);
      });
   },

   updatePull: function(updatedPull) {
      var pull = getPull(updatedPull.data.repo, updatedPull.data.number);

      if (pull) {
         _.extend(pull, updatedPull);
      } else {
         pull = updatedPull;
         pulls.push(pull);
      }

      notifyAboutPullStateChange(pull);
   }
};

function sendInitialData(socket) {
   debug('Emitting `initialize`: %s pulls altogether', pulls.length);
   socket.emit('initialize', {
      pulls: _.invoke(pulls, 'toObject'),
      repos: config.repos,
   });
}

function notifyAboutPullStateChange(pull) {
   debug('Emitting `pullChange`: sending Pull #%s in repo %s to %s sockets',
   pull.data.number, pull.data.repo, sockets.length);
   sockets.forEach(function(socket) {
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
   return _.find(pulls, function(pull) {
      return pull.data.repo === repo && Number(pull.data.number) === Number(number);
   });
}

pullQueue.on('pullsChanged', function(pulls) {
   pulls.forEach(function(pullId) {
      debug('Got pull changed event, loading pull #%s in repo %s from DB.', pullId.number, pullId.repo);
      dbManager.getPull(pullId.repo, pullId.number).then(function(pull) {
         if (pull !== null) {
            pullManager.updatePull(pull);
         }
      });
   });
});

// Cull old closed pulls from memory every once in a while
setTimeout(() => {
   const oldestAllowed = pullManager.getOldestAllowedPullTimestamp();
   pulls = pulls.filter((pull) =>
      pull.isOpen() ||
      !pull.data.closed_at ||
      pull.data.closed_at > oldestAllowed
   );
}, 3600 * 1000);
