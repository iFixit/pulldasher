var port = process.env.PORT || 3000;
module.exports = {
   port: port,
   github: {
      clientId:     "your github application client id",
      secret:       "your github appliction secret",
      callbackURL:  "http://localhost:" + port + "/auth/github/callback"
   },
   session: {
      secret: "secret for signing session cookies"
   }
};
