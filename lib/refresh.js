var gitManager = require('./git-manager');
var Issue = require('../models/issue');
var queue = require('./pull-queue.js');
var dbManager = require('./db-manager');

var NotifyQueue = require('notify-queue');
var debug = require('debug')('pulldasher:refresh');
var Promise = require('promise');

// Queues for making all refreshes be synchronous, one at a time.
var issueQueue = new NotifyQueue();
var pullQueue  = new NotifyQueue();

module.exports = {
   ///////   Issues   /////////

   issue: function refreshIssue(number) {
      debug("refresh issue %s", number);
      return gitManager.getIssue(number)
      .then(pushOnQueue(issueQueue));
   },

   allIssues: function refreshOpenIssues() {
      debug("refresh all issues");
      return gitManager.getAllIssues()
      .then(pushAllOnQueue(issueQueue));
   },

   openIssues: function refreshOpenIssues() {
      debug("refresh all open issues");
      return gitManager.getOpenIssues()
      .then(pushAllOnQueue(issueQueue));
   },


   ///////   Pulls   /////////

   pull: function refreshPull(number) {
      debug("refresh pull %s", number);
      return gitManager.getPull(number)
      .then(pushOnQueue(pullQueue));
   },

   allPulls: function refreshOpenPulls() {
      debug("refresh all pull");
      return gitManager.getAllPulls()
      .then(pushAllOnQueue(pullQueue));
   },

   openPulls: function refreshOpenPulls() {
      debug("refresh all open pulls");
      return gitManager.getOpenPulls()
      .then(pushAllOnQueue(pullQueue));
   }
};

/**
 * Returns a function that will:
 *    push its first argument to the sppecified Queue
 *    and return a promise that is fulfilled when the item is fully processed.
 */
function pushOnQueue(queue) {
   return function(githubResponse) {
      queue.push(githubResponse);
      return new Promise(function(resolve, reject) {
         queue.push(resolve);
      });
   };
}

/**
 * Returns a function that will:
 *    push all the entries in the array (first argument) to the sppecified
 *    Queue and return a promise that is fulfilled when the items are fully
 *    processed.
 */
function pushAllOnQueue(queue) {
   return function (githubResponses) {
      return new Promise(function(resolve) {
         githubResponses.forEach(function(githubResponse) {
            queue.push(githubResponse);
         });
         queue.push(resolve);
      });
   };
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

pullQueue.pop(function(githubPull, next) {
   // Allow callers to push functions on the queue to signal when an item has
   // made it through
   if (typeof githubPull === 'function') {
      return githubPull();
   }
   debug("refreshing pull %s", githubPull.number);
   gitManager.parse(githubPull)
   .then(dbManager.updateAllPullData)
   .done(function() {
      debug("done refreshing pull %s", githubPull.number);
      next();
   });
});
