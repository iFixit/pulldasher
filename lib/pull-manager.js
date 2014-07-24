var GithubApi = require('github'),
    config = require('../config'),
    Promise = require('promise'),
    pullQueue = require('./pull-queue'),
    dbManager = require('./db-manager'),
    _ = require('underscore');

var sockets = [];
var pulls = [];

   function sendInitialData(socket) {
      socket.emit('allPulls', _.invoke(pulls, 'toObject'));
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
      if (index !== -1) {
         sockets.splice(index, 1);
      }
   }

   function getPull(number) {
      return _.find(pulls, function(pull) {
         return pull.data.number === number;
      });
   }

   pullQueue.on('pullsChanged', function(pullNumbers) {
      dbManager.getPulls(pullNumbers).done(function(pulls) {
         pulls.forEach(function(pull) {
            if (pull !== null) {
               pullManager.updatePull(pull);
            }
         });
      });
   });

var pullManager = module.exports = {
   addSocket: function(socket) {
      sockets.push(socket);
      sendInitialData(socket);
      socket.on('disconnect', function() {
         removeSocket(socket);
      });
   },

   updatePull: function(updatedPull) {
      var pull = getPull(updatedPull.data.number);

      if (pull) {
         _.extend(pull, updatedPull);
      } else {
         pull = updatedPull;
         pulls.push(pull);
      } 

      notifyAboutPullStateChange(pull);
   }
};
