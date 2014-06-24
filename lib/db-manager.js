var _ = require('underscore'),
    config = require('../config'),
    Promise = require('promise'),
    db = require('../lib/db'),
    DBPull = require('../models/db_pull'),
    DBStatus = require('../models/db_status'),
    DBSignature = require('../models/db_signature'),
    Pull = require('../models/pull'),
    Signature = require('../models/signature'),
    pullManager = require('../lib/pull-manager'),
    gitManager = require('../lib/git-manager');

module.exports = {
   updatePull: function(updatedPull) {
      var self = this;
      var dbPull = new DBPull(updatedPull.data);
      var number = dbPull.data.number;

      dbPull.save().done(function() {
         self.getPull(number).done(function(pull) {
            pullManager.updatePull(pull);
         });
      });
   },

   updateCommitStatus: function(updatedStatus) {
      var dbStatus = new DBStatus(updatedStatus.data);
      dbStatus.save();
   },

   /**
    * Insert a signature into the database, invalidate any appropriate old
    * signatures, and return a promise that resolves when both of those
    * DB writes are complete.
    */
   insertSignature: function(signature) {
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
      signaturesSaved.done(function() {
         self.getPull(number).done(function(pull) {
            pullManager.updatePull(pull);
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
      var q_update = '\
         UPDATE pull_signatures \
         SET active = 0 \
         WHERE number = ? AND type IN ?';

      return new Promise(function(resolve, reject) {
         db.query(q_update, [number, [types]], function(err, rows) {
            if (err) { reject(err); }
            resolve();
         });
      });
   },

   /**
    * Returns a promise which resolves to a Pull object for the given pull
    * number built from data stored in the database.
    */
   getPull: function(number) {
      var self = this;
      var q_select = 'SELECT * FROM pulls WHERE number = ?';

      return new Promise(function(resolve, reject) {
         db.query(q_select, number, function(err, rows) {
            if (err) { reject(err); }

            var pullData = Pull.getFromDB(rows[0]);

            signatures = self.getSignatures(number);
            // Grab head commit via GitHub API
            // TODO: maybe store headCommit info in DB?
            headCommit = gitManager.getCommit(pullData.head.sha);

            Promise.all([signatures, headCommit]).then(function(resolved) {
               signatures = resolved[0];
               headCommit = resolved[1];
               resolve(new Pull(pullData, signatures, headCommit));
            });
         });
      });
   },

   /**
    * Returns a promise which resolves to an array of "active" Signature objects.
    */
   getSignatures: function(number) {
      return new Promise(function(resolve, reject) {
         var q_select = '\
            SELECT * FROM pull_signatures \
            WHERE number = ? AND active = 1';

         db.query(q_select, number, function(err, rows) {
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
    * Returns a promise which resolves when all signatures associated with
    * the given pull number have been removed from the database.
    */
   deleteSignatures: function(number) {
      return new Promise(function(resolve, reject) {
         var q_delete = 'DELETE FROM pull_signatures WHERE number = ?';

         db.query(q_delete, number, function(err, rows) {
            if (err) { reject(err); }

            resolve();
         });
      });
   }

   // After restarting Pulldasher and updating all the open pulls, this
   // updates closed pulls that are still set as 'open' in the DB, but have
   // since been closed.
   // @TODO closeStalePulls:

};
