var debug      = require('debug')('pulldasher:pull-manager'),
    pullQueue  = require('./pull-queue'),
    _          = require('underscore'),
    dbManager  = require('./db-manager');

var sockets = [];
var pulls = [];

var pullManager = module.exports = {
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
         if (!pull.isOpen()) {
            pulls = _.without(pulls, pull);
         }
      } else {
         pull = updatedPull;
         if (pull.isOpen()) {
            pulls.push(pull);
         }
      }

      notifyAboutPullStateChange(pull);
   }
};

function sendInitialData(socket) {
   debug('Emitting `allPulls`: %s pulls altogether', pulls.length);
   socket.emit('allPulls', _.invoke(pulls, 'toObject'));
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
