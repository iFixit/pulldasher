var _ = require('underscore'),
    db = require('../lib/db'),
    Promise = require('promise');

// Builds an object representation of a row in the DB `pulls` table
// from the data returned by GitHub's API.
function DBSignature(sigData) {
   this.data = {
      number:     sigData.number,
      user:       sigData.user,
      // Add a row to DB?
      // user_id:    sigData.user_id,
      type:       sigData.type,
      created_at: sigData.created_at,
      active:     sigData.active,
      comment_id: sigData.comment_id
   };
}

DBSignature.prototype.save = function() {
   var sigData = this.data;
   var q_insert = 'INSERT INTO pull_signatures SET ?';

   return new Promise(function(resolve, reject) {
      db.query(q_insert, sigData, function(err, rows) {
         if (err) { reject(err); }
         resolve();
      });
   });
};

module.exports = DBSignature;
