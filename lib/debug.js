var debug = require('debug');
module.exports = debug;

if (process.env.NO_TIMESTAMP) {
   debug.formatArgs = function(args) {
      args[0] = this.namespace + " " + args[0] +
       " +" + debug.humanize(this.diff);
   };
}
