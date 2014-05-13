var _ = require('underscore'),
    DBPull = require('../models/db_pull');

module.exports = {
   updatePull: function(updatedPull) {
      var dbPull = new DBPull(updatedPull.data);
      dbPull.save();
   }

   // After restarting Pulldasher and updating all the open pulls, this
   // updates closed pulls that are still set as 'open' in the DB, but have
   // since been closed.
   // @TODO closeStalePulls:

   // @TODO updatePullSignatures:

   // @TODO updateCommitStatuses:
};
