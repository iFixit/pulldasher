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
    * Insert a signature into the database, and update the view
    * upon completion.
    */
   insertSignature: function(signature) {
      var self = this;
      var dbSignature = new DBSignature(signature.data);
      var number = dbSignature.data.number;

      dbSignature.save().done(function() {
         self.getPull(number).done(function(pull) {
            pullManager.updatePull(pull);
         });
      });
   },

   /**
    * Insert an array of signatures into the database, and update the view
    * upon completion. NOTE: This doesn't invalidate old signatures, so it
    * should probably only be called after `deleteSignatures`.
    */
   insertSignatures: function(signatures) {
      if (!signatures.length)
         return;

      // Generate array of promises that resolve when all signatures
      // are written to the DB.
      var signaturesSaved = signatures.map(function(signature) {
         return (new DBSignature(signature.data)).save();
      });

      var self = this;
      var number = signatures[0].data.number;
      // When all signatures have been saved, update view.
      Promise.all(signaturesSaved).done(function(resolved) {
         self.getPull(number).done(function(pull) {
            pullManager.updatePull(pull);
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
    * Returns a promise which resolves to an array of signatures' data.
    */
   getSignatures: function(number) {
      return new Promise(function(resolve, reject) {
         var q_select = 'SELECT * FROM pull_signatures WHERE number = ?';

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
