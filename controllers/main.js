import socketAuthenticator from "../lib/socket-auth.js";
import config from "../lib/config-loader.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const socketio = require("../package.json").dependencies["socket.io"];

function connectionDetails(req) {
  return {
    socketToken: socketAuthenticator.getTokenForUser(req.user),
    socketVersion: socketio,
    user: req.user.username,
    title: config.title,
    debugTools: config.debug,
  };
}

export default {
  getToken: function (req, res) {
    res.json(connectionDetails(req));
  },
};

