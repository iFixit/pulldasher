var GithubApi = require('@octokit/rest'),
    config = require('./config-loader'),
    Promise = require('bluebird'),
    _ = require('underscore'),
    github = new GithubApi({
      version: '3.0.0'
    }),
    debug = require('./debug')('pulldasher:github'),
    utils = require('./utils'),
    Pull = require('../models/pull'),
    Issue = require('../models/issue'),
    Comment = require('../models/comment'),
    Label = require('../models/label'),
    Status = require('../models/status'),
    Signature = require('../models/signature'),
    getLogin  = require('./get-user-login'),
    rateLimit = require('./rate-limit.js');

github.authenticate({
   type: 'oauth',
   token: config.github.token
});

module.exports = {
   github: github,

   /**
    * Returns a promise which resolves to a GitHub API response to
    * a query for a particular Pull Request.
    */
   getPull: function(repo, number) {
      debug("Getting pull %s", number);
      return rateLimit(github.pullRequests.get)(params({ number }, repo))
                                .then(res => res.data);
   },

   /**
    * Get all *open* pull requests for a repo.
    *
    * Returns a promise which resolves to an array of all open pull requests
    */
   getOpenPulls: function(repo) {
      debug("Getting open pulls in repo %s", repo);
      return rateLimit(github.pullRequests.getAll)(params({}, repo)).then(paginate);
   },

   /**
    * Get *all* pull requests for a repo.
    *
    * Returns a promise which resolves to an array of all pull requests
    */
   getAllPulls: function(repo) {
      debug("Getting all pulls in repo %s", repo);
      return rateLimit(github.pullRequests.getAll)(params({ state: 'all' }, repo))
                                .then(paginate);
   },

   /**
    * Get an issue for a repo.
    *
    * Returns a promise which resolves to a github issue
    */
   getIssue: function(repo, number) {
      const searchParams = params({ number }, repo);
      debug("Getting issue %s in repo %s", number, repo);
      return rateLimit(github.issues.get)(searchParams)
                          .then(res => res.data)
                          .then(addRepo(searchParams));
   },

   /**
    * Get all open issues for a repo.
    *
    * Returns a promise which resolves to an array of all open issues
    */
   getOpenIssues: function(repo) {
      const searchParams = params({}, repo);
      debug("Getting open issues");
      return rateLimit(github.issues.getForRepo)(searchParams)
      .then(paginate)
      .then(filterOutPulls)
      .then(addRepo(searchParams));
   },

   /**
    * Get *all* issues for a repo.
    *
    * Returns a promise which resolves to an array of all issues
    */
   getAllIssues: function(repo) {
      const searchParams = params({state: 'all'}, repo);
      debug("Getting all issues");
      return rateLimit(github.issues.getForRepo)(searchParams)
      .then(paginate)
      .then(filterOutPulls)
      .then(addRepo(searchParams));
   },

   /**
    * Takes a promise that resolves to a GitHub pull request API response,
    * parses it, and returns a promise that resolves to a Pull objects.
    */
   parse: function(githubPull) {
      debug("Getting all information for pull %s in repo %s", githubPull.number,
         githubPull.base.repo.full_name);
      // We've occasionally noticed a null pull body, so lets fix it upfront
      // before errors happen.
      githubPull.body = githubPull.body || '';

      var repo = githubPull.base.repo.full_name;

      var reviewComments = getPullReviewComments(repo, githubPull.number);
      var comments = getIssueComments(repo, githubPull.number);
      var headCommit = getCommit(repo, githubPull.head.sha);
      var commitStatuses = getCommitStatuses(repo, githubPull.head.sha);
      var events = getIssueEvents(repo, githubPull.number);
      // Only so we have the canonical list of labels.
      var ghIssue = module.exports.getIssue(repo, githubPull.number);

      // Returned to the map function. Each element of githubPulls maps to
      // a promise that resolves to a Pull.
      return Promise.all([reviewComments,
                          comments,
                          headCommit,
                          commitStatuses,
                          events,
                          ghIssue])
       .then(function(results) {
         var reviewComments = results[0],
             comments       = results[1],
             headCommit     = results[2],
             commitStatuses = results[3],
             events         = results[4],
             ghIssue        = results[5];

         // Array of Signature objects.
         var signatures = comments.reduce(function(sigs, comment) {
            var commentSigs = Signature.parseComment(
             comment, repo, githubPull.number);

            // Signoffs from before the most recent commit are no longer active.
            var headCommitDate = new Date(headCommit.commit.committer.date);
            commentSigs.forEach(function(signature) {
               if ((signature.data.type === 'CR' ||
                signature.data.type === 'QA') &&
                new Date(signature.data.created_at) < headCommitDate) {
                  signature.data.active = false;
               }
            });

            return sigs.concat(commentSigs);
         }, []);

         // Array of Comment objects.
         comments = comments.map(function(commentData) {
            commentData.number = githubPull.number;
            commentData.repo = repo;
            commentData.type = 'issue';

            return new Comment(commentData);
         });

         // Array of Comment objects.
         comments = comments.concat(reviewComments.map(function(commentData) {
            commentData.number = githubPull.number;
            commentData.repo = repo;
            commentData.type = 'review';

            return new Comment(commentData);
         }));

         let statuses = commitStatuses.map(function(commitStatus) {
            return new Status({
               repo:          repo,
               sha:           githubPull.head.sha,
               state:         commitStatus.state,
               description:   commitStatus.description,
               target_url:    commitStatus.target_url,
               context:       commitStatus.context,
            });
         });

         // Array of Label objects.
         const labels = getLabelsFromEvents(events, ghIssue);

         const pull = Pull.fromGithubApi(githubPull, signatures, comments, statuses, labels);
         return pull.syncToIssue();
      });
   },

   /**
    * Takes a GitHub issue API response
    * parses it, and returns a promise that resolves to an Issue object.
    */
   parseIssue: function(ghIssue) {
      debug("Getting all information for issue %s in repo %s", ghIssue.number,
         ghIssue.repo);
      return getIssueEvents(ghIssue.repo, ghIssue.number)
      .then(function(events) {
         // Array of Label objects.
         // Note: using the repo name from the config for now until we support
         // multiple repos. The ghIssue object doesn't contain the repo name.
         var labels = getLabelsFromEvents(events, ghIssue);

         return Issue.getFromGH(ghIssue, labels);
      });
   },
};

async function paginate(res) {
   let response = res;
   let all = res.data;

   while (github.hasNextPage(response)) {
      response = await rateLimit(github.getNextPage)(response);
      all = all.concat(response.data);
   }

   return all;
}

/**
 * Get array of Label objects from complete list of a Issue's events.
 *
 * Note: ghIssue at this point has always come from one of the
 * get*Issues() commands and thus has been augmented with the
 * issue.repo property.
 */
function getLabelsFromEvents(events, ghIssue) {
   debug("Extracting label assignments from %s issue events for #%s",
    events.length, ghIssue.number);

   // Narrow list to relevant labeled/unlabeled events.
   events = _.filter(events, function(event) {
      return event.event === 'labeled' || event.event === 'unlabeled';
   });

   debug("Found %s label events for #%s", events.length, ghIssue.number);

   // Build simple Event objects with all the info we care about.
   events = events.map(function(event) {
      return {
         type: event.event,
         name: event.label.name,
         user: getLogin(event.actor),
         created_at: utils.fromDateString(event.created_at)
      };
   });

   // Group label events by label name.
   var labels = _.groupBy(events, 'name');

   // Get a list of the most recent events for each label.
   labels = _.map(labels, function(events) {
      events = _.sortBy(events, 'created_at');
      return _.last(events);
   });

   labels = _.filter(labels, function(event) {
      return event.type === 'labeled';
   });

   debug("Found %s unique labels for #%s", labels.length, ghIssue.number);

   // If these are available, use them as the canonical source, only augmented
   // by the data from events. If a label is renamed, the events will retain
   // the old name but the list of labels on the issue itself will be correct.
   // So, if a label is renamed, we'll lose the labeler and the date.
   if (ghIssue.labels && ghIssue.labels.length) {
      debug("Using %s labels from the github issue", ghIssue.labels.length);
      // Includes labeller and a time from the events api
      var eventLabels = _.indexBy(labels, 'name');

      return ghIssue.labels.map(function(label) {
         var eventLabel = eventLabels[label.name];
         return new Label(
            {name: label.name},
            ghIssue.number,
            ghIssue.repo,
            eventLabel && eventLabel.user,
            eventLabel && eventLabel.created_at
         );
      });
   }

   // Construct Label objects.
   return labels.map(function(label) {
      return new Label(
         {name: label.name},
         ghIssue.number,
         ghIssue.repo,
         label.user,
         label.created_at
      );
   });
}

/**
 * Return the default api params merged with the overrides
 */
function params(apiParams, fullRepoName) {
   const [owner, repo] = parseRepo(fullRepoName);

   return _.extend({
      owner,
      repo,
      per_page:   100
   }, apiParams);
}

/**
 * Returns a function that uses the search parameters to add the "repo"
 * property to all the results. When we ask for a list of open issues from the
 * API for a particular repo, those results don't have references to the repo
 * we asked about, so we have to inject them to normalize the structure of the
 * object.
 */
function addRepo({owner, repo}) {
   function addRepositoryField(ghIssue) {
      ghIssue.repo = owner + "/" + repo;
   }
   return function(results) {
      if (Array.isArray(results)) {
         results.forEach(addRepositoryField);
      } else {
         addRepositoryField(results);
      }
      return results;
   };
}

/**
 * Splits the repo into the owner and repo name.
 */
function parseRepo(repo) {
   return repo.split("/");
}


/**
 * Return a promise for all issue events for the given issue / pull
 */
function getIssueEvents(repo, number) {
   debug("Getting events for issue #%s", number);
   return rateLimit(github.issues.getEvents)(params({ number }, repo))
                       .then(paginate);
}

function getIssueComments(repo, number) {
   debug("Getting comments for issue #%s", number);
   return rateLimit(github.issues.getComments)(params({ number }, repo))
                       .then(paginate);
}

function getPullReviewComments(repo, number) {
   debug("Getting pull review comments for pull #%s", number);
   return rateLimit(github.pullRequests.getComments)(params({ number }, repo))
                .then(paginate);
}

function getCommit(repo, sha) {
   return rateLimit(github.repos.getCommit)(params({ sha }, repo))
                      .then(res => res.data);
}

function getCommitStatuses(repo, ref) {
   debug("Getting commit status for %s", ref);
   return rateLimit(github.repos.getCombinedStatusForRef)(params({ ref }, repo))
      .then(res => res.data.statuses)
      .then(statuses => statuses || [])
}

/**
 * Remove all entries that have the pull_request key set to something truthy
 */
function filterOutPulls(issues) {
   debug("Filtering out pulls from list of %s issues", issues.length);
   issues = _.filter(issues,
                     issue => !issue.pull_request || !issue.pull_request.url);
   debug("Filtered down to %s issues", issues.length);
   return issues;
}
