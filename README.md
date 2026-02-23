# Pulldasher

[![Build](https://github.com/iFixit/pulldasher/actions/workflows/build.yml/badge.svg)](https://github.com/iFixit/pulldasher/actions/workflows/build.yml)

Pulldasher is self-hosted to-do list for GitHub repositories.
Pulldasher tracks your pull requests and displays them according to their
current state. It sports a flexible template system, allowing you to customize
it extensively without touching the core code.

![pulldasher-image](https://cloud.githubusercontent.com/assets/2539016/11315808/78af398e-8fad-11e5-81d4-b59ae6109dec.png)

Pulldasher is written primarily in JavaScript, using Node.js. See the
[`package.json`](package.json/) for more on the front and back-end
dependencies, respectively.

To run Pulldasher, you'll need MySQL as well as Node. MySQL is used for
statistics-gathering and some sorting and filtering.

## Getting Started

### 1. Create a GitHub App

Go to **Settings > Developer settings > GitHub Apps > New GitHub App** on GitHub.

- **Homepage URL**: The URL where Pulldasher will be accessible
- **Webhook URL**: `https://your-pulldasher-url/hooks/main`
- **Webhook secret**: A random string (Pulldasher verifies webhook signatures using HMAC-SHA256)

**Repository permissions** (all Read-only):
- Actions, Checks, Commit statuses, Contents, Issues, Metadata, Pull requests

**Subscribe to events**: Check run, Issue comment, Issues, Pull request, Pull request review, Pull request review comment, Status

After creating the app:
1. Note the **App ID** from the settings page
2. **Generate a private key** — download the `.pem` file
3. **Install the app** on the repositories you want to monitor
4. Note the **Installation ID** from the installation URL

### 2. Create a GitHub OAuth App

Go to **Settings > Developer settings > OAuth Apps > New OAuth App**.

- **Homepage URL**: Your Pulldasher URL
- **Authorization callback URL**: `https://your-pulldasher-url/auth/github/callback`

Note the **Client ID** and generate a **Client Secret**.

### 3. Configure and Run

```bash
git clone https://github.com/iFixit/pulldasher
cd pulldasher
cp config.example.js config.js
```

Edit `config.js` with your credentials (see `config.example.js` for detailed documentation):
- `github.clientId` / `github.secret` — OAuth App credentials
- `github.appId` / `github.privateKey` / `github.installationId` — GitHub App credentials
- `github.hook_secret` — the webhook secret from step 1
- `mysql.*` — your MySQL connection details
- `repos` — list of `"owner/repo"` strings to monitor

#### With Docker Compose

```bash
docker compose up -d    # Starts MySQL and Pulldasher
./bin/migrate           # Initialize the database (first run only)
```

#### Without Docker (local Node + Docker MySQL)

```bash
docker compose up -d db   # Start just MySQL
npm install               # Install dependencies and build frontend
./bin/migrate             # Initialize the database (first run only)
npm start                 # Start the server
```

## Use

Pulldasher is driven by tags in pull requests and pull comments. Normally, it
assumes that two code review and one quality assurance signoff will be
required per pull. This can be adjusted on a per-pull basis by using the
`cr_req` and `qa_req` tags in a pull description. For example, if you write a
pull that touches some really dangerous code, you might add the `cr_req 3` and
`qa_req 2` tags to it, requiring three CR signoffs and two QA signoffs before
the pull is considered ready. Conversely, if a pull only touches test code, you
might put only `qa_req 0` on it to say that it doesn't need to be QAed, since
it should break tests if there's anything wrong with it.

When you CR a pull, add a comment to it with `CR :emoji:` in it.
(`emoji` is simply a word or words between colons; we often use GitHub emoji,
which follow this format.) This comment is considered a _signoff_. Pulldasher
will update the pull's display to indicate that one of the required CRs is
completed. Similarly, when you QA a pull, add a comment containing
`QA :emoji:`, and the number of QA signoffs will increase.

## Feature Details

### CR Leaders/QA Leaders

The lists of CR Leaders and QA Leaders at the top of Pulldasher are displays of
the number of signoffs by each person in each category which are currently visible
on Pulldasher. They do not take into account merged or closed pulls. They can be
fun to see who’s been doing a lot of CR recently, and they can be helpful in
balancing the number of CRs you’re doing versus everyone else.

### Dark Mode

Pulldasher supports a dark mode! See the button in the nav bar

### Filter Parameters

Two query string parameters are available to filter the displayed pulls:

1. `assigned`: Providing a comma-separated list of usernames to the `assigned`
   parameter will filter the pulls to only those assigned to those users.

   `ex. https://pulldasher.example.com?assigned=copperwall,scotttherobot,davidrans`

2. `milestone`: Providing a comma-separated list of milestones to the
   `milestone` parameter will filter the pulls to only those on the specified
   milestones.

   `ex. https://pulldasher.example.com?milestone=site-redesign,12/5,12/19`

## Architecture

Pulldasher uses a **GitHub App** for backend API access with auto-rotating
installation tokens. User login is handled separately via a **GitHub OAuth App**.

On startup, the server fetches all open pulls from the configured repos via the
GitHub API. It then receives real-time updates through GitHub webhooks (verified
with HMAC-SHA256 signatures). When a client connects, the server authenticates
it via Socket.IO and sends the current pull state. Updates are pushed to all
connected clients in real-time. Filtering and sorting happens on the client side.

## Customization

### Signatures

Signatures are customizable through `config.js`.

The defaults are

```
# Give a code review or quality assurance signoff.
CR :emoji:
QA :emoji:

# Mark a pull as blocked and in need of development work.
dev_block :emoji:
un_dev_block :emoji:

# Mark a pull as blocked on deployment once all signoff requirements are met.
deploy_block :emoji:
un_deploy_block :emoji:
```

However, signatures can be also specified by a regular expression.

If your team's convention is to say `LGTM :code:` or `Tested <QA>`, you can
specify the `QA` and `CR` signatures to be

```js
// From config.js
{
   name: 'CR',
   regex: /\bLGTM :code:\b/i
},
{
   name: 'QA',
   regex: /\bTested <QA>\b/i
}
```

## License

Pulldasher is released under the [MIT License](LICENSE/).

## Developing Pulldasher

### React Frontend

- Hack on the just the UI (no DB needed): `npm frontend:start`
  - Then open http://localhost:8080/
  - Or the demo page at http://localhost:8080/pull-card-demo.html
- Hack on both the frontend + backend: `npm frontend:watch` + `npm start`
  - Then open http://localhost:{port} where port is from your config.js
