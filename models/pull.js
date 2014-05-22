var util = require('util');
var events = require('events');
var _ = require('underscore');
var Signature = require('./signature')

function Pull(data, comments, headCommit) {
   this.data = data || {};
   this.signatures = Signature.createFromGithubComments(comments, data.number);
   this.headCommit = headCommit;
}
module.exports = Pull;
util.inherits(Pull, events.EventEmitter);

Pull.prototype.setData = function (data) {
   this.data = data;
   this.emit('dataChanged');
}

Pull.prototype.toObject = function () {
   var data = this.data;
   var obj = _.extend({}, data);
   return obj;
}

