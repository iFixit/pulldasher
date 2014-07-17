var config = require('../config'),
    github = require('./git-manager').github,
    Promise = require('promise'),
    passport = require('passport'),
    _ = require('underscore'),
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
      // Since we only need to get the username to verify they are a member of
      // a team we don't need anything other than public info.
      scope: null
   },
   function(accessToken, refreshToken, profile, done) {
      console.log("Authenticated user: " + profile.username);
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
            confirmOrgMembership(user)
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

      // Ensure index is authenticated.
      app.get('/', function (req, res, next) {
         if (req.isAuthenticated()) { return next(); }
         res.redirect('/auth/github');
      });
   }
};


var checkOrgMembershipRequirements;

if (config.github.requireTeam) {
   // All this logic is needed to get the team id from a team name
   var getTeams = Promise.denodeify(github.orgs.getTeams);
   var checkTeamMembership = Promise.denodeify(github.orgs.getTeamMember);

   var getTeamId = getTeams({org: config.github.requireOrg})
   .then(function(teams) {
      var team = _.findWhere(teams, {name: config.github.requireTeam});
      if (!team) {
         console.error("Team " + (config.github.requireTeam) +
          " Not found in Organization: " + config.github.requireOrg);
         process.exit(1);
      }
      return team.id;
   });

   checkOrgMembershipRequirements = function(options) {
      return getTeamId.then(function(teamId) {
         options.id = teamId;
         return checkTeamMembership(options);
      });
   }
} else {
   checkOrgMembershipRequirements = 
    Promise.denodeify(github.orgs.getMember)
}

function confirmOrgMembership(user) {
   return checkOrgMembershipRequirements({
      org: config.github.requireOrg,
      user: user.username
   });
}
