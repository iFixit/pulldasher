var { Octokit } = require('@octokit/rest'),
    { throttling } = require("@octokit/plugin-throttling"),
    MyOctokit = Octokit.plugin(throttling),
    config = require('./config-loader'),
    Promise = require('bluebird'),
    _ = require('underscore'),
    debug = require('./debug')('pulldasher:github'),
    utils = require('./utils'),
    Pull = require('../models/pull'),
    Issue = require('../models/issue'),
    Comment = require('../models/comment'),
    Review = require('../models/review'),
    Label = require('../models/label'),
    Status = require('../models/status'),
    Signature = require('../models/signature'),
    getLogin  = require('./get-user-login');

const github = new MyOctokit({
   auth: config.github.token,
   throttle: {
      onRateLimit: (retryAfter, options) => {
        github.log.warn(
          `Request quota exhausted for request ${options.method} ${options.url}`
        );
  
        // Retry five times after hitting a rate limit error, then give up
        if (options.request.retryCount <= 5) {
          github.log.debug(`Retrying after ${retryAfter} seconds!`);
          return true;
        }
      },
      onAbuseLimit: (retryAfter, options) => {
        // does not retry, only logs a warning
        github.log.warn(
          `Abuse detected for request ${options.method} ${options.url}`
        );
      },
    }
}); 

const githubRest = github.rest;


module.exports = {
   github: githubRest,

   /**
    * Returns a promise which resolves to a GitHub API response to
    * a query for a particular Pull Request.
    */
   getPull: function(repo, number) {
      debug("Getting pull %s", number);
      return githubRest.pulls.get(params({ pull_number: number }, repo))
       .then(res => res.data);
   },

   /**
    * Get all *open* pull requests for a repo.
    *
    * Returns a promise which resolves to an array of all open pull requests
    */
   getOpenPulls: function(repo) {
      debug("Getting open pulls in repo %s", repo);
      return github.paginate(githubRest.pulls.list, params({state: 'open'}, repo));
   },

   /**
    * Get *all* pull requests for a repo.
    *
    * Returns a promise which resolves to an array of all pull requests
    */
   getAllPulls: function(repo) {
      debug("Getting all pulls in repo %s", repo);
      return github.paginate(githubRest.pulls.list, params({ state: 'all'}, repo));
   },

   /**
    * Get an issue for a repo.
    *
    * Returns a promise which resolves to a github issue
    */
   getIssue: function(repo, number) {
      const searchParams = params({ issue_number: number }, repo);
      debug("Getting issue %s in repo %s", number, repo);
      return githubRest.issues.get(searchParams)
       .then(res => res.data)
       .then(addRepo(searchParams));
   },

   /**
    * Get all open issues for a repo.
    *
    * Returns a promise which resolves to an array of all open issues
    */
   getOpenIssues: function(repo) {
      const searchParams = params({state: 'open'}, repo);
      debug("Getting open issues in repo %s", repo);
      return github.paginate(githubRest.issues.listForRepo, searchParams)
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
      return github.paginate(githubRest.issues.listForRepo, searchParams)
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
      var reviews = getReviews(repo, githubPull.number);

      // Returned to the map function. Each element of githubPulls maps to
      // a promise that resolves to a Pull.
      return Promise.all([reviewComments,
                          comments,
                          headCommit,
                          commitStatuses,
                          events,
                          ghIssue,
                          reviews])
       .then(function(results) {
         var reviewComments = results[0],
             comments       = results[1],
             headCommit     = results[2],
             commitStatuses = results[3],
             events         = results[4],
             ghIssue        = results[5],
             reviews        = results[6];

         // Array of Signature objects.
         var commentSignatures = comments.reduce(function(sigs, comment) {
            var commentSigs = Signature.parseComment(
             comment, repo, githubPull.number);

            return sigs.concat(commentSigs);
         }, []);

         var signatures = reviews.reduce(function(sigs, review) {
            var reviewSigs = Signature.parseReview(
             review, repo, githubPull.number);

            return sigs.concat(reviewSigs);
         }, commentSignatures);

         // Signoffs from before the most recent commit are no longer active.
         var headCommitDate = new Date(headCommit.commit.committer.date);
         signatures.forEach(function(signature) {
            if ((signature.data.type === 'CR' ||
             signature.data.type === 'QA') &&
             new Date(signature.data.created_at) < headCommitDate) {
               signature.data.active = false;
            }
         });

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

         reviews = reviews.map(function(reviewData) {
            reviewData.number = githubPull.number;
            reviewData.repo = repo;

            return new Review(reviewData);
         });

         let statuses = commitStatuses.map(function(commitStatus) {
            let state = commitStatus.state || utils.mapCheckToStatus(commitStatus.conclusion || commitStatus.status);
            let desc = commitStatus.description || utils.mapCheckToStatus(commitStatus.conclusion || commitStatus.status);
            let url = commitStatus.target_url || commitStatus.html_url;
            let context = commitStatus.context || commitStatus.name;

            return new Status({
               repo:          repo,
               sha:           githubPull.head.sha,
               state:         state,
               description:   desc,
               target_url:    url,
               context:       context,
            });
         });

         // Array of Label objects.
         const labels = getLabelsFromEvents(events, ghIssue);

         const pull = Pull.fromGithubApi(githubPull, signatures, comments, reviews, statuses, labels);
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
   return github.paginate(githubRest.issues.listEvents, params({ issue_number: number }, repo))
}

function getIssueComments(repo, number) {
   debug("Getting comments for issue #%s", number);
   return github.paginate(githubRest.issues.listComments, params({ issue_number: number }, repo));
}

function getReviews(repo, number) {
   debug("Getting reviews for pull #%s", number);
   return github.paginate(githubRest.pulls.listReviews, params({ pull_number: number }, repo));
}

function getPullReviewComments(repo, number) {
   debug("Getting pull review comments for pull #%s", number);
   return github.paginate(githubRest.pulls.listReviewComments, params({ pull_number: number }, repo))
}

function getCommit(repo, sha) {
   return githubRest.repos.getCommit(params({ ref: sha }, repo)).then(res => res.data);
}

async function getCommitStatuses(repo, ref) {
   debug("Getting commit status for %s", ref);
   let statuses = await githubRest.repos.getCombinedStatusForRef(params({ ref }, repo))
      .then(res => res.data.statuses)
      .then(statuses => statuses || [])
   let checks = await githubRest.checks.listForRef(params({ ref }, repo))
      .then(res => res.data.check_runs)
      .then(check_runs => check_runs || [])
   return statuses.concat(checks)
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
