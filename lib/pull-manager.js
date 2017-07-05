var debug      = require('debug')('pulldasher:pull-manager'),
    pullQueue  = require('./pull-queue'),
    dbManager  = require('./db-manager'),
    _          = require('underscore'),
    utils      = require('./utils');

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
   debug('Emitting `pullChange`: sending Pull #%s to %s sockets',
   pull.data.number, sockets.length);
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
      return pull.data.repo == repo && pull.data.number == number;
   });
}

pullQueue.on('pullsChanged', function(pulls) {
   pulls.forEach(function(repoAndNumber) {
      var repo = repoAndNumber[0];
      var number = repoAndNumber[1];

      pull = getPull(repo, number);
      if (!pull) {
         pullManager.updatePull(pull);
      }
   });
});
