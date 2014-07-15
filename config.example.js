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
     numPulls:    100,        // Number of pull requests to retrieve
     numComments: 100         // Number of comments to retrieve, per pull
   },
   mysql: {
      host: 'mysql remote host URL',
      db:   'database name',
      user: 'username',
      pass: 'password'
   },
   body_tags: [
      {
         name: 'cr_req',
         regex: /\bcr_req ([0-9]+)\b/i,
         default: 2
      },
      {
         name: 'qa_req',
         regex: /\bqa_req ([0-9]+)\b/i,
         default: 1
      }
   ],
   tags: [
      'dev_block',
      'un_dev_block',
      'deploy_block',
      'un_deploy_block',
      'QA',
      'CR'
   ],
   pidFile: "/var/run/pulldasher.pid",
   debug: true
};
