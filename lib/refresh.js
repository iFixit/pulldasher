import gitManager from "./git-manager.js";
import dbManager from "./db-manager.js";
import utils from "./utils.js";
import NotifyQueue from "notify-queue";
import debug from "./debug.js";
import Promise from "bluebird";

// Queues for making all refreshes be synchronous, one at a time.
var issueQueue = new NotifyQueue();
var pullQueue = new NotifyQueue();

const refreshDebug = debug("pulldasher:refresh");

export default {
  ///////   Issues   /////////

  issue: function refreshIssue(repo, number) {
    refreshDebug("refresh issue %s", number);
    return gitManager.getIssue(repo, number).then(pushOnQueue(issueQueue));
  },

  allIssues: function refreshOpenIssues() {
    refreshDebug("refresh all issues");
    return utils
      .forEachRepo(gitManager.getAllIssues)
      .then(pushAllOnQueue(issueQueue));
  },

  openIssues: function refreshOpenIssues() {
    refreshDebug("refresh all open issues");
    return utils
      .forEachRepo(gitManager.getOpenIssues)
      .then(pushAllOnQueue(issueQueue));
  },

  ///////   Pulls   /////////

  pull: function refreshPull(repo, number) {
    refreshDebug("refresh pull %s", number);
    return gitManager.getPull(repo, number).then(pushOnQueue(pullQueue));
  },

  allPulls: function refreshAllPulls() {
    refreshDebug("refresh all pull");
    return utils
      .forEachRepo(gitManager.getAllPulls)
      .then(pushAllOnQueue(pullQueue));
  },

  openPulls: function refreshOpenPulls() {
    refreshDebug("refresh all open pulls");
    return utils
      .forEachRepo(gitManager.getOpenPulls)
      .then(pushAllOnQueue(pullQueue));
  },
};

/**
 * Returns a function that will:
 *    push its first argument to the specified Queue
 *    and return a promise that is fulfilled when the item is fully processed.
 */
function pushOnQueue(queue) {
  return function (githubResponse) {
    queue.push(githubResponse);
    return new Promise(function (resolve) {
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
    return new Promise(function (resolve) {
      githubResponses.forEach(function (githubResponse) {
        queue.push(githubResponse);
      });
      queue.push(resolve);
    });
  };
}

issueQueue.pop(function (githubIssue, next) {
  // Allow callers to push functions on the queue to signal when an item has
  // made it through
  if (typeof githubIssue === "function") {
    githubIssue();
    return next();
  }
  refreshDebug("refreshing issue %s", githubIssue.number);
  gitManager
    .parseIssue(githubIssue)
    .then(dbManager.updateAllIssueData)
    .done(function () {
      refreshDebug(
        "done refreshing issue %s in repo %s",
        githubIssue.number,
        githubIssue.repo
      );
      next();
    });
});

pullQueue.pop(function (githubPull, next) {
  // Allow callers to push functions on the queue to signal when an item has
  // made it through
  if (typeof githubPull === "function") {
    githubPull();
    return next();
  }
  refreshDebug(
    "refreshing pull %s in repo %s",
    githubPull.number,
    githubPull.base.repo.full_name
  );
  gitManager
    .parse(githubPull)
    .then(dbManager.updateAllPullData)
    .done(function () {
      refreshDebug("done refreshing pull %s", githubPull.number);
      next();
    });
});
