var socketAuthenticator = require("../lib/socket-auth");
var socketio = require("../package").dependencies["socket.io"];
var config = require("../lib/config-loader");

module.exports = {
  getToken: function (req, res) {
    res.json(connectionDetails(req));
  },
};

function connectionDetails(req) {
  return {
    socketToken: socketAuthenticator.getTokenForUser(req.user),
    socketVersion: socketio,
    user: req.user.username,
    title: config.title,
    debugTools: config.debug,
  };
}
