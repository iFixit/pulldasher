var _ = require('underscore'),
    DBPull = require('../models/db_pull'),
    Signature = require('../models/signature');

module.exports = {
   updatePull: function(updatedPull) {
      var dbPull = new DBPull(updatedPull.data);
      dbPull.save();
      updatePullSignatures(updatedPull)
   }

   // After restarting Pulldasher and updating all the open pulls, this
   // updates closed pulls that are still set as 'open' in the DB, but have
   // since been closed.
   // @TODO closeStalePulls:

   // @TODO updateCommitStatuses:
};

function updatePullSignatures(pull) {
   // activeSignaturesByTag[0] array of all active QA signatures
   // activeSignaturesByTag[1] array of all active CR signatures
   // etc (see Signature.tags)
   activeSignaturesByTag = Signature.tags.map(pull.getActiveSignatures.bind(pull));
   // TODO build query here
   // we know all the active signatures for the pull. we should insert these into the database.
   // we also want to delete all signatures in the database for the pullNumber and type that are not in
   // this active signatures array.
}
