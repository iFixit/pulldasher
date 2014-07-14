var GithubApi = require('github'),
    config = require('../config'),
    Promise = require('promise'),
    github = new GithubApi({
      debug: config.debug,
      version: '3.0.0'
    }),
    Pull = require('../models/pull'),
    Comment = require('../models/comment'),
    Status = require('../models/status'),
    Signature = require('../models/signature');

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
   getPull: function(number) {
      var getPull = Promise.denodeify(github.pullRequests.get);
      return getPull({
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
      var getAllPulls = Promise.denodeify(github.pullRequests.getAll);
      return getAllPulls({
         user:       config.repo.owner,
         repo:       config.repo.name,
         per_page:   config.repo.numPulls
      });
   },

   /**
    * Takes a promise that resolves to a GitHub pull request API response,
    * parses it, and returns a promise that resolves to a Pull objects.
    */
   parse: function(githubPull) {
      var comments = module.exports.getPullComments(githubPull.number);
      var headCommit = module.exports.getCommit(githubPull.head.sha);
      var commitStatus = module.exports.getCommitStatus(githubPull.head.sha);

      // Returned to the map function. Each element of githubPulls maps to
      // a promise that resolves to a Pull.
      return Promise.all([comments, headCommit, commitStatus]).then(function(results) {
         comments = results[0];
         headCommit = results[1];
         commitStatus = results[2];

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
         var comments = comments.map(function(commentData) {
            commentData.number = githubPull.number;
            commentData.repo = githubPull.base.repo.name;

            return new Comment(commentData);
         });

         var status = null;
         if (commitStatus) {
            status = new Status({
               sha:           githubPull.head.sha,
               state:         commitStatus.state,
               description:   commitStatus.description,
               target_url:    commitStatus.target_url
            });
         }

         return new Pull(githubPull, signatures, comments, status);
      });
   },

   getPullComments: function getPullComments(pullNumber) {
      // "issue" comments are the comments on the pull (issue) itself.
      var getPullComments = Promise.denodeify(github.issues.getComments);
      return getPullComments({
         user: config.repo.owner,
         repo: config.repo.name,
         number: pullNumber,
         per_page: config.repo.numComments
      });
   },
   getCommit: function getCommit(sha) {
      var getCommit = Promise.denodeify(github.repos.getCommits);
      return new Promise(function (resolve, reject){
         getCommit({
            user: config.repo.owner,
            repo: config.repo.name,
            sha: sha,
            per_page: 1
         }).then(function(commits) {
            if (commits.length == 1) {
               resolve(commits[0]);
            } else {
               reject();
            }
         });
      });
   },
   getCommitStatus: function getCommitStatus(sha) {
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
   }
};
