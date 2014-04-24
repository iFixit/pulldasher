var GithubApi = require('github'),
    config = require('../config'),
    Promise = require('promise'),
    github = new GithubApi({
      debug: config.debug,
      version: '3.0.0'
    }),
    Pull = require('../models/pull');

github.authenticate({
   type: 'oauth',
   token: config.github.token
});

module.exports = {
   github: github,

   /**
    * Returns an array of promises--each promise resolves to a Pull.
    */
   getAllPulls: function() {
      var getAllPulls = Promise.denodeify(github.pullRequests.getAll);

      // promise -> array of github data for each pull
      var githubPullsPromise = getAllPulls({user: config.repo.owner, repo: config.repo.name});

      return githubPullsPromise.then(function(githubPulls) {

         return githubPulls.map(function(githubPull) {
            // Comments is in [0] and commit is in [1]
            var commentsAndHeadCommitPromise =
               Promise.all([module.exports.getPullComments(githubPull.number),
               module.exports.getCommit(githubPull.head.sha)]);

            // returned to the map function
            // each element of githubPulls maps to a promise for a Pull
            return commentsAndHeadCommitPromise.then(function (commentsAndHeadCommit) {
               var comments = commentsAndHeadCommit[0];
               var headCommit = commentsAndHeadCommit[1];
               return new Pull(githubPull, comments, headCommit);
            });
         });
      });
   },

   getPullComments: function getPullComments(pullNumber) {
      // "issue" comments are the comments on the pull (issue) itself.
      var getPullComments = Promise.denodeify(github.issues.getComments);
      return getPullComments({
         user: config.repo.owner,
         repo: config.repo.name,
         number: pullNumber
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
            }
            else {
               reject();
            }
         });
      });
   }
};
