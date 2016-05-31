var gitManager = require('./git-manager');
var Issue = require('../models/issue');
var queue = require('./pull-queue.js');
var dbManager = require('./db-manager');

var NotifyQueue = require('notify-queue');
var debug = require('debug')('pulldasher:refresh');
var Promise = require('promise');

var issueQueue = new NotifyQueue();

module.exports = {
   issue: function refreshIssue(number) {
      debug("refresh issue %s", number);
      return gitManager.getIssue(number)
      .then(function(githubIssue) {
         debug("Got issue %s", number);
         issueQueue.push(githubIssue);
         // Return a promise that is fulfilled when the issue is fully
         // refreshed
         return new Promise(function(resolve, reject) {
            issueQueue.push(resolve);
         });
      });
   },

   allIssues: function refreshOpenIssues() {
      debug("refresh all issues");
      return gitManager.getAllIssues()
      .then(queueIssues);
   },

   openIssues: function refreshOpenIssues() {
      debug("refresh all open issues");
      return gitManager.getOpenIssues()
      .then(queueIssues);
   }
}

function queueIssues(githubIssues) {
   // Return a promise that is fulfilled when the issue is fully
   // refreshed
   return new Promise(function(resolve) {
      githubIssues.forEach(function(githubIssue) {
         issueQueue.push(githubIssue);
      });
      issueQueue.push(resolve);
   });
}

issueQueue.pop(function(githubIssue, next) {
   // Allow callers to push functions on the queue to signal when an item has
   // made it through
   if (typeof githubIssue === 'function') {
      return githubIssue();
   }
   debug("refreshing issue %s", githubIssue.number);
   Issue.getFromGH(githubIssue)
   .then(dbManager.updateIssue)
   .done(function() {
      debug("done refreshing issue %s", githubIssue.number);
      next();
   });
});
