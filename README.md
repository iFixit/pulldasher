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
3. `bin/pulldasher`

# Use
Pulldasher is driven by tags in pull requests and pull comments. Normally, it
assumes that two code review and one quality assurance signoff will be
required per pull. This can be adjusted on a per-pull basis by using the
`cr_req` and `qa_req` tags in a pull description. For example, if I write a
pull that touches some really dangerous code, I might add the `cr_req 3` and
`qa_req 2` tags to it, requiring three CR signoffsand two QA signoffs before
the pull is considered ready. Conversely, if a pull only touches test code, I
might put only `qa_req 0` on it to say that it doesn't need to be QAed, since
it should break tests if there's anything wrong with it.

When I have CRed a pull, I add a comment to it with `CR :emoji:` in it.
(`emoji` is simply a word or words between colons; we often use GitHub emoji,
which follow this format.) This comment is considered a _signoff_. Pulldasher
will update the pull's display to indicate that one of the required CRs is
completed.  Similarly, when I have QAed a pull, I add a comment containing `QA
:emoji:`, and the number of QA signoffs will increase.

# Architecture
When first started, the Pulldasher server fetches information about the current
pulls in the repo from GitHub. It then monitors GitHub hooks for updated
information on the current pulls. When a client connects initially, the server
authenticates it and then (assuming it passes) sends it a data dump of the
active pulls.  The main filtering and sorting of pulls takes place on the client
side.

# Customization
Pulldasher is designed to be customizable through the files in the
[`views/`](views/) directory. See the README there for the full details.
