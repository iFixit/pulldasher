var port = process.env.PORT || 3000;
module.exports = {
   port: port,
   github: {
      clientId:     "your github application client id",
      secret:       'your github appliction secret',
      callbackURL:  'http://localhost:' + port + '/auth/github/callback',
      token:        "oauth api token for server-side api calls",
      hook_secret:  "some random string to use (?secret=oxwm5gks) to 'secure' github hook handlers",
      requireOrg:   "Limit access to users belonging to this github organization"
   },
   session: {
      secret: "secret for signing session cookies"
   },
   repo: {
     owner: 'repo owner',
     name:  'repo name'
   },
   mysql: {
      host: 'mysql remote host URL',
      db: 'database name',
      user: 'username',
      pass: 'password'
   },
   debug: true
};
