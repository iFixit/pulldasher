import config from '../lib/config-loader.js';
import Promise from 'bluebird';
import debug from '../lib/debug.js';
import Pull from '../models/pull.js';
import Signature from '../models/signature.js';
import Comment from '../models/comment.js';
import Review from '../models/review.js';
import Status from '../models/status.js';
import Label from '../models/label.js';
import refresh from '../lib/refresh.js';
import queue from '../lib/pull-queue.js';
import getLogin from '../lib/get-user-login.js';
import utils from '../lib/utils.js';
import dbManager from '../lib/db-manager.js';
import git from '../lib/git-manager.js';

const hooksDebug = debug('pulldasher:hooks');

const HooksController = {
   main: function (req, res) {
      // Variable for promise that will resolve when the hook is known to have
      // succeeded or failed.
      var dbUpdated;
      var comment;

      var secret = req.query.secret;
      if (secret !== config.github.hook_secret) {
         var m = 'Invalid Hook Secret: ' + secret;
         hooksDebug(m);
         console.error(m);
         return res.status(401).send('Invalid POST');
      }

      // Begin the webhook decoding
      var body;
      if (req.headers['content-type'] === 'application/json') {
         body = req.body;
      } else if (req.headers['content-type'] === 'application/x-www-form-urlencoded') {
         body = JSON.parse(req.body.payload);
      } else {
         return res.status(400).send('Invalid content-type ' + req.headers['content-type']);
      }

      var event = req.get('X-GitHub-Event');
      hooksDebug('Received GitHub webhook, Event: %s, Action: %s', event, body.action);

      if (event === 'status') {
         const updatedStatus = new Status({
            repo: body.name,
            sha: body.sha,
            state: body.state,
            context: body.context,
            description: body.description,
            target_url: body.target_url,
            started_at: body.created_at,
            completed_at: body.state == 'pending' ? null : body.updated_at,
         });
         dbUpdated = dbManager.updateCommitStatus(updatedStatus);
      } else if (event === 'issues') {
         dbUpdated = handleIssueEvent(body);
      } else if (event === 'pull_request') {
         // Promise that resolves when everything that needs to be done before
         // we call `updatePull` has finished.
         var preUpdate = handleLabelEvents(body);
         // New commits may carry a GitHub approval over a clean master merge, so
         // after the cheap DB update we re-derive review state from GitHub.
         var reconcileAfterUpdate = false;

         switch (body.action) {
            case 'opened':
            case 'reopened':
            case 'closed':
            case 'edited':
            case 'merged':
               break;

            case 'review_requested':
            case 'review_request_removed':
               // These two actions alone carry `requested_reviewer` (the
               // login) and `sender` (who did it) -- fields the generic
               // pull_request payload below doesn't have -- so record the
               // precise at/self metadata directly, memory-only (no
               // review_requests column -- see models/pull.js), before the
               // generic `Pull.fromGithubApi(body.pull_request)` call reads
               // it back out.
               preUpdate = preUpdate.then(() => recordReviewRequestMetadata(body));
               break;

            case 'synchronize':
               // Clear prior CR/QA signoffs immediately for snappy feedback. Emoji
               // CR/QA stay cleared; a carried-over GitHub *approval* is restored by
               // the full refresh below (see Signature.parseReview / git-manager).
               preUpdate = dbManager.invalidateSignatures(
                  body.repository.full_name,
                  body.pull_request.number,
                  ['QA', 'CR']
               );
               reconcileAfterUpdate = true;
         }

         // Update DB with new pull request content.
         dbUpdated = preUpdate.then(function () {
            return dbManager.updatePull(Pull.fromGithubApi(body.pull_request));
         });

         if (reconcileAfterUpdate) {
            // A `synchronize` webhook never triggers a full refresh on its own,
            // and Pulldasher has no periodic poll, so re-derive review state from
            // GitHub once the cheap DB update lands to pick up an approval GitHub
            // kept across the new commit(s).
            //
            // Fire-and-forget, like every other refresh.pull caller below. Do NOT
            // fold it into `dbUpdated`: coupling the webhook's HTTP response to a
            // full, serialized refresh risks GitHub's 10s webhook timeout and
            // turns a transient refresh failure into a 500 + redelivery storm.
            dbUpdated.then(function () {
               refresh.pull(body.repository.full_name, body.pull_request.number);
            });
         }
      } else if (event === 'issue_comment') {
         if (body.action === 'created') {
            var promises = [];

            // Parse any signature(s) out of the comment.
            var sigs = Signature.parseComment(
               body.comment,
               body.repository.full_name,
               body.issue.number
            );
            promises.push(dbManager.insertSignatures(sigs));

            body.comment.number = body.issue.number;
            body.comment.repo = body.repository.full_name;
            body.comment.type = 'issue';
            comment = new Comment(body.comment);

            promises.push(dbManager.updateComment(comment));

            dbUpdated = Promise.all(promises);
         } else {
            // If the comment was edited or deleted, the easiest way to deal
            // with the result is to simply refresh all data for the pull (or
            // issue). Otherwise, we'd have to delete or update the comment,
            // delete or update any signatures tied to that comment, then
            // delete all signatures and re-insert in order them so the
            // dev_blocking and such comes out correct.
            refreshPullOrIssue(body);
         }
      } else if (event === 'pull_request_review') {
         if (body.action === 'submitted') {
            promises = [];

            // Parse any signature(s) out of the comment.
            sigs = Signature.parseReview(
               body.review,
               body.repository.full_name,
               body.pull_request.number
            );
            promises.push(dbManager.insertSignatures(sigs));

            body.review.number = body.pull_request.number;
            body.review.repo = body.repository.full_name;
            const review = new Review(body.review);

            promises.push(dbManager.updateReview(review));

            dbUpdated = Promise.all(promises);
         } else {
            // If the review was edited or deleted, the easiest way to deal
            // with the result is to simply refresh all data for the pull.
            // Otherwise, we'd have to delete or update the review, delete or
            // update any signatures tied to that review, then delete all
            // signatures and re-insert in order them so the dev_blocking and
            // such comes out correct.
            refreshPullOrIssue(body);
         }
      } else if (event === 'pull_request_review_comment') {
         if (body.action === 'deleted') {
            dbUpdated = dbManager.deleteReviewComment(body.repository.full_name, body.comment.id);
         } else {
            body.comment.number = body.pull_request.number;
            body.comment.repo = body.repository.full_name;
            body.comment.type = 'review';
            comment = new Comment(body.comment);

            dbUpdated = dbManager.updateComment(comment);
         }
      } else if (event === 'check_run') {
         const conclusion = body.check_run.conclusion || body.check_run.status;
         const state = utils.mapCheckToStatus(conclusion);

         const status = new Status({
            repo: body.repository.full_name,
            sha: body.check_run.head_sha,
            state: state,
            context: body.check_run.name,
            description: conclusion,
            target_url: body.check_run.html_url,
            started_at: body.check_run.started_at,
            completed_at: body.check_run.completed_at,
         });
         dbUpdated = dbManager.updateCommitStatus(status);
      }

      if (dbUpdated) {
         dbUpdated
            .then(
               function fulfilled() {
                  res.status(200).send('Success!');
               },
               function rejected(err) {
                  console.log(err);
                  res.status(500).send(err.toString());
               }
            )
            .done();
      } else {
         res.status(200).send('Success!');
      }
   },
};

function handleIssueEvent(body) {
   hooksDebug('Webhook action: %s for issue #%s', body.action, body.issue.number);

   var doneHandling = handleLabelEvents(body);

   // Always refresh from the API rather than upserting the webhook body
   // directly. The body is just a subset of the fields (and for pull requests,
   // not even an issue), and it carries no events, which we need to attribute
   // labels and to date the current assignment (date_assigned).
   // refreshPullOrIssue dispatches pull-vs-issue from the body itself.
   return doneHandling.then(function () {
      // Not returning here cause we don't want to delay replying to the
      // hook with a 200 since we know what needs to be done.
      refreshPullOrIssue(body);
   });
}

/**
 * Handles the response body if it represents a labeled / unlabled issue
 * (or pull) event and returns a promise that is fulfilled when the DB change
 * is committed.
 *
 * Note: will return a fulfilled promise if this is not a label event.
 */
function handleLabelEvents(body) {
   var object = body.pull_request || body.issue;
   switch (body.action) {
      case 'labeled':
         hooksDebug('Added label: %s', body.label.name);
         return dbManager
            .insertLabel(
               new Label(
                  body.label,
                  object.number,
                  body.repository.full_name,
                  getLogin(body.sender),
                  object.updated_at
               )
            )
            .then(markDirtyIfPull);

      case 'unlabeled':
         hooksDebug('Removed label: %s', body.label.name);
         return dbManager
            .deleteLabel(new Label(body.label, object.number, body.repository.full_name))
            .then(markDirtyIfPull);
   }
   return Promise.resolve();

   // A label change must broadcast on its own: the weight labels drive the
   // frontend's CR-weight display, and the only other thing that notifies
   // clients after a label event is an incidental updatePull call in the
   // pull_request handler — an easy thing for a refactor to scope away.
   function markDirtyIfPull() {
      if (body.pull_request) {
         queue.markPullAsDirty(body.repository.full_name, object.number);
      }
   }
}

/**
 * Record one `review_requested` / `review_request_removed` webhook's
 * metadata onto the in-memory review_requests cache (models/pull.js) --
 * memory-only, no DB write. `body.requested_reviewer` is absent for a team
 * review request, which Pulldasher doesn't track per-reviewer, so that's a
 * no-op.
 */
function recordReviewRequestMetadata(body) {
   const reviewer = body.requested_reviewer;
   if (!reviewer) {
      return Promise.resolve();
   }

   const repo = body.repository.full_name;
   const number = body.pull_request.number;
   const login = getLogin(reviewer);

   if (body.action === 'review_request_removed') {
      Pull.recordReviewRequestRemoved(repo, number, login);
      return Promise.resolve();
   }

   return git.getBotLogin().then(function (botLogin) {
      const senderLogin = getLogin(body.sender);
      Pull.recordReviewRequested(repo, number, login, {
         at: Math.floor(Date.now() / 1000),
         self: senderLogin === login || (Boolean(botLogin) && senderLogin === botLogin),
      });
   });
}

function refreshPullOrIssue(responseBody) {
   var repo = responseBody.repository.full_name;

   // The Docs: https://developer.github.com/v3/issues/#list-issues say you can
   // tell the difference like this:
   if (responseBody.pull_request) {
      refresh.pull(repo, responseBody.pull_request.number);
   } else if (responseBody.issue.pull_request) {
      refresh.pull(repo, responseBody.issue.number);
   } else {
      refresh.issue(repo, responseBody.issue.number);
   }
}

export default HooksController;
