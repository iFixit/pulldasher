var port = process.env.PORT || 3000;
module.exports = {
   port: port,
   github: {
      clientId:     "your github application client id",
      secret:       'your github appliction secret',
      callbackURL:  'http://localhost:' + port + '/auth/github/callback'
      token:        'your oauth access token',
      hook_secret:  'your hook secret'
   },
   session: {
      secret: "secret for signing session cookies"
   },
   repo: {
     owner: 'repo owner',
     name:  'repo name'
   },
   debug: true
};
