var config = require('../config');
var users = {};

module.exports = {
   getTokenForUser: function(user) {
      var token = random();
      users[token] = {
         expires: Date.now() + config.token_timeout,
         user: user
      }
      return token;
   },

   retrieveUser: function(token) {
      var user = users[token];
      delete users[token];
      return user && user.user;
   }
};

// Returns a random string
function random() {
   return Math.random().toString(36).substr(2);
};
