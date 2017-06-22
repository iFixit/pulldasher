var GithubApi = require('github'),
    config = require('../config'),
    Promise = require('promise'),
    _ = require('underscore'),
    github = new GithubApi({
      debug: config.debug,
      version: '3.0.0'
    }),
    debug = require('debug')('pulldasher:github'),
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

function denodeify(func) {
   return rateLimit(Promise.denodeify(func));
}

var api = {};
var getPull                = denodeify(github.pullRequests.get);
var getAllPulls            = denodeify(github.pullRequests.getAll);
var getIssue               = denodeify(github.issues.getRepoIssue);
var getAllIssues           = denodeify(github.issues.repoIssues);
api.getIssueEvents         = denodeify(github.issues.getEvents);
// "issue" comments are the comments on the pull (issue) itself.
api.getIssueComments       = denodeify(github.issues.getComments);
// "review" comments are the comments on the diff of the pull
api.getPullReviewComments  = denodeify(github.pullRequests.getComments);
api.getCommit              = denodeify(github.repos.getCommits);
api.getCommitStatus        = denodeify(github.statuses.get);
var getNextPage            = denodeify(github.getNextPage.bind(github));

module.exports = {
   github: github,

   /**
    * Returns a promise which resolves to a GitHub API response to
    * a query for a particular Pull Request.
    */
   getPull: function(repo, number) {
      debug("Getting pull %s", number);
      return getPull(params({
         number:     number
      }, repo));
   },

   /**
    * Get all *open* pull requests for a repo.
    *
    * Returns a promise which resolves to an array of all open pull requests
    */
   getOpenPulls: function(repo) {
      debug("Getting open pulls");
      return getAllPulls(params({}, repo)).then(getAllPages);
   },

   /**
    * Get *all* pull requests for a repo.
    *
    * Returns a promise which resolves to an array of all pull requests
    */
   getAllPulls: function(repo) {
      debug("Getting all pulls");
      return getAllPulls(params({
         state: 'all'
      }, repo)).then(getAllPages);
   },

   /**
    * Get an issue for a repo.
    *
    * Returns a promise which resolves to a github issue
    */
   getIssue: function(repo, number) {
      var searchParams = params({number: number}, repo);
      debug("Getting issue %s", number);
      return getIssue(searchParams)
      .then(addRepo(searchParams));
   },

   /**
    * Get all open issues for a repo.
    *
    * Returns a promise which resolves to an array of all open issues
    */
   getOpenIssues: function(repo) {
      var searchParams = params({}, repo);
      debug("Getting open issues");
      return getAllIssues(searchParams)
      .then(getAllPages)
      .then(filterOutPulls)
      .then(addRepo(searchParams));
   },

   /**
    * Get *all* issues for a repo.
    *
    * Returns a promise which resolves to an array of all issues
    */
   getAllIssues: function(repo) {
      var searchParams = params({state: 'all'}, repo);
      debug("Getting all issues");
      return getAllIssues(searchParams)
      .then(getAllPages)
      .then(filterOutPulls)
      .then(addRepo(searchParams));
   },

   /**
    * Takes a promise that resolves to a GitHub pull request API response,
    * parses it, and returns a promise that resolves to a Pull objects.
    */
   parse: function(githubPull) {
      debug("Getting all information for pull %s", githubPull.number);
      // We've occasionally noticed a null pull body, so lets fix it upfront
      // before errors happen.
      githubPull.body = githubPull.body || '';

      var repo = githubPull.head.repo.full_name;

      var reviewComments = getPullReviewComments(repo, githubPull.number);
      var comments = getIssueComments(repo, githubPull.number);
      var headCommit = getCommit(repo, githubPull.head.sha);
      var commitStatus = getCommitStatus(repo, githubPull.head.sha);
      var events = getIssueEvents(repo, githubPull.number);
      // Only so we have the canonical list of labels.
      var ghIssue = module.exports.getIssue(repo, githubPull.number);

      // Returned to the map function. Each element of githubPulls maps to
      // a promise that resolves to a Pull.
      return Promise.all([reviewComments,
                          comments,
                          headCommit,
                          commitStatus,
                          events,
                          ghIssue])
       .then(function(results) {
         var reviewComments = results[0],
             comments       = results[1],
             headCommit     = results[2],
             commitStatus   = results[3],
             events         = results[4],
             ghIssue        = results[5];

         // Array of Signature objects.
         var signatures = comments.reduce(function(sigs, comment) {
            var commentSigs = Signature.parseComment(
             comment, githubPull.base.repo.full_name, githubPull.number);

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
            commentData.repo_name = githubPull.base.repo.name;
            commentData.repo = githubPull.base.repo.full_name;
            commentData.type = 'issue';

            return new Comment(commentData);
         });

         // Array of Comment objects.
         comments = comments.concat(reviewComments.map(function(commentData) {
            commentData.number = githubPull.number;
            commentData.repo_name = githubPull.base.repo.name;
            commentData.repo = githubPull.base.repo.full_name;
            commentData.type = 'review';

            return new Comment(commentData);
         }));

         // Status object.
         var status = null;
         if (commitStatus) {
            status = new Status({
               repo:          githubPull.base.repo.full_name,
               sha:           githubPull.head.sha,
               state:         commitStatus.state,
               description:   commitStatus.description,
               target_url:    commitStatus.target_url
            });
         }

         // Array of Label objects.
         var labels = getLabelsFromEvents(events, ghIssue);

         var pull = Pull.fromGithubApi(githubPull, signatures, comments, status, labels);
         return pull.syncToIssue();
      });
   },

   /**
    * Takes a GitHub issue API response
    * parses it, and returns a promise that resolves to an Issue object.
    */
   parseIssue: function(ghIssue) {
      debug("Getting all information for issue %s", ghIssue.number);
      return getIssueEvents(ghIssue.number)
      .then(function(events) {
         // Array of Label objects.
         // Note: using the repo name from the config for now until we support
         // multiple repos. The ghIssue object doesn't contain the repo name.
         var labels = getLabelsFromEvents(events, ghIssue);

         return Issue.getFromGH(ghIssue, labels);
      });
   },

   forEachRepo,
};

/**
 * Traverses github's pagination to retrieve *all* the records.
 * Takes in the first page of results and returns a promise for *all* the
 * results.
 */
function getAllPages(currentPage, allResults) {
   debug("Got %s results", currentPage.length);
   return new Promise(function (resolve, reject) {
      allResults = allResults || [];
      allResults.push(currentPage);

      if (!github.hasNextPage(currentPage)) {
         debug("No more results");
         return resolve(_.flatten(allResults));
      }

      resolve(getNextPage(currentPage).then(function (nextPage) {
         return getAllPages(nextPage, allResults);
      }));
   });
}

/**
 * Get array of Label objects from complete list of a Issue's events.
 *
 * Note: ghIssue at this point has always come from one of the
 * get*Issues() commands and thus has been augmented with the
 * issue.repo property.
 */
function getLabelsFromEvents(events, ghIssue) {
   // until we remove this entirely, let's jsut get it the easy way.
   var repoName = ghIssue.repository.full_name.split('/')[1];

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
            repoName,
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
         repoName,
         ghIssue.repo,
         label.user,
         label.created_at
      );
   });
}

/**
 * Return the default api params merged with the overrides
 */
function params(apiParams, repo) {
   var repoArray = parseRepo(repo);
   var owner = repoArray[0];
   var repoName = repoArray[1];

   return _.extend({
      user:       owner,
      repo:       repoName,
      per_page:   100,
   }, apiParams);
}

/**
 * Returns a function that uses the search parameters to add the "repo"
 * property to all the results. When we ask for a list of open issues from the
 * API for a particular repo, those results don't have references to the repo
 * we asked about, so we have to inject them to normalize the structure of the
 * object.
 */
function addRepo(params) {
   function addRepositoryField(ghIssue) {
      ghIssue.repo = params.user + "/" + params.repo;
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
 * Provide a function that returns an array of values for a given repo.
 * The second argument should be all arguments after the repository, since the
 * repository argument will be dealt with by this function.
 *
 * The function should take a repository name, and return an array of values.
 */
function forEachRepo(singleRepoLambda, args) {
   // default value
   args = args || [];
   args.unshift(null);
   var allRepoMap = function(currentRepo) {
      args[0] = currentRepo;
      return singleRepoLambda.call(this, ...args);
   };
   return Promise.all(config.repos.map(allRepoMap))
   .then(function(repoItems) {
      return _.flatten(repoItems, /* shallow */ true);
   });
}

/**
 * Return a promise for all issue events for the given issue / pull
 */
function getIssueEvents(repo, issueNumber) {
   debug("Getting events for issue #%s", issueNumber);
   return api.getIssueEvents(params({
      number: issueNumber
   }, repo)).then(getAllPages);
}

function getIssueComments(repo, issueNumber) {
   debug("Getting comments for issue #%s", issueNumber);
   return api.getIssueComments(params({
      number: issueNumber
   }, repo)).then(getAllPages);
}

function getPullReviewComments(repo, pullNumber) {
   debug("Getting pull review comments for pull #%s", pullNumber);
   return api.getPullReviewComments(params({
      number: pullNumber
   }, repo)).then(getAllPages);
}

function getCommit(repo, sha) {
   return new Promise(function (resolve, reject){
      debug("Getting commit %s", sha);
      api.getCommit(params({
         sha: sha,
         per_page: 1
      }, repo)).then(function(commits) {
         if (commits.length === 1) {
            resolve(commits[0]);
         } else {
            return reject();
         }
      });
   });
}

function getCommitStatus(repo, sha) {
   return new Promise(function(resolve, reject) {
      debug("Getting commit status for %s", sha);
      api.getCommitStatus(params({
         sha: sha
      }, repo)).then(function(status) {
         if (status.length) {
            resolve(status[0]);
         } else {
            resolve(null);
         }
      });
   });
}

/**
 * Remove all entries that have the pull_request key set to something truthy
 */
function filterOutPulls(issues) {
   debug("Filtering out pulls from list of %s issues", issues.length);
   issues = _.filter(issues, function(issue) {
      return !issue.pull_request || !issue.pull_request.url;
   });
   debug("Filtered down to %s issues", issues.length);
   return issues;
}
