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
      callbackURL: config.callbackURL
   },
   function(accessToken, refreshToken, profile, done) {
      return done(null, profile);
   })
);

module.exports = {
   passport: passport,
   setupRoutes: function(app) {
      app.get('/auth/github', passport.authenticate('github', { scope: 'repo' }));
      app.get('/auth/github/callback',
         passport.authenticate('github', {
            failureRedirect: '/auth',
            successRedirect: '/'
         })
      );

      // Ensure ALL other routes are authenticated
      app.all('/*', function (req, res, next) {
         if (req.isAuthenticated()) { return next(); }
         res.redirect('/auth/github');
      });
   }
};

