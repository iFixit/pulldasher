var _ = require('underscore'),
    debug = require('./debug')('pulldasher:db-manager'),
    utils = require('./utils'),
    Promise = require('bluebird'),
    db = require('../lib/db'),
    DBIssue = require('../models/db_issue'),
    DBStatus = require('../models/db_status'),
    DBSignature = require('../models/db_signature'),
    DBComment = require('../models/db_comment'),
    DBReview = require('../models/db_review'),
    DBLabel = require('../models/db_label'),
    Pull = require('../models/pull'),
    Issue = require('../models/issue'),
    Status = require('../models/status'),
    Signature = require('../models/signature'),
    Comment = require('../models/comment'),
    Review = require('../models/review'),
    Label = require('../models/label'),
    queue = require('../lib/pull-queue');

var dbManager = module.exports = {

   /**
    * Takes a Pull object and returns a promise that resolves when the db and
    * client have been updated with the new pull data.
    */
   updatePull: function(pull) {
      return pull.update();
   },

   /**
    * Takes in a Pull object, deletes, then resaves the pull and *all* the
    * related data (comments, commit statuses, signatures) and returns a
    * Promise that resolves when it's completed.
    *
    * Note: pauses the pull queue while it's happening so we dont' send
    * hundreds of updates to the client.
    */
   updateAllPullData: function updateAllPullData(pull) {
      queue.pause();
      return dbManager.updatePull(pull).then(function() {
         var updates = [];

         if (pull.commitStatuses) {
            pull.commitStatuses.forEach(status => {
               updates.push(dbManager.updateCommitStatus(status));
            });
         }

         updates.push(
            // Delete all signatures related to this pull from the DB
            // before we rewrite them to avoid duplicates.
            dbManager.deleteSignatures(pull.data.repo, pull.data.number).then(function() {
               pull.signatures.sort(Signature.compare);
               return dbManager.insertSignatures(pull.signatures);
            })
         );

         pull.comments.forEach(function(comment) {
            updates.push(
               dbManager.updateComment(comment)
            );
         });

         pull.reviews.forEach(function(review) {
            updates.push(
               dbManager.updateReview(review)
            );
         });

         updates.push(
            dbManager.deleteLabels(pull.data.repo, pull.data.number).then(function() {
               return dbManager.insertLabels(pull.data.repo, pull.labels, pull.data.number);
            })
         );

         return Promise.all(updates)
         .then(function() {
            queue.markPullAsDirty(pull.data.repo, pull.data.number);
            queue.resume();
         });
      });
   },

   /**
    * Returns a promise that resolves when the db
    * has been updated with the new issue data.
    */
   updateIssue: function(updatedIssue) {
      debug('Calling `updateIssue` for issue #%s', updatedIssue.number);
      var dbIssue = new DBIssue(updatedIssue);
      return dbIssue.save();
   },

   /**
    * Takes in an Issue object, deletes, then resaves the issue and *all* the
    * related data (labels) and returns a
    * Promise that resolves when it's completed.
    */
   updateAllIssueData: function updateAllIssueData(issue) {
      return dbManager.updateIssue(issue).then(
      function() {
         return dbManager.deleteLabels(issue.repo, issue.number);
      }).then(function() {
         return dbManager.insertLabels(issue.repo,
            issue.labels, issue.number, /* isIssue */ true);
      });
   },

   /**
    * Inserts a commit status into the DB. Takes a Status object as an
    * argument.
    */
   updateCommitStatus: function(updatedStatus) {
      debug('Calling `updateCommitStatus` for commit %s in repo %s and context %s',
       updatedStatus.data.sha, updatedStatus.data.repo, updatedStatus.data.context);
      var dbStatus = new DBStatus(updatedStatus);

      return dbStatus.save().
      then(() => this.getPullNumberFromSha(updatedStatus.data.repo, updatedStatus.data.sha)).
      then(function(pullNumber) {
         // `pullNumber` will be null if we are updating the build status of a commit
         // which is no longer a pull's head commit.
         if (pullNumber === null) {
            debug('updateCommitStatus: commit %s is not the HEAD of any pull, none to refresh in repo %s',
               updatedStatus.data.sha, updatedStatus.data.repo);
            return;
         }

         queue.markPullAsDirty(dbStatus.data.repo, pullNumber);
         debug('updateCommitStatus: updated status of Pull #%s in repo %s',
             pullNumber, dbStatus.data.repo);
      });
   },

   updateCommitCheck: function(body) {
      let repo = body.repository.full_name;
      let sha = body.check_run.head_sha;
      let state = utils.mapCheckToStatus(body.check_run.conclusion || body.check_run.status);
      let desc = state;
      let url = body.check_run.html_url;
      let context = body.check_run.name;

      debug('Calling `updateCommitCheck for commit %s in repo %s and context %s',
         sha, repo, context);
      let status = new Status({
         repo:          repo,
         sha:           sha,
         state:         state,
         description:   desc,
         target_url:    url,
         context:       context,
      });

      var dbStatus = new DBStatus(status);
      return dbStatus.save()
         .then(() => this.getPullNumberFromSha(repo, sha))
         .then(function(pullNumber) {
            if (pullNumber === null) {
               debug('updateCommitCheck: commit %s is not the HEAD of any pull, none to refresh in repo %s',
                  sha, repo);
               return;
            }

            queue.markPullAsDirty(repo, pullNumber);
            debug('updateCommitCheck: updated status of Pull #%s in repo %s',
               pullNumber, repo);
         });
   },

   /**
    * Insert a comment into the database, or update the row if
    * it already exists.
    */
   updateComment: function(comment) {
      debug('Calling `updateComment` for comment %s in repo %s',
       comment.data.comment_id, comment.data.repo);
      var dbComment = new DBComment(comment);
      var number = dbComment.data.number;
      var repo = dbComment.data.repo;

      return dbComment.save().
      then(function() {
         queue.markPullAsDirty(repo, number);
         debug('updateComment: updated comment(%s) on Pull #%s in repo %s',
          dbComment.data.comment_id, number, repo);
      });
   },

   /**
    * Insert a review into the database, or update the row if
    * it already exists.
    */
   updateReview: function(review) {
      debug('Calling `updateReview` for review %s in repo %s',
       review.data.review_id, review.data.repo);
      var dbReview = new DBReview(review);
      var number = dbReview.data.number;
      var repo = dbReview.data.repo;

      return dbReview.save().
      then(function() {
         queue.markPullAsDirty(repo, number);
         debug('updateReview: updated review(%s) on Pull #%s in repo %s',
          dbReview.data.review_id, number, repo);
      });
   },

   /**
    * Insert a signature into the database, invalidate any appropriate old
    * signatures, and return a promise that resolves when both of those
    * DB writes are complete.
    */
   insertSignature: function(signature) {
      debug('Calling insertSignature for pull #%s in repo %s',
         signature.data.number, signature.data.repo);
      var dbSignature = new DBSignature(signature);
      var repo = dbSignature.data.repo;
      var number = dbSignature.data.number;
      var type = dbSignature.data.type;
      // Create a default promise for cases where it is not necessary
      // for us to invalidate any signatures.
      var invalidate = Promise.resolve();

      // Invalidate older signatures in certain cases.
      switch (type) {
         case 'un_dev_block':
            invalidate = this.invalidateSignatures(repo, number, ['dev_block']);
            break;
         case 'un_deploy_block':
            invalidate = this.invalidateSignatures(repo, number, ['deploy_block']);
            break;
      }

      return invalidate.then(function() {
         debug('insertSignature: saving %s(%s) on Pull #%s in repo %s',
          type, signature.data.comment_id, number, repo);
         return dbSignature.save();
      });
   },

   /**
    * Insert an array of signatures into the database (one at a time, in order)
    * and update the view upon completion.
    */
   insertSignatures: function(signatures) {
      if (!signatures.length) {
         return Promise.resolve();
      }

      var self = this;
      // Wait for each call to `insertSignature` to resolve before calling again.
      var signaturesSaved = signatures.reduce(function(prevSignature, sig) {
         return prevSignature.then(function() {
            return self.insertSignature(sig);
         });
      }, Promise.resolve());

      var number = signatures[0].data.number;
      var repo = signatures[0].data.repo;
      // After all signatures are added to DB, update view.
      return signaturesSaved.then(function() {
         queue.markPullAsDirty(repo, number);
      });
   },

   /**
    * Insert a single label into the DB.
    */
   insertLabel: function(label) {
      debug("Calling insertLabel for label '%s' on pull #%s in repo %s",
       label.data.title, label.data.number, label.data.repo);
      var dbLabel = new DBLabel(label);
      return dbLabel.save();
   },

   /**
    * Insert an array of (github) labels into the database.
    */
   insertLabels: function(repo, labels, number, isIssue) {
      var labelsSaved = labels.map(this.insertLabel.bind(this));
      return Promise.all(labelsSaved).then(function() {
         if (!isIssue) {
            queue.markPullAsDirty(repo, number);
         }
      });
   },

   /**
    * Invalidates signatures with the given number and one of the given types.
    * Returns a promise that resolves when the DB write is finished.
    *
    * @param number - pull number
    * @param types - array of types to invalidate
    */
   invalidateSignatures: function(repo, number, types) {
      debug('Calling invalidateSignatures for pull #%s in repo %s', number,
         repo);
      var q_update = '\
         UPDATE pull_signatures \
         SET active = 0 \
         WHERE repo = ? AND number = ? AND type IN ?';

      return db.query(q_update, [repo, number, [types]]).
      then(function() {
         debug('invalidateSignatures: invalidated %ss on Pull #%s in repo %s',
            types, number, repo);
      });
   },

   /**
    * Returns a promise which resolves to a Pull object for the given pull
    * number built from data stored in the database.
    */
   getPull: function(repo, number) {
      debug('Calling getPull for pull #%s in repo %s', number, repo);
      var self = this;
      var q_select = '\
         SELECT * FROM pulls \
         WHERE number = ? AND repo = ?';

      return db.query(q_select, [number, repo]).then(function(rows) {
         if (rows.length === 0) { return null; }

         var dbPullData     = rows[0];
         var signatures     = self.getAllSignatures(repo, number);
         var comments       = self.getComments(repo, number);
         var commitStatuses = self.getCommitStatuses(repo, dbPullData.head_sha);
         var labels         = self.getLabels(repo, number);
         var reviews        = self.getReviews(repo, number);

         return Promise.all([signatures, comments, commitStatuses, labels, reviews]).
         then(function(resolved) {
            signatures     = resolved[0];
            comments       = resolved[1];
            commitStatuses = resolved[2];
            labels         = resolved[3];
            reviews        = resolved[4];

            debug('getPull: retrieved Pull #%s in repo %s', number, repo);
            return Pull.getFromDB(dbPullData, signatures, comments, reviews,
             commitStatuses, labels);
         });
      });
   },

   /**
    * Returns a promise which resolves to a Pull object for the given pull
    * number built from data stored in the database.
    */
   getIssue: function(repo, number) {
      debug('Calling getIssue for issue #%s in repo %s', number, repo);
      var q_select = 'SELECT * FROM issues WHERE number = ? AND repo = ?';

      return db.query(q_select, [number, repo]).then(function(rows) {
         if (rows.length === 0) { return null; }

         var dbIssueData  = rows[0];
         return dbManager.getLabels(repo, number)
         .then(function(labels) {
            debug('getIssue: retrieved issue #%s in repo %s', number, repo);
            return Issue.getFromDB(dbIssueData, labels);
         });
      });
   },

   /**
    * Returns a promise which resolves to an array of Pull objects for the
    * given pull numbers built from data stored in the database.
    */
   getPulls: function(repo, pullNumbers) {
      var pulls = _.map(pullNumbers, function(number) {
         return dbManager.getPull(repo, number);
      });
      return Promise.all(pulls)
      .then(filterNulls);
   },

   /**
    * Returns a promise which resolves to an array of Pull objects for all open
    * pulls from the DB
    */
   getOpenPulls: function() {
      var self = this;
      debug('Calling getOpenPulls');
      var q_select = 'SELECT repo, number FROM pulls WHERE state = ?';

      return db.query(q_select, ['open']).then(function(rows) {
         debug('Found %s open pulls in the DB', rows.length);
         if (rows.length === 0) { return []; }
         var pulls = _.map(rows, function(row) {
            return self.getPull(row.repo, row.number);
         });
         return Promise.all(pulls);
      }).then(filterNulls);
   },

   /**
    * Returns a promise which resolves to a pull's number for the given head
    * commit sha.
    */
   getPullNumberFromSha: function(repo, sha) {
      var q_select = 'SELECT number FROM pulls WHERE repo = ? AND head_sha = ?';

      return db.query(q_select, [repo, sha]).then(function(rows) {
         return rows[0] ? rows[0].number : null;
      });
   },

   getAllSignatures: function(repo, number) {
      var q_select = '\
         SELECT * FROM pull_signatures \
         WHERE number = ? AND repo = ? \
         ORDER BY date desc;';

      return db.query(q_select, [number, repo]).then(function(rows) {
         return rows.map(function(row) {
            return Signature.getFromDB(row);
         });
      });
   },

   /**
    * Returns a promise which resolves to an array of Comment objects.
    */
   getComments: function(repo, number) {
      var q_select = '\
         SELECT * FROM comments \
         WHERE number = ? AND repo = ?';

      return db.query(q_select, [number, repo]).then(function(rows) {
         return rows.map(function(row) {
            return Comment.getFromDB(row);
         });
      });
   },

   /**
    * Returns a promise which resolves to an array of Review objects.
    */
   getReviews: function(repo, number) {
      var q_select = '\
         SELECT * FROM reviews \
         WHERE number = ? AND repo = ?';

      return db.query(q_select, [number, repo]).then(function(rows) {
         return rows.map(function(row) {
            return Review.getFromDB(row);
         });
      });
   },

   /**
    * Returns a promise which resolves to a Status object.
    */
   getCommitStatuses: function(repo, sha) {
      var q_select = '\
         SELECT * FROM commit_statuses \
         WHERE commit = ? AND repo = ?';

      return db.query(q_select, [sha, repo]).then(function(rows) {
         return rows.map(row => Status.getFromDB(row));
      });
   },

   /**
    * Returns a promise which resolves to an array of labels for the pull.
    */
   getLabels: function getLabels(repo, number) {
      debug('Calling getLabels for #%s in repo %s', number, repo);
      var q_select = '\
         SELECT * FROM pull_labels \
         WHERE number = ? AND repo = ?';
      return db.query(q_select, [number, repo]).then(function(rows) {
         debug('Got %s rows', rows.length);
         return rows.map(function(row) {
            return Label.getFromDB(row);
         });
      });
   },

   /**
    * Returns a promise which resolves when all signatures associated with
    * the given pull number have been removed from the database.
    */
   deleteSignatures: function(repo, number) {
      debug('Calling deleteSignatures for pull #%s in repo %s', number, repo);
      var q_delete = 'DELETE FROM pull_signatures WHERE number = ? AND repo = ?';

      return db.query(q_delete, [number, repo]).then(function() {
         debug('deleteSignatures: deleting from Pull #%s in repo %s', number, repo);
      });
   },

   /**
    * Delete a single label from the database.
    */
   deleteLabel: function deleteLabel(label) {
      debug("Calling deleteLabel for label '%s' on issue #%s",
       label.data.title, label.data.number);
      return (new DBLabel(label)).delete();
   },

   /**
    * Delete a single pull request review comment from the database.
    */
   deleteReviewComment: function deleteReviewComment(repo, comment_id) {
      return DBComment.delete(repo, 'review', comment_id);
   },

   /**
    * Returns a promise which resolves when all the labels for pull `number`
    *  have been deleted from the database.
    */
   deleteLabels: function deleteLabels(repo, number) {
      debug('Calling deleteLabels for pull #%s in repo %s', number, repo);
      var q_delete = 'DELETE FROM pull_labels WHERE number = ? ' +
       'AND repo = ?';
      return db.query(q_delete, [number, repo]);
   },

   // After restarting Pulldasher and updating all the open pulls, this
   // updates closed pulls that are still set as 'open' in the DB, but have
   // since been closed.
   // @TODO closeStalePulls:

};

/**
 * Return a copy of the specified array with nulls removed
 */
function filterNulls(array) {
   return array.filter(function(element) {
      return element;
   });
}
