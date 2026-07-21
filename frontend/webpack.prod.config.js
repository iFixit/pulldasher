import dev from "./webpack.dev.config.js";
dev.mode = "production";
dev.devtool = "source-map";
export default dev;
