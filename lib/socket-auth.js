import config from "./config-loader.js";

const users = {};
const token_timeout = config.token_timeout !== undefined ? config.token_timeout : 100 * 1000;

function random() {
  return Math.random().toString(36).substr(2);
}

export default {
  getTokenForUser: function (user) {
    const token = random();
    users[token] = {
      expires: Date.now() + token_timeout,
      user: user
    };
    return token;
  },

  retrieveUser: function (token) {
    const user = users[token];
    delete users[token];
    return user && user.expires > Date.now() && user.user;
  }
};
