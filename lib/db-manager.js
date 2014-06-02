var _ = require('underscore'),
    DBPull = require('../models/db_pull'),
    DBStatus = require('../models/db_status');

module.exports = {
   updatePull: function(updatedPull) {
      var dbPull = new DBPull(updatedPull.data);
      dbPull.save();
   },

   updateCommitStatus: function(updatedStatus) {
      var dbStatus = new DBStatus(updatedStatus.data);
      dbStatus.save();
   }

   // After restarting Pulldasher and updating all the open pulls, this
   // updates closed pulls that are still set as 'open' in the DB, but have
   // since been closed.
   // @TODO closeStalePulls:

   // @TODO updatePullSignatures:
};
