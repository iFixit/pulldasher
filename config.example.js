var port = process.env.PORT || 3000;
module.exports = {
   // This is the port Pulldasher will run on. If you want to have multiple
   // instances of Pulldasher running on the same server, just assign them
   // different ports.
   port: port,

   // The use of the Github API in Pulldasher is slightly unconventional.
   // Rather than using a token for the currently-logged-in user to access the
   // API, we use one token belonging to the organization for everyone. This is
   // driven by Pulldasher's back-end/front-end separation. Because the backend
   // has to be able to access the API even when no one is logged into the front
   // end, it can't use the users' tokens. The user logins are used only for
   // determining permissions and the active user.
   //
   // To use Pulldasher, you'll need to set up the following on GitHub:
   // 1. A GitHub Application for your organization
   // 2. An API key that has access to the repo you're going to track
   // 3. A GitHub webhook on the repo you want to monitor
   github: {
      // Get this from the GitHub application setup page
      clientId:     "your github application client id",
      secret:       'your github appliction secret',
      // Where GitHub will send the user's browser after authentication
      callbackURL:  'http://localhost:' + port + '/auth/github/callback',
      // An API token for the backend to make API requests with
      token:        "oauth api token for server-side api calls",
      // This will need to be the same secret you use on the Webhooks page for
      // the repo Pulldasher is going to monitor.
      hook_secret:  "some random string to use (?secret=oxwm5gks) to 'secure' github hook handlers",
      // Limit access to specific users or teams
      requireOrg:   "Limit access to users belonging to this github organization",
      requireTeam:  "[Optional] Limit access to users belonging to this team name within the above github organization"
   },
   session: {
      secret: "secret for signing session cookies"
   },
   repo: {
      // The GitHub username of the person or organization owning the repo you
      // want to monitor
     owner:       'repo owner',
     // The name of the GitHub repo you want to monitor
     name:        'repo name'
   },
   // The usual MySQL stuff. Like every other MySQL webapp, basically.
   // You will need to source the `metrics.sql` file in the database to create
   // all the tables that Pulldasher expects.
   mysql: {
      host: 'mysql remote host URL',
      db:   'database name',
      user: 'username',
      pass: 'password'
   },
   // The tags Pulldasher uses to determine how many CR and QA are required for
   // a given pull. The names are currently non-negotiable as far as the
   // frontend is concerned, but the regex may be changed to your heart's
   // content.
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
   // Tags which indicate a comment is significant and should be parsed.
   // The regex may be customized to change the tag used in GitHub
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
   // Where to store the PID of the pulldasher process when run.
   pidFile: "/var/run/pulldasher.pid",
   // Setting this to true prints more debugging information.
   debug: true,
   // The time in ms before an unauthenticated websocket connection times out.
   unauthenticated_timeout: 10 * 1000,
   // The time in ms before an authentication token times out.
   token_timeout: 100 * 1000
};
