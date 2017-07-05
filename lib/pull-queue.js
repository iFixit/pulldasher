var events      = require('events'),
    _           = require('underscore');

function PullQueue() {
   events.EventEmitter.call(this);
   this.dirtyPulls = {};
}

require('util').inherits(PullQueue, events.EventEmitter);

_.extend(PullQueue.prototype, {
   /**
    * Adds the pull number to the queue if it is paused; otherwise, updates
    * the view.
    */
   markPullAsDirty: function(repo, number) {
      if (this.queuePaused) {
         this.dirtyPulls[repo + "#" + number] = true;
      } else {
         this.emit('pullsChanged', [repo, number]);
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
      var dirty = this.dirtyPulls;
      var keys = _.keys(dirty);
      this.emit('pullsChanged',  keys.map(function(repoAndNumber) {
         return repoAndNumber.split("#");
      }));
      this.dirtyPulls = {};
      this.queuePaused = false;
   }
});

module.exports = new PullQueue();

