import { Octokit } from "@octokit/rest";
import { throttling } from "@octokit/plugin-throttling";
import config from "./config-loader.js";
import Promise from "bluebird";
import _ from "underscore";
import debug from "./debug.js";
import utils from "./utils.js";
import Pull from "../models/pull.js";
import Issue from "../models/issue.js";
import Comment from "../models/comment.js";
import Review from "../models/review.js";
import Label from "../models/label.js";
import Status from "../models/status.js";
import Signature from "../models/signature.js";
import getLogin from "./get-user-login.js";

const MyOctokit = Octokit.plugin(throttling);
const gitDebug = debug("pulldasher:github");

console.log(config.github);

const github = new MyOctokit({
  auth: config.github.token,
  throttle: {
    onRateLimit: (retryAfter, options) => {
      github.log.warn(
        `Request quota exhausted for request ${options.method} ${options.url}`
      );

      // Retry five times after hitting a rate limit error, then give up
      if (options.request.retryCount <= 5) {
        github.log.debug(`Retrying after ${retryAfter} seconds!`);
        return true;
      }
    },
    onSecondaryRateLimit: (retryAfter, options) => {
      // does not retry, only logs a warning
      github.log.warn(
        `SecondaryRateLimit detected for request ${options.method} ${options.url}`,
      );
    },
    onAbuseLimit: (retryAfter, options) => {
      // does not retry, only logs a warning
      github.log.warn(
        `Abuse detected for request ${options.method} ${options.url}`
      );
    },
  },
});

const githubRest = github.rest;

export default {
  github: githubRest,

  /**
   * Returns a promise which resolves to a GitHub API response to
   * a query for a particular Pull Request.
   */
  getPull: function (repo, number) {
    return logErrors(
      githubRest.pulls
        .get(params({ pull_number: number }, repo))
        .then((res) => res.data),
      "Getting pull %s",
      number
    );
  },

  /**
   * Get all *open* pull requests for a repo.
   *
   * Returns a promise which resolves to an array of all open pull requests
   */
  getOpenPulls: function (repo) {
    return logErrors(
      github.paginate(githubRest.pulls.list, params({ state: "open" }, repo)),
      "Getting open pulls in repo %s",
      repo
    );
  },

  /**
   * Get *all* pull requests for a repo.
   *
   * Returns a promise which resolves to an array of all pull requests
   */
  getAllPulls: function (repo) {
    return logErrors(
      github.paginate(githubRest.pulls.list, params({ state: "all" }, repo)),
      "Getting all pulls in repo %s",
      repo
    );
  },

  /**
   * Get an issue for a repo.
   *
   * Returns a promise which resolves to a github issue
   */
  getIssue,

  /**
   * Get all open issues for a repo.
   *
   * Returns a promise which resolves to an array of all open issues
   */
  getOpenIssues: function (repo) {
    const searchParams = params({ state: "open" }, repo);
    return logErrors(
      github
        .paginate(githubRest.issues.listForRepo, searchParams)
        .then(filterOutPulls)
        .then(addRepo(searchParams)),
      "Getting open issues in repo %s",
      repo
    );
  },

  /**
   * Get *all* issues for a repo.
   *
   * Returns a promise which resolves to an array of all issues
   */
  getAllIssues: function (repo) {
    const searchParams = params({ state: "all" }, repo);
    return logErrors(
      github
        .paginate(githubRest.issues.listForRepo, searchParams)
        .then(filterOutPulls)
        .then(addRepo(searchParams)),
      "Getting all issues in repo %s",
      repo
    );
  },

  /**
   * Takes a promise that resolves to a GitHub pull request API response,
   * parses it, and returns a promise that resolves to a Pull objects.
   */
  parse: function (githubPull) {
    gitDebug(
      "Getting all information for pull %s in repo %s",
      githubPull.number,
      githubPull.base.repo.full_name
    );
    // We've occasionally noticed a null pull body, so lets fix it upfront
    // before errors happen.
    githubPull.body = githubPull.body || "";

    var repo = githubPull.base.repo.full_name;

    var reviewComments = getPullReviewComments(repo, githubPull.number);
    var comments = getIssueComments(repo, githubPull.number);
    var headCommit = getCommit(repo, githubPull.head.sha);
    var commitStatuses = getCommitStatuses(repo, githubPull.head.sha);
    var jobRuns = getAllJobRuns(repo, githubPull.head.sha);
    var events = getIssueEvents(repo, githubPull.number);
    // Only so we have the canonical list of labels.
    var ghIssue = getIssue(repo, githubPull.number);
    var reviews = getReviews(repo, githubPull.number);

    // Returned to the map function. Each element of githubPulls maps to
    // a promise that resolves to a Pull.
    return Promise.all([
      reviewComments,
      comments,
      headCommit,
      commitStatuses,
      jobRuns,
      events,
      ghIssue,
      reviews,
    ]).then(function (results) {
      var reviewComments = results[0],
        comments = results[1],
        headCommit = results[2],
        commitStatuses = results[3],
        jobRuns = results[4],
        events = results[5],
        ghIssue = results[6],
        reviews = results[7];

      // Array of Signature objects.
      var commentSignatures = comments.reduce(function (sigs, comment) {
        var commentSigs = Signature.parseComment(
          comment,
          repo,
          githubPull.number
        );

        return sigs.concat(commentSigs);
      }, []);

      var signatures = reviews.reduce(function (sigs, review) {
        var reviewSigs = Signature.parseReview(review, repo, githubPull.number);

        return sigs.concat(reviewSigs);
      }, commentSignatures);

      // Signoffs from before the most recent commit are no longer active.
      var headCommitDate = new Date(headCommit.commit.committer.date);
      signatures.forEach(function (signature) {
        if (
          (signature.data.type === "CR" || signature.data.type === "QA") &&
          new Date(signature.data.created_at) < headCommitDate
        ) {
          signature.data.active = false;
        }
      });

      // Array of Comment objects.
      comments = comments.map(function (commentData) {
        commentData.number = githubPull.number;
        commentData.repo = repo;
        commentData.type = "issue";

        return new Comment(commentData);
      });

      // Array of Comment objects.
      comments = comments.concat(
        reviewComments.map(function (commentData) {
          commentData.number = githubPull.number;
          commentData.repo = repo;
          commentData.type = "review";

          return new Comment(commentData);
        })
      );

      reviews = reviews.map(function (reviewData) {
        reviewData.number = githubPull.number;
        reviewData.repo = repo;

        return new Review(reviewData);
      });

      let statuses = commitStatuses.map(function (commitStatus) {
        let state = commitStatus.state;
        let desc = commitStatus.description;
        let url = commitStatus.target_url;
        let context = commitStatus.context;

        return new Status({
          repo: repo,
          sha: githubPull.head.sha,
          state: state,
          description: desc,
          target_url: url,
          context: context,
          started_at: commitStatus.created_at,
          completed_at: state == "pending" ? null : commitStatus.updated_at,
        });
      });

      let checks = jobRuns.map(function (jobRun) {
        let state = utils.mapCheckToStatus(jobRun.conclusion || jobRun.status);
        let desc = state;
        let url = jobRun.html_url;
        let context = jobRun.name;

        return new Status({
          repo: repo,
          sha: githubPull.head.sha,
          state: state,
          description: desc,
          target_url: url,
          context: context,
          started_at: jobRun.started_at,
          completed_at: jobRun.completed_at,
        });
      });

      let allCommitStatuses = statuses.concat(checks);

      // Array of Label objects.
      const labels = getLabelsFromEvents(events, ghIssue);

      const pull = Pull.fromGithubApi(
        githubPull,
        signatures,
        comments,
        reviews,
        allCommitStatuses,
        labels
      );
      return pull.syncToIssue();
    });
  },

  /**
   * Takes a GitHub issue API response
   * parses it, and returns a promise that resolves to an Issue object.
   */
  parseIssue: function (ghIssue) {
    gitDebug(
      "Getting all information for issue %s in repo %s",
      ghIssue.number,
      ghIssue.repo
    );
    return getIssueEvents(ghIssue.repo, ghIssue.number).then(function (events) {
      // Array of Label objects.
      // Note: using the repo name from the config for now until we support
      // multiple repos. The ghIssue object doesn't contain the repo name.
      var labels = getLabelsFromEvents(events, ghIssue);

      return Issue.getFromGH(ghIssue, labels);
    });
  },
};

function getIssue(repo, number) {
  const searchParams = params({ issue_number: number }, repo);
  return logErrors(
    githubRest.issues
      .get(searchParams)
      .then((res) => res.data)
      .then(addRepo(searchParams)),
    "Getting issue %s in repo %s",
    number,
    repo
  );
}

/**
 * Get array of Label objects from complete list of a Issue's events.
 *
 * Note: ghIssue at this point has always come from one of the
 * get*Issues() commands and thus has been augmented with the
 * issue.repo property.
 */
function getLabelsFromEvents(events, ghIssue) {
  gitDebug(
    "Extracting label assignments from %s issue events for #%s",
    events.length,
    ghIssue.number
  );

  // Narrow list to relevant labeled/unlabeled events.
  events = _.filter(events, function (event) {
    return event.event === "labeled" || event.event === "unlabeled";
  });

  gitDebug("Found %s label events for #%s", events.length, ghIssue.number);

  // Build simple Event objects with all the info we care about.
  events = events.map(function (event) {
    return {
      type: event.event,
      name: event.label.name,
      user: getLogin(event.actor),
      created_at: utils.fromDateString(event.created_at),
    };
  });

  // Group label events by label name.
  var labels = _.groupBy(events, "name");

  // Get a list of the most recent events for each label.
  labels = _.map(labels, function (events) {
    events = _.sortBy(events, "created_at");
    return _.last(events);
  });

  labels = _.filter(labels, function (event) {
    return event.type === "labeled";
  });

  gitDebug("Found %s unique labels for #%s", labels.length, ghIssue.number);

  // If these are available, use them as the canonical source, only augmented
  // by the data from events. If a label is renamed, the events will retain
  // the old name but the list of labels on the issue itself will be correct.
  // So, if a label is renamed, we'll lose the labeler and the date.
  if (ghIssue.labels && ghIssue.labels.length) {
    gitDebug("Using %s labels from the github issue", ghIssue.labels.length);
    // Includes labeller and a time from the events api
    var eventLabels = _.indexBy(labels, "name");

    return ghIssue.labels.map(function (label) {
      var eventLabel = eventLabels[label.name];
      return new Label(
        { name: label.name },
        ghIssue.number,
        ghIssue.repo,
        eventLabel && eventLabel.user,
        eventLabel && eventLabel.created_at
      );
    });
  }

  // Construct Label objects.
  return labels.map(function (label) {
    return new Label(
      { name: label.name },
      ghIssue.number,
      ghIssue.repo,
      label.user,
      label.created_at
    );
  });
}

/**
 * Return the default api params merged with the overrides
 */
function params(apiParams, fullRepoName) {
  const [owner, repo] = parseRepo(fullRepoName);

  return _.extend(
    {
      owner,
      repo,
    },
    apiParams
  );
}

/**
 * Returns a function that uses the search parameters to add the "repo"
 * property to all the results. When we ask for a list of open issues from the
 * API for a particular repo, those results don't have references to the repo
 * we asked about, so we have to inject them to normalize the structure of the
 * object.
 */
function addRepo({ owner, repo }) {
  function addRepositoryField(ghIssue) {
    ghIssue.repo = owner + "/" + repo;
  }
  return function (results) {
    if (Array.isArray(results)) {
      results.forEach(addRepositoryField);
    } else {
      addRepositoryField(results);
    }
    return results;
  };
}

/**
 * Splits the repo into the owner and repo name.
 */
function parseRepo(repo) {
  return repo.split("/");
}

/**
 * Return a promise for all issue events for the given issue / pull
 */
function getIssueEvents(repo, number) {
  return logErrors(
    github.paginate(
      githubRest.issues.listEvents,
      params({ issue_number: number }, repo)
    ),
    "Getting events for issue %s:%s",
    repo,
    number
  );
}

function getIssueComments(repo, number) {
  return logErrors(
    github.paginate(
      githubRest.issues.listComments,
      params({ issue_number: number }, repo)
    ),
    "Getting comments for issue %s:%s",
    repo,
    number
  );
}

function getReviews(repo, number) {
  return logErrors(
    github.paginate(
      githubRest.pulls.listReviews,
      params({ pull_number: number }, repo)
    ),
    "Getting reviews for pull %s:%s",
    repo,
    number
  );
}

function getPullReviewComments(repo, number) {
  return logErrors(
    github.paginate(
      githubRest.pulls.listReviewComments,
      params({ pull_number: number }, repo)
    ),
    "Getting pull review comments for pull %s:%s",
    repo,
    number
  );
}

function getCommit(repo, sha) {
  return logErrors(
    githubRest.repos
      .getCommit(params({ ref: sha }, repo))
      .then((res) => res.data),
    "Getting commit for %s:%s",
    repo,
    sha
  );
}

function getCommitStatuses(repo, ref) {
  return logErrors(
    githubRest.repos
      .getCombinedStatusForRef(params({ ref }, repo))
      .then((res) => res.data.statuses)
      .then((statuses) => statuses || []),
    "Getting commit status for %s:%s",
    repo,
    ref
  );
}

function getAllJobRuns(repo, ref) {
  return logErrors(
    github
      .paginate(
        githubRest.actions.listWorkflowRunsForRepo,
        params(
          {
            head_sha: ref,
            exclude_pull_requests: true,
          },
          repo
        )
      )
      .then((runs) => Promise.all((runs || []).map(getJobRunsFromWorkflow)))
      .then((runs) => runs.flat(1)),
    "Getting workflow runs for %s:%s",
    repo,
    ref
  );
}

function getJobRunsFromWorkflow(workflowRun) {
  return logErrors(
    github
      .paginate(
        githubRest.actions.listJobsForWorkflowRun,
        params(
          {
            run_id: workflowRun.id,
          },
          workflowRun.repository.full_name
        )
      )
      .then((jobs) => jobs || []),
    "Getting jobs runs for %s:%s",
    workflowRun.repository.full_name,
    workflowRun.name
  );
}

/**
 * Remove all entries that have the pull_request key set to something truthy
 */
function filterOutPulls(issues) {
  gitDebug("Filtering out pulls from list of %s issues", issues.length);
  issues = _.filter(
    issues,
    (issue) => !issue.pull_request || !issue.pull_request.url
  );
  gitDebug("Filtered down to %s issues", issues.length);
  return issues;
}

function logErrors(promise, ...messageAndArgs) {
  gitDebug(...messageAndArgs);
  return promise.catch((err) => {
    messageAndArgs[0] = "Error: Failed while: " + messageAndArgs[0];
    gitDebug(...messageAndArgs);
    throw err;
  });
}
