var _ = require('underscore'),
    config = require('../config'),
    db = require('../lib/db'),
    DBPull = require('../models/db_pull'),
    DBStatus = require('../models/db_status'),
    Pull = require('../models/pull'),
    Signature = require('../models/signature'),
    pullManager = require('../lib/pull-manager');

module.exports = {
   updatePull: function(updatedPull) {
      var self = this;
      var dbPull = new DBPull(updatedPull.data);

      // Update UI when DB write is complete.
      // TODO: also save comments, signatures to DB.
      dbPull.save(function updateView(number) {
         self.getPull(number, function(pull) {
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
    * Accepts a pull number and callback. The callback will be supplied
    * with a Pull object created from the corresponding row in the DB.
    */
   getPull: function(number, callback) {
      var q_select = 'SELECT * FROM pulls WHERE number = ?';

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
