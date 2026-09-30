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
- A project's record is an issue carrying the same label, in any tracked
  repo or in a projects repo. The issue's title is the project's name, its
  assignee the lead, its milestone (and due date) the target,
  `parent:<slug>` labels its parents (any number), and an `ongoing` label
  marks work with no end. GitHub's own issue fields show too: its Start
  date, its Priority, and its Target date, which wins over a milestone,
  since it's set on that one issue. Close it as completed when it's done, or as not
  planned when it's dropped or merged into another. Labeling an issue is
  also how a project starts before it has a PR. When several issues carry
  one label, the projects repo's wins, then an open one, then the oldest:
  the first issue labeled is the project, and later ones are work inside
  it.

Turn it on with the `projects` block in `config.js` (see
`config.example.js`): a projects repo if you want one, and `developerTeams`, the teams
whose members count as developers (anyone else with a PR is a
non-developer, whose work needs a developer's review). The teams can also
be edited from the People view or the API; saved ones replace
`developerTeams` until someone goes back to it. Send Issues events in the
tracked repos' webhook, and give a projects repo the same webhook, so a
newly labeled issue shows up right away; an hourly pass catches what a
webhook missed.

The tab has four views and a page per project:

- **Overview**: where the plans stand (the latest update on every item in
  progress, worst first, which copies as text for a status email),
  headline numbers (how many calls Decide has waiting, then a date
  range's numbers, each compared with the same number of days before),
  the backlog chart, where the merged work went week by week (by project,
  or split into work on the roadmap and everything else, with the
  roadmap's share against the days before), and every
  project on one list you can sort, group by parent, lead or team,
  search, and download as CSV, each with how its roadmap plan is going.
  A project's own page shows its plan and latest update too.
- **Decide**: the calls owed now, as a list that empties: projects with 3
  or more PRs (open, or merged in the last 14 days) and no decision, plans
  past their end or their target date, stalls (open PRs with no activity
  for 21 days), updates that say at risk or off track, work marked done or
  dropped (on the roadmap or by closing its issue) whose PRs are still
  open, and parked work whose PRs moved. Each row says why it's there, with
  its team, size and target, and takes one click: commit through the end
  of a coming month or quarter, park, finish, or drop. The row can also say
  where the work came from, saved with the call. People take turns running
  the list, a week each: it names this week's and next week's, and the
  turns can be changed in place or with `PATCH /api/v1/settings`. A team's lead can
  take just their team's rows, and copy them as text for a meeting's
  notes. It weighs every project, whatever the filter bar narrows the
  other views to. The tab's label counts what's left.
- **Roadmap**: the plan set against everything actually in flight. Across
  the top, how many projects were in flight each week (from their PRs)
  and, for the weeks ahead, the plans plus every project big enough to owe
  a decision that has none, as if nothing changes, against a line at the
  number of
  developers. Below, the plans in priority order, then every live project
  with no plan, one click from being planned.
  - By month or by quarter; click a quarter or a month to fill the width
    with it, and zoom out or step to the next one from the toolbar. Or
    now, next and later, without week dates, for readers outside
    engineering.
  - Click a week in the load chart to see only what was in flight then, or
    a count to see only those ("with no plan"). Find narrows by name,
    lead or team.
  - Each plan can say where its work came from: asked for from above
    (top-down), or found by the team, as a fire to put out or its own pick
    (bottom-up). The load chart splits its roadmap count that way, and a
    click on one shows only those plans.
  - Drag rows to set priority, drag a bar to move it and its edge to change
    its length; the editor also plans a month or a quarter in one click.
    Team lanes say the most each team has in flight at once against its
    developers, and draw a dashed line where, in priority order, the work
    in flight outnumbers them: what's below it is what to park.
  - A linked plan still in flight past its end grows an amber "+3 wk over";
    its project's milestone is a flag with its date. An item can wait on
    others, and says so when its plan starts before one of them ends.
    Parked work is stopped for now without being dropped, and leaves the
    load.
  - Each item takes updates: on track, at risk or off track, and a note,
    kept as a history. Work in progress with no update for 14 days is
    flagged. The roadmap is the one thing the tab stores itself, in the
    `roadmap_items` and `roadmap_updates` tables.
- **People**: developers by team and everyone else: live projects each,
  open PRs, PRs opened and merged, and reviews given, including how many
  went to non-developers' PRs.

To put the plans where people already look, `bin/sync-issue-fields` copies
each plan under way into its project issue's Start date, Target date and
Priority fields: the plan's first Monday and last day, and Urgent for a
fire, else High, Medium or Low for work now, next or later. A team's project
board shows those fields, and the issue's history keeps every change. It
fills a field nobody has set, and changes one only if its own token set it
last, so a date a person moved stays moved; it says so instead. It's a dry
run unless given `--apply`, and its writes show as `github.token`'s account.

```sh
bin/sync-issue-fields           # what it would write
bin/sync-issue-fields --apply   # write it
```

Everything the tab shows, and every change the roadmap takes, is in the API,
Bearer-authed with the caller's own GitHub token like `/api/v1/pulls`, so a
script or a Claude session can read the projects and run the roadmap
without a browser. `GET /api/v1` lists every route with what it does, and
the rules a roadmap write is checked against:

```sh
curl -s -H "Authorization: Bearer $(gh auth token)" https://pulldasher.example.com/api/v1
```

- `GET /api/v1/projects` and `GET /api/v1/people`: each project and each
  person with where they stand today and their numbers for a window. Both
  take `start` and `end` as `YYYY-MM-DD` days (default: the last 30 days, at
  most 400), and `project=<slug>` narrows the numbers to one project.
- `GET /api/v1/decide`: the calls owed now, worst first, each with its
  project, its roadmap item if it has one, and its reasons. `GET /api/v1`
  says what each reason means and which write clears it.
- `GET /api/v1/load`: projects in flight each week against the developer
  count, on the roadmap and not, with the weeks after this one counted as
  if nothing changes. `start` and `end` as above (default: 12 weeks back to
  26 ahead).
- `GET /api/v1/roadmap` and `GET /api/v1/roadmap/:id`: the items in
  priority order, or one, each with its latest update.
- `POST /api/v1/roadmap`, `PATCH` and `DELETE /api/v1/roadmap/:id`: add,
  change or remove an item. `POST /api/v1/roadmap/:id/move` with
  `{"before": <id>}` (or `null` for the bottom) moves one item without
  sending the whole order; `PUT /api/v1/roadmap/order` sets the whole order.
- `GET` and `POST /api/v1/roadmap/:id/updates`: an item's updates, or a new
  one, `{"health": "at_risk", "body": "..."}`.
- `GET` and `PATCH /api/v1/settings`: the developer teams and whether
  they're saved or `config.js`'s. `{"developer_teams": {"Store": ["dana"]}}`
  replaces them; `null` goes back to `config.js`.

A write takes a JSON body and is recorded as the token's login. The board
itself uses the same handlers through `/roadmap`, with its session.

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
