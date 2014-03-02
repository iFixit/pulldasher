var GithubApi = require('github'),
    config = require('../config'),
    Promise = require('promise'),
    github = new GithubApi({
      debug: config.debug,
      version: '3.0.0'
    });

github.authenticate({
   type: 'oauth',
   token: config.github.token
});

module.exports = {
   github: github,
   getAllPulls: function() {
      var getAllPulls = Promise.denodeify(github.pullRequests.getAll);
      return getAllPulls({ user: config.repo.owner, repo: config.repo.name });
   }
};
