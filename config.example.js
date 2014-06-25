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
     owner:       'repo owner',
     name:        'repo name',
     quantity:    100            // Number of pull requests to retrieve
   },
   mysql: {
      host: 'mysql remote host URL',
      db:   'database name',
      user: 'username',
      pass: 'password'
   },
   tags: [
      'dev_block',
      'un_dev_block',
      'deploy_block',
      'un_deploy_block',
      'QA',
      'CR'
   ],
   default_qa_req: 1,
   default_cr_req: 2,
   debug: true
};
