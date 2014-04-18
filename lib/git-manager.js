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
    * Return a promise for an array of all open pulls.
    */
   getAllPulls: function() {
      var getAllPulls = Promise.denodeify(github.pullRequests.getAll);

      return new Promise(function(resolve, reject) {
         getAllPulls({user: config.repo.owner, repo: config.repo.name}).then(
         function(githubPulls) {

            // For each open pull get all the issue comments and the head commit
            githubPulls.forEach(function(pullData) {

               Promise.all([module.exports.getPullComments(pullData.number),
                module.exports.getCommit(pullData.head.sha)])
                .then(function(responses) {

                   var pull = new Pull(pullData, responses[0], responses[1]);
                  pullDoneBuilding(pull);
               });

            });

            var pulls = [];
            function pullDoneBuilding(pull) {
               pulls.push(pull);
               // Once all the pulls are created, resolve the promise.
               if (pulls.length == githubPulls.length)
               {
                  resolve(pulls);
               }
            }
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
