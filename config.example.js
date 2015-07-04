var port = process.env.PORT || 3000;
module.exports = {
   port: port,
   github: {
      clientId:     "your github application client id",
      secret:       'your github appliction secret',
      callbackURL:  'http://localhost:' + port + '/auth/github/callback',
      token:        "oauth api token for server-side api calls",
      hook_secret:  "some random string to use (?secret=oxwm5gks) to 'secure' github hook handlers",
      requireOrg:   "Limit access to users belonging to this github organization",
      requireTeam:  "[Optional] Limit access to users belonging to this team name within the above github organization"
   },
   session: {
      secret: "secret for signing session cookies"
   },
   repo: {
     owner:       'repo owner',
     name:        'repo name'
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
      {
         name: 'dev_block',
         regex: /\bdev_block :[^\n:]+:/i
      },
      {
         name: 'un_dev_block',
         regex: /\bun_dev_block :[^\n:]+:/i
      },
      {
         name: 'deploy_block',
         regex: /\bdeploy_block :[^\n:]+:/i
      },
      {
         name: 'un_deploy_block',
         regex: /\bun_deploy_block :[^\n:]+:/i
      },
      {
         name: 'QA',
         regex: /\bQA :[^\n:]+:/i
      },
      {
         name: 'CR',
         regex: /\bCR :[^\n:]+:/i
      }
   ],
   pidFile: "/var/run/pulldasher.pid",
   debug: true,
   // The time in ms before an unauthenticated websocket connection times out.
   unauthenticated_timeout: 10 * 1000,
   // The time in ms before an authentication token times out.
   token_timeout: 100 * 1000
};
