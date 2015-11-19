Welcome to Pulldasher, the self-hosted to-do list for GitHub repositories.
Pulldasher tracks your pull requests and displays them according to their
current state. It sports a flexible template system, allowing you to customize
it extensively without touching the core code.

Pulldasher is written primarily in JavaScript, using Node.js. See the
`package.json` and `bower.json` files for more on the front- and back-end
dependencies, respectively.

To run Pulldasher, you'll need MySQL as well as Node. MySQL is used for
statistics-gathering and some sorting and filtering.

# Installation
1. `make`
2. `cp config.example.js config.js; $EDITOR config.js`
3. Create a new MySQL database and source the schema.sql file.
 * `create database pulldasher;`
 * `use pulldasher;`
 * `source schema.sql;`
4. `bin/pulldasher`

# Use
Pulldasher is driven by tags in pull requests and pull comments. Normally, it
assumes that two code review and one quality assurance signoff will be
required per pull. This can be adjusted on a per-pull basis by using the
`cr_req` and `qa_req` tags in a pull description. For example, if you write a
pull that touches some really dangerous code, you might add the `cr_req 3` and
`qa_req 2` tags to it, requiring three CR signoffs and two QA signoffs before
the pull is considered ready. Conversely, if a pull only touches test code, you
might put only `qa_req 0` on it to say that it doesn't need to be QAed, since
it should break tests if there's anything wrong with it.

When you have CRed a pull, you add a comment to it with `CR :emoji:` in it.
(`emoji` is simply a word or words between colons; we often use GitHub emoji,
which follow this format.) This comment is considered a _signoff_. Pulldasher
will update the pull's display to indicate that one of the required CRs is
completed.  Similarly, when you have QAed a pull, you add a comment containing
`QA :emoji:`, and the number of QA signoffs will increase.

## Magic Features
There's a couple features which aren't exposed clearly through the UI:

### Hover Copy
If you hover over a pull and type `ctrl-c` (`command-c` on a Mac), the branch
name of the pull will be copied to your clipboard.

### Filter parameters
Two query string parameters are available to filter the displayed pulls:

1. `assigned`: Providing a comma-separated list of usernames to the `assigned`
   parameter will filter the pulls to only those assigned to those users.

2. `milestone`: Providing a comma-separated list of milestones to the
   `milestone` parameter will filter the pulls to only those on the specified
   milestones.

# Architecture
When first started, the Pulldasher server fetches information about the current
pulls in the repo from GitHub. It then monitors GitHub hooks for updated
information on the current pulls. When a client connects initially, the server
authenticates it and then (assuming it passes) sends it a data dump of the
active pulls.  The main filtering and sorting of pulls takes place on the client
side.

# Customization

## UI
Pulldasher is designed to be customizable through the files in the
[`views/`](views/) directory. See the README there for the full details.

## Signatures
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
