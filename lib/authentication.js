import config from "./config-loader.js";
import debug from "./debug.js";
import gitManager from "./git-manager.js";
import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";

const authDebug = debug("pulldasher:authentication");

const FAKE_USER = process.env.MOCK_AUTH_AS_USER;

passport.serializeUser(function (user, done) {
  done(null, user);
});

passport.deserializeUser(function (obj, done) {
  done(null, obj);
});

if (!FAKE_USER) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: config.github.clientId,
        clientSecret: config.github.secret,
        callbackURL: config.callbackURL,
        // Since we only need to get the username to verify they are a member of
        // a team we don't need anything other than public info.
        scope: null,
      },
      function (accessToken, refreshToken, profile, done) {
        authDebug("Authenticating user: " + profile.username);
        return done(null, profile);
      }
    )
  );
} else {
  authDebug("Using dummy authentication, pretending to be: " + FAKE_USER);
}

let checkOrgMembershipRequirements;

if (config.github.requireTeam) {
  checkOrgMembershipRequirements = function (options) {
    options.team_slug = config.github.requireTeam;
    return gitManager.github.teams.getMembershipForUserInOrg(options);
  };
} else {
  checkOrgMembershipRequirements = gitManager.github.orgs.checkMembershipForUser;
}

function confirmOrgMembership(user) {
  return checkOrgMembershipRequirements({
    org: config.github.requireOrg,
    username: user.username,
  });
}

export default {
  passport,
  setupRoutes: function (app) {
    app.get("/auth/github", passport.authenticate("github"));
    app.get("/auth/github/callback", function (req, res, next) {
      passport.authenticate("github", function (err, user) {
        if (err) {
          authDebug("Error: " + err);
          return next(err);
        }

        if (user === undefined) {
          authDebug("Bad user");
          return next("Bad user");
        }

        authDebug("Authenticated with github: " + user.username);
        let afterMembershipValidation;

        // If the config requires org membership, check that the
        // user belongs to that org. Otherwise just log in.
        if (config.github.requireOrg) {
          afterMembershipValidation = confirmOrgMembership(user).then(() =>
            authDebug("Authenticated with org: " + user.username)
          );
        } else {
          afterMembershipValidation = Promise.resolve();
        }

        afterMembershipValidation
          .then(() => {
            req.logIn(user, function () {
              authDebug("Got login from " + user.username);

              // Redirect user to original URL. Fallback to '/' if DNE.
              const redirectUrl = req.session.auth_redirect;
              delete req.session.auth_redirect;

              res.redirect(redirectUrl || "/");
            });
          })
          .catch((err) => {
            next(err);
          });
      })(req, res, next);
    });

    // Ensure index is authenticated.
    const auth = function (req, res, next) {
      if (req.isAuthenticated()) {
        return next();
      }
      if (FAKE_USER) {
        req.user = { username: FAKE_USER };
        return next();
      }

      // Store original URL for post-auth redirect
      req.session.auth_redirect = req.originalUrl;
      res.redirect("/auth/github");
    };
    app.get("/", auth);
    app.get("/token", auth);
  },
};
