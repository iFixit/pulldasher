var util = require('util');

module.exports = function Pull(data) {
   this.data = data || {};
}

Pull.prototype.setData = function (data) {
   this.data = data;
   this.emit('dataChanged');
}

Pull.prototype.toObject = function () {
   var data = this.data;
   var obj = _.extend({}, data);
   return obj;
}

util.inherits(Pull, EventEmitter);
