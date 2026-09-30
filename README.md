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

### Run a MySQL Container

1. `docker run --name="test-mysql" -e "MYSQL_ROOT_PASSWORD=mypassword" -d mysql`
   - If you leave the root password as `mypassword`, DO NOT MAKE THIS CONTAINER ACCESSIBLE FROM THE INTERNET.

### Preparing Pulldasher

1. `git clone https://github.com/iFixit/pulldasher`
2. `cd pulldasher`
3. `cp config.example.js config.js`
4. `$EDITOR config.js`
   - Use your favorite editor in place of `$EDITOR`
   - Edit the config.js file to reference correct URLs and above MySQL DB
5. `docker build -t pulldasher .`

### Running Pulldasher

6. `docker run --name="test-pulldasher" --publish 8080:8080 -d pulldasher`

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

When you CR a pull, you can either approve it on GitHub (using GitHub's native
**Approve** review action) or add a comment containing `CR :emoji:`.
(`emoji` is simply a word or words between colons; we often use GitHub emoji,
which follow this format.) A GitHub approval and a `CR :emoji:` comment are both
considered _signoffs_. Pulldasher will update the pull's display to indicate
that one of the required CRs is completed. Similarly, when you QA a pull, add a
comment containing `QA :emoji:`, and the number of QA signoffs will increase.

To honor GitHub approvals, enable the **Pull request reviews** webhook event on
tracked repositories. Set `useGithubApprovalForCr: false` in `config.js` to
disable this and require `CR :emoji:` comments (legacy behavior).

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

### Projects

An optional tab for whoever plans the work: which projects the open PRs
serve, who is on each, how they are moving, and a roadmap to plan them on.
Everything but the roadmap is read from GitHub; something else (a person,
or a job) files the PRs:

- A PR joins a project through one label, `project:<slug>`. PRs that fit no
  project get `project:misc`. Keep a label to 32 characters with no spaces:
  that's what Pulldasher's label table and filter box hold.
- Each project is an issue in one repo, carrying the same label. The issue's
  title is the project's name, its assignee the lead, its milestone (and due
  date) the target, `parent:<slug>` labels its parents (any number), and an
  `ongoing` label marks work with no end. Close it as completed when it's
  done, or as not planned when it's dropped or merged into another.

Turn it on with the `projects` block in `config.js` (see
`config.example.js`): the projects repo, and `developerTeams`, the teams
whose members count as developers (anyone else with a PR is a
non-developer, whose work needs a developer's review). Give the projects
repo the same webhook as a tracked repo (Issues events). Without a projects
repo, PRs still group by label, just without names, leads or targets.

The tab has three views and a page per project:

- **Overview**: where the plans stand (the latest update on every item in
  progress, worst first, which copies as text for a status email),
  headline numbers for a date range (each compared with the same number of
  days before), the backlog chart, where the merged work went week by
  week, and every project on one list you can sort, group by parent, lead
  or team, search, and download as CSV.
- **Roadmap**: the plan, by month or by quarter. Drag rows to set priority,
  drag a bar to move it and its edge to change its length; group into team
  lanes. An item linked to a project label draws what its PRs actually did
  under the plan. Each item takes updates: on track, at risk or off track,
  and a note, kept as a history. Work in progress with no update for 14
  days is flagged. The roadmap is the one thing the tab stores itself, in
  the `roadmap_items` and `roadmap_updates` tables.
- **People**: developers by team and everyone else: live projects each,
  open PRs, PRs opened and merged, and reviews given, including how many
  went to non-developers' PRs.

The same data is in the API, Bearer-authed like `/api/v1/pulls`. The first
two take `start` and `end` as `YYYY-MM-DD` days (default: the last 30 days,
at most 400), and `project=<slug>` narrows the window's numbers to one
project:

- `GET /api/v1/projects`: each project's issue fields, where it stands today
  (open PR ids, people, idle days, flags), and its numbers for the window,
  plus the totals and one point per day for the backlog chart.
- `GET /api/v1/people`: per person, their team, the window's numbers,
  reviews given, the projects they had PRs in, the live projects they're on
  today, and their open PRs.
- `GET /api/v1/roadmap`: every roadmap item in priority order, each with
  its latest update.
- `GET /api/v1/roadmap/:id/updates`: one item's updates, newest first,
  each with the plan as it stood when it was posted.

Pulldasher also re-lists every tracked repo's open PRs once an hour and
refreshes only the ones its database has wrong, so a lost webhook can't leave
a merged PR counted as open.

## Architecture

When first started, the Pulldasher server fetches information about the current
pulls in the repo from GitHub. It then monitors GitHub hooks for updated
information on the current pulls. When a client connects initially, the server
authenticates it and then (assuming it passes) sends it a data dump of the
active pulls. The main filtering and sorting of pulls takes place on the client
side.

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

The frontend lives in `frontend-v2/` (see its README). From the repo root:

- Hack on just the UI, no DB needed: `npm run frontend:dummy`, then open the
  Vite dev server it prints (a synthetic board, no backend).
- Hack on the frontend against a live backend: `npm run frontend:dev` (proxies
  `/token`, the socket, and `/stats-history` to a local `npm start`).
