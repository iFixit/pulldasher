var _ = require('underscore'),
    config = require('../config'),
    debug = require('debug')('pulldasher:db-manager'),
    Promise = require('promise'),
    db = require('../lib/db'),
    DBPull = require('../models/db_pull'),
    DBStatus = require('../models/db_status'),
    DBSignature = require('../models/db_signature'),
    DBComment = require('../models/db_comment'),
    Pull = require('../models/pull'),
    Status = require('../models/status'),
    Signature = require('../models/signature'),
    Comment = require('../models/comment'),
    queue = require('../lib/pull-queue'),
    gitManager = require('../lib/git-manager');

module.exports = {

   /**
    * Returns a promise that resolves when the db and client
    * have been updated with the new pull data.
    */
   updatePull: function(updatedPull) {
      debug('Calling `updatePull` for pull #%s', updatedPull.data.number);
      var self = this;
      var dbPull = new DBPull(updatedPull.data);
      var number = dbPull.data.number;

      return new Promise(function(resolve, reject) {
         dbPull.save().done(function() {
            queue.markPullAsDirty(number);
            resolve();
            debug('updatePull: Pull #%s updated', number);
         });
      });
   },

   /**
    * Inserts a commit status into the DB. Takes a Status object as an
    * argument.
    */
   updateCommitStatus: function(updatedStatus) {
      debug('Calling `updateCommitStatus` for commit %s', updatedStatus.sha);
      var self = this;
      var dbStatus = new DBStatus(updatedStatus.data);
      var number = this.getPullNumberFromSha(dbStatus.data.commit);

      return new Promise(function(resolve, reject) {
         dbStatus.save().done(function() {
            number.done(function(n) {
               // `n` will be null if we are updating the build status of a commit
               // which is no longer a pull's head commit.
               if (n === null) {
                  resolve();
                  debug('updateCommitStatus: commit no longer HEAD of Pull #%s', number);
                  return;
               }

               queue.markPullAsDirty(n);
               resolve();
               debug('updateCommitStatus: updated status of Pull #%s', number);
            });
         });
      });
   },

   /**
    * Insert a comment into the database, or update the row if
    * it already exists.
    */
   updateComment: function(comment) {
      debug('Calling `updateComment` for comment %s', comment.data.comment_id);
      var self = this;
      var dbComment = new DBComment(comment.data);
      var number = dbComment.data.number;

      return new Promise(function(resolve, reject) {
         dbComment.save().done(function() {
            queue.markPullAsDirty(number);
            resolve();
            debug('updateComment: updated comment(%s) on Pull #%s',
             dbComment.data.comment_id, number);
         });
      });
   },

   /**
    * Insert a signature into the database, invalidate any appropriate old
    * signatures, and return a promise that resolves when both of those
    * DB writes are complete.
    */
   insertSignature: function(signature) {
      debug('Calling insertSignature for pull #%s', signature.data.number);
      var dbSignature = new DBSignature(signature.data);
      var number = dbSignature.data.number;
      var type = dbSignature.data.type;
      // Create a default promise for cases where it is not necessary
      // for us to invalidate any signatures.
      var invalidate = Promise.resolve();

      // Invalidate older signatures in certain cases.
      switch (type) {
         case 'un_dev_block':
            invalidate = this.invalidateSignatures(number, ['dev_block']);
            break;
         case 'un_deploy_block':
            invalidate = this.invalidateSignatures(number, ['deploy_block']);
            break;
      }

      return invalidate.then(function() {
         debug('insertSignature: saving %s(%s) on Pull #%s',
          type, signature.data.comment_id, number);
         return dbSignature.save();
      });

   },

   /**
    * Insert an array of signatures into the database (one at a time, in order)
    * and update the view upon completion.
    */
   insertSignatures: function(signatures) {
      if (!signatures.length)
         return;

      var self = this;
      // Wait for each call to `insertSignature` to resolve before calling again.
      var signaturesSaved = signatures.reduce(function(prevSignature, sig) {
         return prevSignature.then(function() {
            return self.insertSignature(sig);
         });
      }, Promise.resolve());

      var number = signatures[0].data.number;
      // After all signatures are added to DB, update view.
      return new Promise(function(resolve, reject) {
         signaturesSaved.done(function() {
            queue.markPullAsDirty(number);
            resolve();
         });
      });
   },

   /**
    * Invalidates signatures with the given number and one of the given types.
    * Returns a promise that resolves when the DB write is finished.
    *
    * @param number - pull number
    * @param types - array of types to invalidate
    */
   invalidateSignatures: function(number, types) {
      debug('Calling invalidateSignatures for pull #%s', number);
      var q_update = '\
         UPDATE pull_signatures \
         SET active = 0 \
         WHERE number = ? AND type IN ?';

      return new Promise(function(resolve, reject) {
         db.query(q_update, [number, [types]], function(err, rows) {
            if (err) { reject(err); }
            resolve();
            debug('invalidateSignatures: invalidated %ss on Pull #%s',
             types, number);
         });
      });
   },

   /**
    * Returns a promise which resolves to a Pull object for the given pull
    * number built from data stored in the database.
    */
   getPull: function(number) {
      debug('Calling getPull for pull #%s', number);
      var self = this;
      var q_select = 'SELECT * FROM pulls WHERE number = ?';

      return new Promise(function(resolve, reject) {
         db.query(q_select, number, function(err, rows) {
            if (err) { reject(err); }

            var pullData = Pull.getFromDB(rows[0]);
            var repo = pullData.head.repo.name;

            var signatures = self.getSignatures(number, repo);
            var comments   = self.getComments(number, repo);
            var commitStatus = self.getCommitStatus(pullData.head.sha);

            Promise.all([signatures, comments, commitStatus]).then(function(resolved) {
               signatures = resolved[0];
               comments   = resolved[1];
               commitStatus = resolved[2];
            
               resolve(new Pull(pullData, signatures, comments, commitStatus));
               debug('getPull: retrieved Pull #%s', number);
            });
         });
      });
   },

   /**
    * Returns a promise which resolves to an array of Pull objects for the
    * given pull numbers built from data stored in the database.
    */
   getPulls: function(pullNumbers) {
      var pulls = _.map(pullNumbers, this.getPull.bind(this));
      return Promise.all(pulls);
   },

   /**
    * Returns a promise which resolves to a pull's number for the given head
    * commit sha.
    */
   getPullNumberFromSha: function(sha) {
      var q_select = 'SELECT number FROM pulls WHERE head_sha = ?';

      return new Promise(function(resolve, reject) {
         db.query(q_select, sha, function(err, rows) {
            if (err) { reject(err); }

            if (rows[0]) {
               resolve(rows[0].number);
            } else {
               resolve(null);
            }
         });
      });
   },

   /**
    * Returns a promise which resolves to an array of "active" Signature objects.
    */
   getSignatures: function(number, repo) {
      return new Promise(function(resolve, reject) {
         var q_select = '\
            SELECT * FROM comments \
            JOIN pull_signatures USING (comment_id, number) \
            WHERE number = ? AND repo_name = ? AND active = 1;'

         db.query(q_select, [number, repo], function(err, rows) {
            if (err) { reject(err); }

            var sigs = [];
            rows.forEach(function(row) {
               sigs.push(new Signature(Signature.getFromDB(row)));
            });

            resolve(sigs);
         });
      });
   },

   /**
    * Returns a promise which resolves to an array of Comment objects.
    */
   getComments: function(number, repo) {
      return new Promise(function(resolve, reject) {
         var q_select = '\
            SELECT * FROM comments \
            WHERE number = ? AND repo_name = ?';

         db.query(q_select, [number, repo], function(err, rows) {
            if (err) { reject(err); }

            var comments = [];
            rows.forEach(function(row) {
               comments.push(new Comment(Comment.getFromDB(row)));
            });

            resolve(comments);
         });
      });
   },

   /**
    * Returns a promise which resolves to a Status object.
    */
   getCommitStatus: function(sha) {
      return new Promise(function(resolve, reject) {
         var q_select = '\
            SELECT * FROM commit_statuses \
            WHERE commit = ?';

         db.query(q_select, sha, function(err, rows) {
            if (err) { reject(err); }

            if (rows.length === 1) {
               resolve(new Status(Status.getFromDB(rows[0])));
            } else {
               resolve(null);
            }
         });
      });
   },

   /**
    * Returns a promise which resolves when all signatures associated with
    * the given pull number have been removed from the database.
    */
   deleteSignatures: function(number) {
      debug('Calling deleteSignatures for pull #%s', number);
      return new Promise(function(resolve, reject) {
         var q_delete = 'DELETE FROM pull_signatures WHERE number = ?';

         db.query(q_delete, number, function(err, rows) {
            if (err) { reject(err); }

            resolve();
            debug('deleteSignatures: deleting from Pull #%s', number);
         });
      });
   }

   // After restarting Pulldasher and updating all the open pulls, this
   // updates closed pulls that are still set as 'open' in the DB, but have
   // since been closed.
   // @TODO closeStalePulls:

};
