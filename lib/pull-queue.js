var events      = require('events'),
    Promise     = require('promise'),
    pullManager = require('./pull-manager');

var eventEmitter = new events.EventEmitter();

// A pull is marked as "dirty" when info about it in the DB has been updated.
eventEmitter.on('dirty', function(number) {
   add(number);
});

var queue = {};
var queuePaused = false;

/**
 * Adds the pull number to the queue if it is paused; otherwise, updates
 * the view.
 */
function add(number) {
   if (queuePaused) {
      queue[number] = 'dirty';
   } else {
      update(number);
   }
}

/**
 * Updates the view with the new info about a pull.
 */
function update(number) {
   return new Promise(function(resolve, reject) {
      dbManager.getPull(number).done(function(pull) {
         pullManager.updatePull(pull);
         resolve();
      });
   });
}

/**
 * Updates all the pulls that have changed while the queue was paused.
 */
function flush() {
   return new Promise(function(resolve, reject) {
      var updates = [];

      for (var number in queue) {
         updates.push(update(number));
         delete queue[number];
      }

      Promise.all(updates).done(function() {
         resolve();
      });
   });
}

module.exports = {
   ee: eventEmitter,

   pause: function() {
      queuePaused = true;
   },

   resume: function() {
      flush().done(function() {
         queuePaused = false;
      });
   }
};

// This is defined here to avoid a dependency loop.
var dbManager = require('./db-manager');
