# Pulldasher
[![Build Status](https://travis-ci.org/iFixit/pulldasher.svg?branch=master)](https://travis-ci.org/iFixit/pulldasher)

Pulldasher is self-hosted to-do list for GitHub repositories.
Pulldasher tracks your pull requests and displays them according to their
current state. It sports a flexible template system, allowing you to customize
it extensively without touching the core code.

![pulldasher-image](https://cloud.githubusercontent.com/assets/2539016/11315808/78af398e-8fad-11e5-81d4-b59ae6109dec.png)

Pulldasher is written primarily in JavaScript, using Node.js. See the
[`package.json`](package.json/) and [`bower.json`](bower.json/) files for more on the front- and back-end
dependencies, respectively.

To run Pulldasher, you'll need MySQL as well as Node. MySQL is used for
statistics-gathering and some sorting and filtering.

## Getting Started

### Run a MySQL Container
1. `docker run --name="test-mysql" -e "MYSQL_ROOT_PASSWORD=mypassword" -d mysql`
   * If you leave the root password as `mypassword`, DO NOT MAKE THIS CONTAINER ACCESSIBLE FROM THE INTERNET.
### Preparing Pulldasher
1. `git clone https://github.com/iFixit/pulldasher`
2. `cd pulldasher`
3. `cp config.example.js config.js`
4. `$EDITOR config.js`
   * Use your favorite editor in place of `$EDITOR`
   * Edit the config.js file to reference correct URLs
5. `docker build -t pulldasher .`

### Running Pulldasher

Copy the example DB env vars file and confgiure it for your database setup. 
1. `cp .env.db.example .env.db`
2. `$EDITOR .env.db`
   * Edit the `.env.db` file to reference correct MySQL instance
3. Run the container!

```
docker run \
  --name="test-pulldasher" \
  --env-file=.env.db \
  --publish 8080:8080 \
  --detach \
  pulldasher`
```

### Development and docker compose

For ease of development you can also set things up with docker compose.

Note, running the `entrypoint.sh` (as happens when running the docker-compose) runs the `bin/migrate` script and applies the `migrations/schema.sql` file.

1. Set up the .env.compose and .env.db files appropriately.
2. Build it with `./build-compose`
3. Run it with `docker-compose up --detach`
4. Check the logs with `docker-compose logs -t`

There are a few scripts in `dev/` to help inspect the running DB.

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
completed.  Similarly, when you QA a pull, add a comment containing
`QA :emoji:`, and the number of QA signoffs will increase.

## Feature Details
### CR Leaders/QA Leaders
The lists of CR Leaders and QA Leaders at the top of Pulldasher are displays of
the number of signoffs by each person in each category which are currently visible
on Pulldasher. They do not take into account merged or closed pulls. They can be
fun to see who’s been doing a lot of CR recently, and they can be helpful in
balancing the number of CRs you’re doing versus everyone else.

### Dark Mode
Pulldasher supports a dark mode! See the button on the upper-right.


## Magic Features
There's a couple features which aren't exposed clearly through the UI:

### Hover Copy
If you hover over a pull request, you can use `Ctrl-C` (`Command-C` on Mac) to
copy the branch name of the pull to your clipboard.

### Filter Parameters
Two query string parameters are available to filter the displayed pulls:

1. `assigned`: Providing a comma-separated list of usernames to the `assigned`
   parameter will filter the pulls to only those assigned to those users.

   ```ex. https://pulldasher.example.com?assigned=copperwall,scotttherobot,davidrans```

2. `milestone`: Providing a comma-separated list of milestones to the
   `milestone` parameter will filter the pulls to only those on the specified
   milestones.

   ```ex. https://pulldasher.example.com?milestone=site-redesign,12/5,12/19```

## Architecture
When first started, the Pulldasher server fetches information about the current
pulls in the repo from GitHub. It then monitors GitHub hooks for updated
information on the current pulls. When a client connects initially, the server
authenticates it and then (assuming it passes) sends it a data dump of the
active pulls.  The main filtering and sorting of pulls takes place on the client
side.

## Customization

### UI
Pulldasher is designed to be customizable through the files in the
[`views/`](views/) directory. See the README there for the full details.

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
