var debug      = require('debug')('pulldasher:pull-manager'),
    pullQueue  = require('./pull-queue'),
    _          = require('underscore');

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
      return pull.data.repo === repo && Number(pull.data.number) === Number(number);
   });
}

pullQueue.on('pullsChanged', function(pulls) {
   pulls.forEach(function(pullId) {
      var pull = getPull(pullId.repo, pullId.number);
      if (pull !== null) {
         pullManager.updatePull(pull);
      }
   });
});
