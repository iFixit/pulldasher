var utils = require('../lib/utils'),
    db = require('../lib/db');

/**
 * Builds an object representation of a row in the DB `pull_signatures` table
 * from the Signature object.
 */
function DBSignature(signature) {
   var sigData = signature.data;
   this.data = {
      number:     sigData.number,
      user:       sigData.user.login,
      userid:     sigData.user.id,
      type:       sigData.type,
      date:       utils.toUnixTime(sigData.created_at),
      active:     sigData.active,
      comment_id: sigData.comment_id
   };
}

DBSignature.prototype.save = function() {
   var sigData = this.data;
   var q_insert = 'INSERT INTO pull_signatures SET ?';

   return db.query(q_insert, sigData);
};

module.exports = DBSignature;
