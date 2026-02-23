var port = process.env.PORT || 3000;

// Support text emojis and all unicode emojis / symbols (as of Dec 2018)
// See: https://www.regextester.com/106421
var emoji =
  "(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])";
var emojiText = ":[^\n:]+:";
var signature = "(" + emojiText + "|" + emoji + ")";

module.exports = {
  // This is the title of the window & navbar heading
  title: "Pulldasher",

  // This is the port Pulldasher will run on. If you want to have multiple
  // instances of Pulldasher running on the same server, just assign them
  // different ports.
  port: port,

  // Pulldasher's backend needs to access the GitHub API independently of any
  // logged-in user. The user logins (via OAuth, below) are used only for
  // determining permissions and the active user.
  //
  // To use Pulldasher, you'll need to set up the following on GitHub:
  //
  // 1. A GitHub OAuth Application for user login (see Settings > Developer
  //    settings > OAuth Apps on GitHub)
  //   - The homepage URL will be the URL at which Pulldasher is available
  //   - The authorization callback URL will be the callbackURL below
  //
  // 2. A GitHub App for backend API access (RECOMMENDED, replaces classic PATs)
  //    Go to Settings > Developer settings > GitHub Apps > New GitHub App
  //    Required permissions:
  //      - Contents: Read
  //      - Issues: Read & Write
  //      - Pull Requests: Read & Write
  //      - Commit statuses: Read
  //      - Actions: Read
  //      - Members: Read (needed if requireOrg/requireTeam is set)
  //    Subscribe to events: Issues, Pull requests, Issue comments,
  //      Pull request reviews, Pull request review comments, Check runs, Status
  //    After creating the app:
  //      - Note the App ID (shown on the app's settings page)
  //      - Generate and download a private key (.pem file)
  //      - Install the app on your organization/repositories
  //      - Note the Installation ID (visible in the URL when viewing the
  //        installation: github.com/organizations/ORG/settings/installations/ID)
  //
  // 3. A GitHub webhook on the repo you want to monitor (Settings (on the
  //    repo) > Webhooks > Add webhook)
  //    NOTE: If you configured webhook events on the GitHub App above, the app
  //    can deliver webhooks automatically and you may not need a separate hook.
  //   - The Payload URL should be the externally-visible URL of the Pulldasher
  //     instance with '/hooks/main' appended and a GET param named `secret`
  //     containing the secret from `hook_secret` below.
  //   - Content type should be `application/x-www-form-urlencoded`
  //   - Choose to be sent individual events, and then check the Issue comments,
  //     Issues, Pull requests, Pull request review comments, Pushes, and
  //     Statuses boxes
  github: {
    // --- OAuth App credentials (for user login) ---
    // Get these from the GitHub OAuth Application setup page.
    clientId: "your github application client id",
    secret: "your github application secret",
    // Where GitHub will send the user's browser after authentication.
    callbackURL: "http://localhost:" + port + "/auth/github/callback",

    // --- GitHub App auth (RECOMMENDED for backend API calls) ---
    // These replace the classic PAT ('token' below). When appId is set,
    // Pulldasher uses auto-rotating GitHub App installation tokens.
    appId: "your GitHub App ID (numeric, from the app settings page)",
    // The private key can be provided as:
    //   1. The PEM string directly (with literal \n for newlines)
    //   2. An absolute file path to the .pem file (e.g. "/path/to/private-key.pem")
    //   3. Via the GITHUB_APP_PRIVATE_KEY environment variable
    privateKey: "/path/to/your-github-app-private-key.pem",
    installationId:
      "your GitHub App installation ID (numeric, from the installation URL)",

    // --- Classic PAT auth (DEPRECATED, use GitHub App above instead) ---
    // If appId is not set, Pulldasher falls back to this token.
    // token: "classic personal access token for server-side api calls",

    // This will need to be the same secret you use on the Webhooks page for
    // the repo Pulldasher is going to monitor.
    hook_secret:
      "some random string to use (?secret=oxwm5gks) to 'secure' github hook handlers",
    // Limit access to specific users or teams.
    requireOrg: "Limit access to users belonging to this github organization",
    requireTeam:
      "[Optional] Limit access to users belonging to this team name within the above github organization, uses the slug version of the team name, i.e. 'some-team' from @SomeOrg/some-team",
  },
  session: {
    secret: "secret for signing session cookies",
  },

  // List of repositories for pulldasher to watch.
  repos: [
    // Just listing the repo as a string indicates pulldasher should consider
    // CI passing if all the statuses that exist are passing and that there
    // is at least one.
    "owner/repo",
    // Listing them like this allows being more explicit with the commit
    // statuses
    {
      name: "owner/otherRepo",
      requiredStatuses: ["tests", "build", "codeClimate"],
      ignoredStatuses: ["coverage"],
      // Hides pulls on this repo on page load, users can unhide them with the repo filter
      hideByDefault: true,
    },
  ],

  // The usual MySQL stuff. Like every other MySQL webapp, basically.
  // You will need to source the `schema.sql` file in the database to create
  // all the tables that Pulldasher expects.
  mysql: {
    host: "mysql remote host URL",
    db: "database name",
    user: "username",
    pass: "password",
  },
  // The tags Pulldasher uses to determine how many CR and QA are required for
  // a given pull. The names are currently non-negotiable as far as the
  // frontend is concerned, but the regex may be changed to your heart's
  // content.
  body_tags: [
    {
      name: "cr_req",
      regex: /\bcr_req ([0-9]+)\b/i,
      default: 2,
    },
    {
      name: "qa_req",
      regex: /\bqa_req ([0-9]+)\b/i,
      default: 1,
    },
    {
      name: "closes",
      regex: /\b(?:close(?:s|d)?|fix(?:es|ed)?|resolve(?:s|d)?) #([0-9]+)\b/i,
      default: null,
    },
    {
      name: "connects",
      regex: /\b(?:connect(?:s|ed)? to|connects) #([0-9]+)\b/i,
      default: null,
    },
  ],
  // Tags which indicate a comment is significant and should be parsed.
  // The regex may be customized to change the tag used in GitHub.
  tags: [
    {
      name: "dev_block",
      // This regex supports thins like :smile: as well as the actual
      // unicode representation of emoticons. Mainly added because github
      // started making their autocompletor inject actual unicode emojis
      // in the text.
      regex: new RegExp("\\bdev_block " + signature, "i"),
    },
    {
      name: "un_dev_block",
      regex: new RegExp("\\bun_dev_block " + signature, "i"),
    },
    {
      name: "deploy_block",
      regex: new RegExp("\\bdeploy_block " + signature, "i"),
    },
    {
      name: "un_deploy_block",
      regex: new RegExp("\\bun_deploy_block " + signature, "i"),
    },
    {
      name: "QA",
      regex: new RegExp("\\bQA " + signature, "i"),
    },
    {
      name: "CR",
      regex: new RegExp("\\bCR " + signature, "i"),
    },
  ],

  /**
   * This is a list of objects describing labels on issues which should be
   * converted to properties on the issue. Note that if more than one label
   * matches the regex, only one will appear in the property.
   */
  labels: [
    {
      name: "difficulty",
      regex: /^size: [0-9]+$/,
      // Take in a string (or null, when a label is deleted), returns the
      // new value to be stored: issue[name] = process(label)
      process: function (label) {
        var match = label ? label.match(/[0-9]+/) : null;
        return match ? parseInt(match[0], 10) : null;
      },
    },
  ],

  // Where to store the PID of the pulldasher process when run.
  pidFile: "/var/run/pulldasher.pid",
  // Setting this to true prints more debugging information.
  debug: true,
  // The time in ms before an unauthenticated websocket connection times out.
  unauthenticated_timeout: 10 * 1000,
  // The time in ms before an authentication token times out.
  token_timeout: 100 * 1000,
};
