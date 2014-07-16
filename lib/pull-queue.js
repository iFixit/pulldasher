var events      = require('events'),
    _           = require('underscore'),
    Promise     = require('promise');

function PullQueue() {
   events.EventEmitter.call(this);
   this.dirtyPulls = {};
};

require('util').inherits(PullQueue, events.EventEmitter);

_.extend(PullQueue.prototype, {
   /**
    * Adds the pull number to the queue if it is paused; otherwise, updates
    * the view.
    */
   markPullAsDirty: function(number) {
      if (this.queuePaused) {
         this.dirtyPulls[number] = true;
      } else {
         this.emit('pullsChanged', [number]);
      }
   },

   /**
    * Pause all event emitting and combine many pullChanged events into one.
    */
   pause: function() {
      this.queuePaused = true;
   },

   /**
    * Resumes event broadcasting and emits collected events.
    */
   resume: function() {
      this.emit('pullsChanged',  _.keys(this.dirtyPulls));
      this.dirtyPulls = {};
      this.queuePaused = false;
   }
});

module.exports = new PullQueue();

