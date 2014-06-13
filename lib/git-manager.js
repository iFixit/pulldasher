var GithubApi = require('github'),
    config = require('../config'),
    Promise = require('promise'),
    github = new GithubApi({
      debug: config.debug,
      version: '3.0.0'
    }),
    Pull = require('../models/pull'),
    Signature = require('../models/signature');

github.authenticate({
   type: 'oauth',
   token: config.github.token
});

module.exports = {
   github: github,

   /**
    * Return a promise which resolves to an array of promises.
    * Each promise in the array resolves to a Pull.
    */
   getAllPulls: function() {
      var getAllPulls = Promise.denodeify(github.pullRequests.getAll);

      // promise -> array of github data for each pull
      var githubPullsPromise = getAllPulls({user: config.repo.owner, repo: config.repo.name});

      return githubPullsPromise.then(function(githubPulls) {
         return githubPulls.map(function(githubPull) {
            var comments = module.exports.getPullComments(githubPull.number);
            var headCommit = module.exports.getCommit(githubPull.head.sha);

            // Returned to the map function. Each element of githubPulls maps to
            // a promise that resolves to a Pull.
            return Promise.all([comments, headCommit]).then(function(results) {
               comments = results[0];
               headCommit = results[1];

               var signatures = comments.reduce(function(sigs, comment) {
                  return sigs.concat(Signature.parseComment(comment, githubPull.number));
               }, []);

               return new Pull(githubPull, signatures, headCommit);
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
            } else {
               reject();
            }
         });
      });
   }
};
