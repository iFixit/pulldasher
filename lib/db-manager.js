var _ = require('underscore'),
    DBPull = require('../models/db_pull'),
    DBStatus = require('../models/db_status'),
    config = require('../config'),
    Signature = require('../models/signature');

module.exports = {
   updatePull: function(updatedPull) {
      var dbPull = new DBPull(updatedPull.data);
      dbPull.save();
      updatePullSignatures(updatedPull);
   },

   updateCommitStatus: function(updatedStatus) {
      var dbStatus = new DBStatus(updatedStatus.data);
      dbStatus.save();
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
