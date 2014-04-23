var _ = require('underscore'),
    DBPull = require('../models/db_pull');

module.exports = function DBManager() {
   var openPulls = [];

   var self = {
      updatePull: function(updatedPull) {
         var dbPull = new DBPull(updatedPull.data);
         dbPull.save();

         // Update list of currently open pulls.
         openPulls.push(updatedPull.data.number);
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
