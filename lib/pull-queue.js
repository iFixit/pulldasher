import events from "events";
import _ from "underscore";
import { inherits } from "util";

function PullQueue() {
  events.EventEmitter.call(this);
  this.dirtyPulls = {};
}

inherits(PullQueue, events.EventEmitter);

_.extend(PullQueue.prototype, {
  /**
   * Adds the pull number to the queue if it is paused; otherwise, updates
   * the view.
   */
  markPullAsDirty: function (repo, number) {
    var pullId = { repo: repo, number: number };
    if (this.queuePaused) {
      this.dirtyPulls[repo + "#" + number] = pullId;
    } else {
      this.emit("pullsChanged", [pullId]);
    }
  },

  /**
   * Pause all event emitting and combine many pullChanged events into one.
   */
  pause: function () {
    this.queuePaused = true;
  },

  /**
   * Resumes event broadcasting and emits collected events.
   */
  resume: function () {
    this.emit("pullsChanged", _.values(this.dirtyPulls));
    this.dirtyPulls = {};
    this.queuePaused = false;
  },
});

export default new PullQueue();
