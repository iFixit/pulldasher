var socketAuthenticator = require('../lib/socket-auth');
var socketio = require('../package').dependencies['socket.io'];
var config = require('../config');

module.exports = {
   index: function(req, res) {
      res.render('current/index', {
         socketToken: socketAuthenticator.getTokenForUser(req.user),
         socketVersion: socketio,
         user: req.user.username,
         debugTools: config.debug,
      });
   }
};
