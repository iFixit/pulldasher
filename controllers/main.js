var socketAuthenticator = require('../lib/socket-auth');

module.exports = {
   index: function(req, res) {
      res.render('home/index', {
         socketToken: socketAuthenticator.getTokenForUser(req.user)
      });
   }
}
