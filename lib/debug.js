import debug from "debug";

if (process.env.NO_TIMESTAMP) {
  debug.formatArgs = function (args) {
    args[0] = this.namespace + " " + args[0] + " +" + debug.humanize(this.diff);
  };
}

export default debug;
