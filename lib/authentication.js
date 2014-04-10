var config = require('../config'),
    github = require('./git-manager').github,
    Promise = require('promise'),
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
      callbackURL: config.callbackURL,
      scope: [ 'repo' ]
   },
   function(accessToken, refreshToken, profile, done) {
      console.log(accessToken);
      return done(null, profile);
   })
);

module.exports = {
   passport: passport,
   setupRoutes: function(app) {
      app.get('/auth/github', passport.authenticate('github'));
      app.get('/auth/github/callback', function(req, res, next) {
         passport.authenticate('github',
         function(err, user, info) {
            console.log("Authenticated with github: " + user.username);
            var getOrgMember = Promise.denodeify(github.orgs.getMember);
            getOrgMember({org: config.github.requireOrg, user: user.username })
            .then(function(authResponse) {
               console.log("Authenticated with org: " + user.username);
               req.logIn(user, function(err) {
                  console.log('got login');
                  res.redirect("/");
               });
            }, function(err) {
               console.error("Error: " + err);
               next(err)
            })
         })(req,res,next);
      });

      // Ensure ALL other routes are authenticated
      app.all('/*', function (req, res, next) {
         if (req.isAuthenticated()) { return next(); }
         res.redirect('/auth/github');
      });
   }
};

