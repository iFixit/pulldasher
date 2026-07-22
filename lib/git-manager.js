import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';
import { retry } from '@octokit/plugin-retry';
import config from './config-loader.js';
import Promise from 'bluebird';
import _ from 'underscore';
import debug from './debug.js';
import utils from './utils.js';
import Pull from '../models/pull.js';
import Issue from '../models/issue.js';
import Comment from '../models/comment.js';
import Review from '../models/review.js';
import Label from '../models/label.js';
import Status from '../models/status.js';
import Signature from '../models/signature.js';
import getLogin from './get-user-login.js';
import { noopPacer } from './pacer.js';

const MyOctokit = Octokit.plugin(throttling, retry);
const gitDebug = debug('pulldasher:github');

console.log(config.github);

const github = new MyOctokit({
   auth: config.github.token,
   // Auto-retry transient 5xx/network failures (the throttle plugin only covers
   // rate limits); the long bulk backfills make thousands of calls, so a single
   // transient error shouldn't abort the sweep before it can be reissued. Note:
   // the count goes under `retry`, not `request` — `request: { retries }` forces
   // retries on every status, bypassing plugin-retry's doNotRetry (4xx) list.
   retry: { retries: 5 },
   throttle: {
      onRateLimit: (retryAfter, options) => {
         github.log.warn(`Request quota exhausted for request ${options.method} ${options.url}`);

         // Retry five times after hitting a rate limit error, then give up
         if (options.request.retryCount <= 5) {
            github.log.debug(`Retrying after ${retryAfter} seconds!`);
            return true;
         }
      },
      onSecondaryRateLimit: (retryAfter, options) => {
         // does not retry, only logs a warning
         github.log.warn(
            `SecondaryRateLimit detected for request ${options.method} ${options.url}`
         );
      },
      onAbuseLimit: (retryAfter, options) => {
         // does not retry, only logs a warning
         github.log.warn(`Abuse detected for request ${options.method} ${options.url}`);
      },
   },
});

// plugin-retry retries transient 5xx/network errors silently (no log of its
// own), so a real blip during a long backfill would otherwise leave no trace.
// Surface those attempts under pulldasher:github. We only log transient errors
// (5xx / network) — the throttle plugin already logs 4xx rate limits — and
// rethrow untouched so plugin-retry's retry logic is unaffected.
github.hook.error('request', (error, options) => {
   const status = error.status;
   if (status === undefined || status >= 500) {
      gitDebug(
         'Transient request error on %s %s (status %s), attempt %s',
         options.method,
         options.url,
         status === undefined ? 'network' : status,
         (options.request.retryCount || 0) + 1
      );
   }
   throw error;
});

/**
 * Feed a pacer the quota headers from every GitHub response, so it can pace bulk
 * work against real consumption — crucially the per-pull/issue fan-out deep in
 * `parse`/`parseIssue`, which is the bulk of a backfill's spend and which the
 * caller can't see to observe itself. Only the CLI backfill bins call this (once
 * at startup, with their pacer); the server never installs an observer, so its
 * webhook/socket responses aren't tracked and nothing is paced.
 *
 * Installs the hooks at most once per process: they close over the first
 * pacer, and a second call would only stack duplicate observers on the shared
 * client (double-counting every response). The bins call this exactly once.
 */
let rateLimitObserved = false;
export function observeRateLimit(pacer) {
   if (rateLimitObserved) {
      return;
   }
   rateLimitObserved = true;
   github.hook.after('request', response => {
      pacer.observe(response.headers);
   });
   github.hook.error('request', error => {
      // A failed response still reports the current quota.
      pacer.observe(error.response && error.response.headers);
      throw error;
   });
}

// The login pulldasher's own API token authenticates as. Never changes for
// the life of the process, so fetched once via users.getAuthenticated and
// memoized -- every later caller (a full refresh deriving review_requests, a
// review_requested/removed webhook) reuses the same promise. Used to tell a
// pulldasher-initiated claim (requestReviewer/removeReviewer, made with this
// same token) apart from a login's own GitHub-UI self-request: both count as
// `self`, but only the latter has actor === requested reviewer.
let botLoginPromise = null;
export function getBotLogin() {
   if (!botLoginPromise) {
      botLoginPromise = logErrors(
         githubRest.users.getAuthenticated().then(res => getLogin(res.data)),
         'Getting the authenticated (bot) user'
      ).catch(err => {
         // A single bad lookup shouldn't wedge every later self/bot check --
         // fall back to null, which just makes deriveReviewRequests treat every
         // request as not-bot (self only via an actual self-request).
         gitDebug('Could not determine bot login: %s', (err && err.message) || err);
         return null;
      });
   }
   return botLoginPromise;
}

const githubRest = github.rest;

export default {
   github: githubRest,

   getBotLogin,

   /**
    * Returns a promise which resolves to a GitHub API response to
    * a query for a particular Pull Request.
    */
   getPull: function (repo, number) {
      return logErrors(
         githubRest.pulls.get(params({ pull_number: number }, repo)).then(res => res.data),
         'Getting pull %s',
         number
      );
   },

   /**
    * Get all *open* pull requests for a repo.
    *
    * Returns a promise which resolves to an array of all open pull requests
    */
   getOpenPulls: function (repo, pacer = noopPacer) {
      return logErrors(
         pacedPaginate(githubRest.pulls.list, params({ state: 'open' }, repo), pacer),
         'Getting open pulls in repo %s',
         repo
      );
   },

   /**
    * Get *all* pull requests for a repo.
    *
    * Returns a promise which resolves to an array of all pull requests
    */
   getAllPulls: function (repo, pacer = noopPacer) {
      return logErrors(
         pacedPaginate(githubRest.pulls.list, params({ state: 'all' }, repo), pacer),
         'Getting all pulls in repo %s',
         repo
      );
   },

   /**
    * Best-effort: request `login` as a reviewer on a pull. Fires as the bot
    * token — pulldasher keeps no per-user GitHub token — so GitHub records the
    * request as added by the app account, with `login` as the requested
    * reviewer. Never rejects: a claim must still succeed locally even when
    * GitHub refuses the request (422 when the claimer is the PR author, or when
    * the login can't be a reviewer on that repo). Returns a promise that always
    * resolves.
    */
   requestReviewer: function (repo, number, login) {
      if (!login) {
         return Promise.resolve();
      }
      return githubRest.pulls
         .requestReviewers(params({ pull_number: number, reviewers: [login] }, repo))
         .then(
            function () {
               gitDebug('Requested %s as reviewer on %s#%s', login, repo, number);
            },
            function (err) {
               gitDebug(
                  'Could not request %s as reviewer on %s#%s: %s',
                  login,
                  repo,
                  number,
                  (err && err.status) || (err && err.message) || err
               );
            }
         );
   },

   /**
    * Best-effort inverse of requestReviewer: drop `login`'s review request when
    * a claim is released, so passing on a dealt pull (or releasing a claim)
    * doesn't leave an orphan review request on GitHub. Never rejects — a "not
    * currently requested" response is expected and ignored.
    */
   removeReviewer: function (repo, number, login) {
      if (!login) {
         return Promise.resolve();
      }
      return githubRest.pulls
         .removeRequestedReviewers(params({ pull_number: number, reviewers: [login] }, repo))
         .then(
            function () {
               gitDebug('Removed %s review request on %s#%s', login, repo, number);
            },
            function (err) {
               gitDebug(
                  'Could not remove %s review request on %s#%s: %s',
                  login,
                  repo,
                  number,
                  (err && err.status) || (err && err.message) || err
               );
            }
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
   getOpenIssues: function (repo, pacer = noopPacer) {
      const searchParams = params({ state: 'open' }, repo);
      return logErrors(
         pacedPaginate(githubRest.issues.listForRepo, searchParams, pacer)
            .then(filterOutPulls)
            .then(addRepo(searchParams)),
         'Getting open issues in repo %s',
         repo
      );
   },

   /**
    * Get *all* issues for a repo.
    *
    * Returns a promise which resolves to an array of all issues
    */
   getAllIssues: function (repo, pacer = noopPacer) {
      const searchParams = params({ state: 'all' }, repo);
      return logErrors(
         pacedPaginate(githubRest.issues.listForRepo, searchParams, pacer)
            .then(filterOutPulls)
            .then(addRepo(searchParams)),
         'Getting all issues in repo %s',
         repo
      );
   },

   /**
    * Takes a promise that resolves to a GitHub pull request API response,
    * parses it, and returns a promise that resolves to a Pull objects.
    */
   parse: function (githubPull) {
      gitDebug(
         'Getting all information for pull %s in repo %s',
         githubPull.number,
         githubPull.base.repo.full_name
      );
      // We've occasionally noticed a null pull body, so lets fix it upfront
      // before errors happen.
      githubPull.body = githubPull.body || '';

      var repo = githubPull.base.repo.full_name;

      // pulls.list items carry no additions/deletions/changed_files — only
      // pulls.get and webhook payloads do — so the bulk open-pulls refresh
      // used to REPLACE good sizes with NULL and the board showed "size
      // unknown". When the stats are missing, fetch the full pull once and
      // graft them on; a payload that already has them costs nothing extra.
      var diffStats =
         githubPull.additions === undefined
            ? githubRest.pulls
                 .get(params({ pull_number: githubPull.number }, repo))
                 .then(res => res.data)
            : Promise.resolve(githubPull);

      var reviewComments = getPullReviewComments(repo, githubPull.number);
      var comments = getIssueComments(repo, githubPull.number);
      var headCommit = getCommit(repo, githubPull.head.sha);
      var commitStatuses = getCommitStatuses(repo, githubPull.head.sha);
      var jobRuns = getAllJobRuns(repo, githubPull.head.sha);
      var events = getIssueEvents(repo, githubPull.number);
      // Only so we have the canonical list of labels.
      var ghIssue = getIssue(repo, githubPull.number);
      var reviews = getReviews(repo, githubPull.number);
      // Resolved (and cached) once per process; threaded through so
      // deriveReviewRequests can tell a pulldasher claim apart from a
      // GitHub-UI self-request.
      var botLogin = getBotLogin();

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
         botLogin,
         diffStats,
      ]).then(function (results) {
         var reviewComments = results[0],
            comments = results[1],
            headCommit = results[2],
            commitStatuses = results[3],
            jobRuns = results[4],
            events = results[5],
            ghIssue = results[6],
            reviews = results[7],
            botLogin = results[8],
            fullPull = results[9];

         // graft the diff stats a list item lacks (see diffStats above)
         githubPull.additions = fullPull.additions;
         githubPull.deletions = fullPull.deletions;
         githubPull.changed_files = fullPull.changed_files;

         // Array of Signature objects.
         var commentSignatures = comments.reduce(function (sigs, comment) {
            var commentSigs = Signature.parseComment(comment, repo, githubPull.number);

            return sigs.concat(commentSigs);
         }, []);

         var signatures = reviews.reduce(function (sigs, review) {
            var reviewSigs = Signature.parseReview(review, repo, githubPull.number);

            return sigs.concat(reviewSigs);
         }, commentSignatures);

         // Signoffs from before the most recent commit are no longer active.
         //
         // Exception: a CR derived from a GitHub native "Approve" review. GitHub
         // carries an approval over a clean master merge (it dismisses the review
         // only when the diff actually changes), so its `submitted_at` legitimately
         // predates the merge commit. GitHub is the source of truth here: if the
         // review is still APPROVED at refresh time, parseReview synthesized this
         // signature, which means the approval is still valid. Re-applying the
         // commit-date check would drop approvals GitHub deliberately kept.
         var headCommitDate = new Date(headCommit.commit.committer.date);
         signatures.forEach(function (signature) {
            if (
               (signature.data.type === 'CR' || signature.data.type === 'QA') &&
               !signature.data.fromGithubApproval &&
               new Date(signature.data.created_at) < headCommitDate
            ) {
               signature.data.active = false;
            }
         });

         // Array of Comment objects.
         comments = comments.map(function (commentData) {
            commentData.number = githubPull.number;
            commentData.repo = repo;
            commentData.type = 'issue';

            return new Comment(commentData);
         });

         // Array of Comment objects.
         comments = comments.concat(
            reviewComments.map(function (commentData) {
               commentData.number = githubPull.number;
               commentData.repo = repo;
               commentData.type = 'review';

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
               completed_at: state == 'pending' ? null : commitStatus.updated_at,
            });
         });

         let checks = jobRuns.map(function (jobRun) {
            let conclusion = jobRun.conclusion || jobRun.status;
            let state = utils.mapCheckToStatus(conclusion);
            let desc = conclusion;
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

         // Array of { login, at, self }, one per current requested_reviewers
         // entry -- see deriveReviewRequests.
         const requestedReviewerLogins = (githubPull.requested_reviewers || []).map(getLogin);
         const reviewRequests = deriveReviewRequests(events, requestedReviewerLogins, botLogin);

         const pull = Pull.fromGithubApi(
            githubPull,
            signatures,
            comments,
            reviews,
            allCommitStatuses,
            labels,
            reviewRequests
         );
         return pull.syncToIssue();
      });
   },

   /**
    * Takes a GitHub issue API response
    * parses it, and returns a promise that resolves to an Issue object.
    */
   parseIssue: function (ghIssue) {
      gitDebug('Getting all information for issue %s in repo %s', ghIssue.number, ghIssue.repo);
      return getIssueEvents(ghIssue.repo, ghIssue.number).then(function (events) {
         // Array of Label objects.
         // Note: using the repo name from the config for now until we support
         // multiple repos. The ghIssue object doesn't contain the repo name.
         var labels = getLabelsFromEvents(events, ghIssue);

         // The issue object has no assignment timestamp; derive it from events.
         ghIssue.date_assigned = getAssignedDateFromEvents(events, ghIssue);

         return Issue.getFromGH(ghIssue, labels);
      });
   },
};

function getIssue(repo, number) {
   const searchParams = params({ issue_number: number }, repo);
   return logErrors(
      githubRest.issues
         .get(searchParams)
         .then(res => res.data)
         .then(addRepo(searchParams)),
      'Getting issue %s in repo %s',
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
      'Extracting label assignments from %s issue events for #%s',
      events.length,
      ghIssue.number
   );

   // Narrow list to relevant labeled/unlabeled events.
   events = _.filter(events, function (event) {
      return event.event === 'labeled' || event.event === 'unlabeled';
   });

   gitDebug('Found %s label events for #%s', events.length, ghIssue.number);

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
   var labels = _.groupBy(events, 'name');

   // Get a list of the most recent events for each label.
   labels = _.map(labels, function (events) {
      events = _.sortBy(events, 'created_at');
      return _.last(events);
   });

   labels = _.filter(labels, function (event) {
      return event.type === 'labeled';
   });

   gitDebug('Found %s unique labels for #%s', labels.length, ghIssue.number);

   // If these are available, use them as the canonical source, only augmented
   // by the data from events. If a label is renamed, the events will retain
   // the old name but the list of labels on the issue itself will be correct.
   // So, if a label is renamed, we'll lose the labeler and the date.
   if (ghIssue.labels && ghIssue.labels.length) {
      gitDebug('Using %s labels from the github issue', ghIssue.labels.length);
      // Includes labeller and a time from the events api
      var eventLabels = _.indexBy(labels, 'name');

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
 * Derive each currently-requested reviewer's `{ login, at, self }` from an
 * issue's raw events stream (the same stream getLabelsFromEvents reads via
 * issues.listEvents) -- no extra API calls. Walks the review_requested /
 * review_request_removed events in order and nets them out to who is
 * *currently* requested, each with when the request landed (epoch seconds)
 * and whether it was a claim.
 *
 * `requestedReviewerLogins` (the pull payload's own requested_reviewers) is
 * authoritative for WHO is currently requested -- the events only supply
 * when/how, and can be incomplete (GitHub caps how far back the events API
 * goes). A login in that list with no matching event still gets an entry,
 * just `{ at: null, self: false }`, per the wire contract.
 *
 * `self` is true when the request was made by the reviewer themself (a
 * GitHub-UI self-request) or by pulldasher's own bot account (a claim, made
 * via requestReviewer with the bot token) -- both read as "this reviewer
 * claimed the review" rather than someone else asking them to look at it.
 * `botLogin` is whatever getBotLogin() resolved to; null (lookup failed, or
 * hasn't resolved yet) just means the bot-request case never matches.
 */
export function deriveReviewRequests(events, requestedReviewerLogins, botLogin) {
   const relevant = _.filter(
      events,
      event => event.event === 'review_requested' || event.event === 'review_request_removed'
   );
   const ordered = _.sortBy(relevant, 'created_at');

   const activeByLogin = new Map();
   ordered.forEach(event => {
      // Team review requests have no individual reviewer to attribute this to.
      if (!event.requested_reviewer) {
         return;
      }
      const login = getLogin(event.requested_reviewer);
      if (event.event === 'review_request_removed') {
         activeByLogin.delete(login);
         return;
      }
      const actorLogin = getLogin(event.actor);
      activeByLogin.set(login, {
         login,
         at: Math.floor(utils.toUnixTime(event.created_at)),
         self: actorLogin === login || (Boolean(botLogin) && actorLogin === botLogin),
      });
   });

   return requestedReviewerLogins.map(
      login => activeByLogin.get(login) || { login, at: null, self: false }
   );
}

/**
 * Find when the issue's current assignee was assigned, from its events.
 *
 * The issue object carries the assignee but no assignment time, so we read it
 * from the most recent `assigned` event for that assignee. Returns the event's
 * raw `created_at` timestamp (normalized by `getFromGH`, like `closed_at`), or
 * null when the issue is unassigned or no matching event exists.
 */
function getAssignedDateFromEvents(events, ghIssue) {
   var assignee = ghIssue.assignee && ghIssue.assignee.login;
   if (!assignee) {
      return null;
   }

   var assignments = _.filter(events, function (event) {
      return event.event === 'assigned' && event.assignee && event.assignee.login === assignee;
   });

   var latest = _.last(_.sortBy(assignments, 'created_at'));
   return latest ? latest.created_at : null;
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
      ghIssue.repo = owner + '/' + repo;
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
   return repo.split('/');
}

/**
 * Return a promise for all issue events for the given issue / pull
 */
function getIssueEvents(repo, number) {
   return logErrors(
      github.paginate(githubRest.issues.listEvents, params({ issue_number: number }, repo)),
      'Getting events for issue %s:%s',
      repo,
      number
   );
}

function getIssueComments(repo, number) {
   return logErrors(
      github.paginate(githubRest.issues.listComments, params({ issue_number: number }, repo)),
      'Getting comments for issue %s:%s',
      repo,
      number
   );
}

function getReviews(repo, number) {
   return logErrors(
      github.paginate(githubRest.pulls.listReviews, params({ pull_number: number }, repo)),
      'Getting reviews for pull %s:%s',
      repo,
      number
   );
}

function getPullReviewComments(repo, number) {
   return logErrors(
      github.paginate(githubRest.pulls.listReviewComments, params({ pull_number: number }, repo)),
      'Getting pull review comments for pull %s:%s',
      repo,
      number
   );
}

function getCommit(repo, sha) {
   return logErrors(
      githubRest.repos.getCommit(params({ ref: sha }, repo)).then(res => res.data),
      'Getting commit for %s:%s',
      repo,
      sha
   );
}

function getCommitStatuses(repo, ref) {
   return logErrors(
      githubRest.repos
         .getCombinedStatusForRef(params({ ref }, repo))
         .then(res => res.data.statuses)
         .then(statuses => statuses || []),
      'Getting commit status for %s:%s',
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
         .then(runs => Promise.all((runs || []).map(getJobRunsFromWorkflow)))
         .then(runs => runs.flat(1)),
      'Getting workflow runs for %s:%s',
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
         .then(jobs => jobs || []),
      'Getting jobs runs for %s:%s',
      workflowRun.repository.full_name,
      workflowRun.name
   );
}

/**
 * Remove all entries that have the pull_request key set to something truthy
 */
function filterOutPulls(issues) {
   gitDebug('Filtering out pulls from list of %s issues', issues.length);
   issues = _.filter(issues, issue => !issue.pull_request || !issue.pull_request.url);
   gitDebug('Filtered down to %s issues', issues.length);
   return issues;
}

function logErrors(promise, ...messageAndArgs) {
   gitDebug(...messageAndArgs);
   return promise.catch(err => {
      messageAndArgs[0] = 'Error: Failed while: ' + messageAndArgs[0];
      gitDebug(...messageAndArgs);
      throw err;
   });
}

/**
 * Paginate a bulk listing, pacing between pages so a full-repo list can't burst
 * through the quota. Page one fetches un-paced and seeds the pacer's quota view
 * (the bin's observeRateLimit hook records each response); each `gate()` then
 * spaces the fetch of the next page. The gate fronts a fetch, so it only runs
 * when another page follows — gating after the last page would delay the result
 * (or, below the reserve floor, pause for a full reset window) with no fetch
 * left to pace. The `pacer` is injected by the caller — the CLI backfill bins
 * pass a real one; everything else takes the default no-op, so the pages fetch
 * unpaced (the server's startup open-pulls listing, and the live webhook/socket
 * path, which never lists whole repos anyway).
 */
async function pacedPaginate(route, parameters, pacer = noopPacer) {
   const items = [];
   for await (const response of github.paginate.iterator(route, parameters)) {
      items.push(...response.data);
      if (hasNextPage(response)) {
         await pacer.gate();
      }
   }
   return items;
}

/**
 * Whether a paginated response links to a further page — the same `rel="next"`
 * Link-header signal Octokit's own iterator uses to decide whether to continue.
 */
function hasNextPage(response) {
   const link = response.headers && response.headers.link;
   return Boolean(link) && link.includes('rel="next"');
}
