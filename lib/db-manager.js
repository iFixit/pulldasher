var db = require('./db'),
    _ = require('underscore'),
    DBPull = require('../models/db_pull');

module.exports = function DBManager() {
   var openPulls = [];

   var self = {
      updatePull: function(updatedPull) {
         if (!updatedPull.data) {
            return;
         }

         var dbPull = new DBPull(updatedPull.data);
         var pull = dbPull.toObject();

         var q_update = 'REPLACE INTO pulls SET ?';

         var conn = db.connect();
         conn.query(q_update, pull, function(err, rows) {
            if (err) { console.log(err); }
         });
         conn.end();

         // Update list of currently open pulls.
         openPulls.push(pull.number);
      },

      // After restarting Pulldasher and updating all the open pulls, this
      // updates closed pulls that are still set as 'open' in the DB, but are
      // not in the `openPulls` list populated by `updatePull`.
      // @TODO closeStalePulls:

      // @TODO updatePullSignatures:

      // @TODO updateCommitStatuses:
   };
   return self;
};
