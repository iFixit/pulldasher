var socketAuthenticator = require('../lib/socket-auth');
var socketio = require('../package').dependencies['socket.io'];
var config = require('../lib/config-loader');

module.exports = {
   index: function(req, res) {
      res.render('current/index', connectionDetails(req));
   },
   getToken: function(req, res) {
      res.json(connectionDetails(req));
   }
};

function connectionDetails(req) {
   return {
      socketToken: socketAuthenticator.getTokenForUser(req.user),
      socketVersion: socketio,
      user: req.user.username,
      debugTools: config.debug,
   }
}
