var GithubApi = require('github'),
    config = require('../config'),
    Promise = require('promise'),
    _ = require('underscore'),
    github = new GithubApi({
      debug: config.debug,
      version: '3.0.0'
    }),
    Pull = require('../models/pull'),
    Issue = require('../models/issue'),
    Comment = require('../models/comment'),
    Label = require('../models/label'),
    Status = require('../models/status'),
    Signature = require('../models/signature')
    rateLimit = require('./rate-limit.js');

github.authenticate({
   type: 'oauth',
   token: config.github.token
});

function denodeify(func) {
   return rateLimit(Promise.denodeify(func));
}

var get                    = denodeify(github.pullRequests.get);
var getAll                 = denodeify(github.pullRequests.getAll);
var getAllIssues           = denodeify(github.issues.repoIssues);
var getPullEvents          = denodeify(github.issues.getEvents);
// "issue" comments are the comments on the pull (issue) itself.
var getPullComments        = denodeify(github.issues.getComments);
// "review" comments are the comments on the diff of the pull
var getPullReviewComments  = denodeify(github.pullRequests.getComments);
var getCommit              = denodeify(github.repos.getCommits);
var getCommitStatus        = denodeify(github.statuses.get);
var getNextPage            = denodeify(github.getNextPage.bind(github));

module.exports = {
   github: github,

   /**
    * Returns a promise which resolves to a GitHub API response to
    * a query for a particular Pull Request.
    */
   getPull: function(number) {
      return get(params({
         number:     number
      }));
   },

   /**
    * Get all *open* pull requests for a repo.
    *
    * Returns a promise which resolves to an array of all open pull requests
    */
   getOpenPulls: function() {
      return getAll(params()).then(getAllPages);
   },

   /**
    * Get *all* pull requests for a repo.
    *
    * Returns a promise which resolves to an array of all pull requests
    */
   getAllPulls: function() {
      return getAll(params({
         state:      'all'
      })).then(getAllPages);
   },

   /**
    * Get *all* issues for a repo.
    *
    * Returns a promise which resolves to an array of all issues
    */
   getAllIssues: function() {
      return getAllIssues(params({
         state:      'all'
      })).then(getAllPages);
   },

   /**
    * Takes a promise that resolves to a GitHub pull request API response,
    * parses it, and returns a promise that resolves to a Pull objects.
    */
   parse: function(githubPull) {
      // We've occasionally noticed a null pull body, so lets fix it upfront
      // before errors happen.
      githubPull.body = githubPull.body || '';

      var reviewComments = module.exports.getPullReviewComments(githubPull.number);
      var comments = module.exports.getPullComments(githubPull.number);
      var headCommit = module.exports.getCommit(githubPull.head.sha);
      var commitStatus = module.exports.getCommitStatus(githubPull.head.sha);
      var events = module.exports.getPullEvents(githubPull.number);

      // Returned to the map function. Each element of githubPulls maps to
      // a promise that resolves to a Pull.
      return Promise.all([reviewComments, comments, headCommit, commitStatus, events])
       .then(function(results) {
         var reviewComments = results[0],
             comments       = results[1],
             headCommit     = results[2],
             commitStatus   = results[3],
             events         = results[4];

         // Array of Signature objects.
         var signatures = comments.reduce(function(sigs, comment) {
            var commentSigs = Signature.parseComment(comment, githubPull.number);

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
            commentData.repo = githubPull.base.repo.name;
            commentData.type = 'issue';

            return new Comment(commentData);
         });

         // Array of Comment objects.
         comments = comments.concat(reviewComments.map(function(commentData) {
            commentData.number = githubPull.number;
            commentData.repo = githubPull.base.repo.name;
            commentData.type = 'review';

            return new Comment(commentData);
         }));

         // Status object.
         var status = null;
         if (commitStatus) {
            status = new Status({
               sha:           githubPull.head.sha,
               state:         commitStatus.state,
               description:   commitStatus.description,
               target_url:    commitStatus.target_url
            });
         }

         // Array of Label objects.
         var labels = getLabelsFromEvents(events, githubPull);

         return new Pull(githubPull, signatures, comments, status, labels);
      });
   },

   parseIssue: function(githubIssue) {
      return Issue.getFromGH(githubIssue);
   },

   getPullEvents: function(pullNumber) {
      return getPullEvents(params({
         number: pullNumber
      })).then(getAllPages);
   },

   getPullComments: function(pullNumber) {
      return getPullComments(params({
         number: pullNumber
      })).then(getAllPages);
   },

   getPullReviewComments: function(pullNumber) {
      return getPullReviewComments(params({
         number: pullNumber
      })).then(getAllPages);
   },

   getCommit: function(sha) {
      return new Promise(function (resolve, reject){
         getCommit(params({
            sha: sha,
            per_page: 1
         })).then(function(commits) {
            if (commits.length === 1) {
               resolve(commits[0]);
            } else {
               return reject();
            }
         });
      });
   },
   getCommitStatus: function(sha) {
      return new Promise(function(resolve, reject) {
         getCommitStatus(params({
            sha: sha
         })).then(function(status) {
            if (status.length) {
               resolve(status[0]);
            } else {
               resolve(null);
            }
         });
      });
   },
};

/**
 * Traverses github's pagination to retrieve *all* the records.
 * Takes in the first page of results and returns a promise for *all* the
 * results.
 */
function getAllPages(currentPage, allResults) {
   return new Promise(function (resolve, reject) {
      allResults = allResults || [];
      allResults.push(currentPage);

      if (!github.hasNextPage(currentPage)) {
         return resolve(_.flatten(allResults));
      }

      resolve(getNextPage(currentPage).then(function (nextPage) {
         return getAllPages(nextPage, allResults);
      }));
   });
}

/**
 * Get array of Label objects from complete list of a Pull Request's events.
 */
function getLabelsFromEvents(events, githubPull) {
   // Narrow list to relevant labeled/unlabeled events.
   events = _.filter(events, function(event) {
      return event.event === 'labeled' || event.event === 'unlabeled';
   });

   // Build simple Event objects with all the info we care about.
   events = events.map(function(event) {
      return {
         type: event.event,
         name: event.label.name,
         number: githubPull.number,
         repo_name: githubPull.base.repo.name,
         user: event.actor.login,
         created_at: new Date(event.created_at)
      };
   });

   // Group label events by label name.
   var labels = _.groupBy(events, 'name');

   // Get a list of the most recent events for each label.
   labels = _.map(labels, function(events) {
      events = _.sortBy(events, 'time');
      return _.last(events);
   });

   labels = _.filter(labels, function(event) {
      return event.type === 'labeled';
   });

   // Construct Label objects.
   return labels.map(function(label) {
      return new Label(
         {name: label.name},
         label.number,
         label.repo_name,
         label.user,
         label.created_at
      );
   });
}

/**
 * Return the default api params merged with the overrides
 */
function params(apiParams) {
   return _.extend({
      user:       config.repo.owner,
      repo:       config.repo.name,
      per_page:   100,
   }, apiParams);
}
