var socketAuthenticator = require('../lib/socket-auth');
var socketio = require('../package').dependencies['socket.io'];

module.exports = {
   index: function(req, res) {
      res.render('current/index', {
         socketToken: socketAuthenticator.getTokenForUser(req.user),
         socketVersion: socketio,
         user: req.user.username
      });
   }
};
