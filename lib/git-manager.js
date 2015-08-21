var GithubApi = require('github'),
    config = require('../config'),
    Promise = require('promise'),
    _ = require('underscore'),
    github = new GithubApi({
      debug: config.debug,
      version: '3.0.0'
    }),
    getNextPage = Promise.denodeify(github.getNextPage.bind(github)),
    Pull = require('../models/pull'),
    Comment = require('../models/comment'),
    Label = require('../models/label'),
    Status = require('../models/status'),
    Signature = require('../models/signature');

github.authenticate({
   type: 'oauth',
   token: config.github.token
});

var get    = Promise.denodeify(github.pullRequests.get);
var getAll = Promise.denodeify(github.pullRequests.getAll);

module.exports = {
   github: github,

   /**
    * Returns a promise which resolves to a GitHub API response to
    * a query for a particular Pull Request.
    */
   getPull: function(number) {
      return get({
         user:       config.repo.owner,
         repo:       config.repo.name,
         number:     number
      });
   },

   /**
    * Returns a promise which resolves to an array of promises. Each promise
    * in the array resolves to GitHub's API response for a Pull Request.
    */
   getAllPulls: function() {
      return getAll({
         user:       config.repo.owner,
         repo:       config.repo.name
      }).then(getAllPages);
   },

   /**
    * Takes a promise that resolves to a GitHub pull request API response,
    * parses it, and returns a promise that resolves to a Pull objects.
    */
   parse: function(githubPull) {
      var comments = module.exports.getPullComments(githubPull.number);
      var headCommit = module.exports.getCommit(githubPull.head.sha);
      var commitStatus = module.exports.getCommitStatus(githubPull.head.sha);
      var events = module.exports.getPullEvents(githubPull.number);

      // Returned to the map function. Each element of githubPulls maps to
      // a promise that resolves to a Pull.
      return Promise.all([comments, headCommit, commitStatus, events])
       .then(function(results) {
         var comments = results[0],
             headCommit = results[1],
             commitStatus = results[2],
             events = results[3];

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

            return new Comment(commentData);
         });

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

   getPullEvents: function(pullNumber) {
      var getPullEvents = Promise.denodeify(github.issues.getEvents);
      return getPullEvents({
         user: config.repo.owner,
         repo: config.repo.name,
         number: pullNumber
      }).then(getAllPages);
   },

   getPullComments: function(pullNumber) {
      // "issue" comments are the comments on the pull (issue) itself.
      var getPullComments = Promise.denodeify(github.issues.getComments);
      return getPullComments({
         user: config.repo.owner,
         repo: config.repo.name,
         number: pullNumber
      }).then(getAllPages);
   },
   getCommit: function(sha) {
      var getCommit = Promise.denodeify(github.repos.getCommits);
      return new Promise(function (resolve, reject){
         getCommit({
            user: config.repo.owner,
            repo: config.repo.name,
            sha: sha,
            per_page: 1
         }).then(function(commits) {
            if (commits.length === 1) {
               resolve(commits[0]);
            } else {
               return reject();
            }
         });
      });
   },
   getCommitStatus: function(sha) {
      var getCommitStatus = Promise.denodeify(github.statuses.get);
      return new Promise(function(resolve, reject) {
         getCommitStatus({
            user: config.repo.owner,
            repo: config.repo.name,
            sha: sha
         }).then(function(status) {
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
