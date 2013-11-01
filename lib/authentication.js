var config = require('../config'),
    passport = require('passport'),
    GitHubStrategy = require('passport-github').Strategy;

passport.serializeUser(function(user,done) {
   done(null, user);
});

passport.deserializeUser(function(obj ,done) {
   done(null, obj);
});

passport.use(new GitHubStrategy({
      clientID: config.github.clientId,
      clientSecret: config.github.secret,
      callbackURL: "http://localhost:" + config.port + "/auth/github/callback"
   },
   function(accessToken, refreshToken, profile, done) {
      return done(null, profile);
   })
);

module.exports = passport;

