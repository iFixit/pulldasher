const webpack = require("webpack");
const fs = require("fs");

/**
 * Returns an object to be used as a value in the config of
 * webpack.DefinePlugin. It reads a local file and returns the contents.
 * It also triggers a webpack rebuild if that file changes.
 */
module.exports = function (dummyPullsPath) {
  return webpack.DefinePlugin.runtimeValue(() => {
    return fs.readFileSync(dummyPullsPath, { encoding: "utf8" });
  }, [dummyPullsPath]);
};
