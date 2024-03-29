var config = require("./config-loader");
var users = {};

var token_timeout =
  config.token_timeout !== undefined ? config.token_timeout : 100 * 1000;

module.exports = {
  getTokenForUser: function (user) {
    var token = random();
    users[token] = {
      expires: Date.now() + token_timeout,
      user: user,
    };
    return token;
  },

  retrieveUser: function (token) {
    var user = users[token];
    delete users[token];
    return user && user.expires > Date.now() && user.user;
  },
};

// Returns a random string
function random() {
  return Math.random().toString(36).substr(2);
}
