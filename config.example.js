var port = process.env.PORT || 3000;
module.exports = {
   port: port,
   github: {
      clientId:     "your github application client id",
      secret:       "your github appliction secret",
      callbackURL:  "http://localhost:" + port + "/auth/github/callback",
      hook_secret:  "some random string to use (?secret=oxwm5gks) to 'secure' github hook handlers"
   },
   session: {
      secret: "secret for signing session cookies"
   }
};
