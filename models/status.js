var util = require('util'),
    events = require('events'),
    _ = require('underscore');

function Status(data) {
   this.data = {
      sha: data.sha,
      target_url: data.target_url,
      description: data.description,
      state: data.state
   };
}

Status.prototype.setData = function (data) {
   this.data = data;
   this.emit('dataChanged');
}

Status.prototype.toObject = function () {
   return _.extend({}, this.data);
}

util.inherits(Status, events.EventEmitter);
module.exports = Status;
