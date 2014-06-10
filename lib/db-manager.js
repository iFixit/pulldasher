var _ = require('underscore'),
    config = require('../config'),
    Promise = require('promise'),
    db = require('../lib/db'),
    DBPull = require('../models/db_pull'),
    DBStatus = require('../models/db_status'),
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

      updatePullSignatures(updatedPull);
   },

   updateCommitStatus: function(updatedStatus) {
      var dbStatus = new DBStatus(updatedStatus.data);
      dbStatus.save();
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

      db.query(q_select, number, function(err, rows) {
         var pullData = Pull.getFromDB(rows[0]);
         callback(new Pull(pullData));
      });
   }

   // After restarting Pulldasher and updating all the open pulls, this
   // updates closed pulls that are still set as 'open' in the DB, but have
   // since been closed.
   // @TODO closeStalePulls:

};

function updatePullSignatures(pull) {
   // TODO build query here
   // pull.signatures is an array of signatures for the pull and already has active set to true/false
   // all signatures for this pull that are in the database but are not in this pull.signatures array should
   // be set to active=false
}
