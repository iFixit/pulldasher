var GithubApi = require('github'),
    config = require('../config'),
    Promise = require('promise'),
    _ = require('underscore');

module.exports = function PullManager() {
   var sockets = [];
   var pulls = [];

   function sendInitialData(socket) {
      socket.emit('allPulls', _.invoke(pulls, 'toObject'));
      socket.emit('allPulls', pulls);
   }

   function notifyAboutPullStateChange(pull) {
      sockets.forEach(function(socket) {
         socket.emit('pullChange', pull.toObject());
      });
   }

   /**
    * Removes the given socket from the collection
    */
   function removeSocket(socket) {
      var index = sockets.indexOf(socket);
      if (index !== null) {
         sockets.splice(index);
      }
   }

   function getPull(id) {
      return _.find(pulls, function(pull) {
         return pull.id == id;
      });
   }

   var self = {
      addSocket: function(socket) {
         sockets.push(socket);
         sendInitialData(socket);
         socket.on('disconnect', function() {
            removeSocket(socket);
         });
      },

      addPull: function(pull) {
         pulls.push(pull);
         notifyAboutPullStateChange(pull);
      },

      updatePull: function(updatedPull) {
         var pull = getPull(pull.id);
         if (!pull) {
            self.addPull(pull);
            return;
         }

         _.extend(pull, updatedPull);
      }
   };
   return self;
};
