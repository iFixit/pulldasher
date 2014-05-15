var _ = require('underscore'),
    db = require('../lib/db');

// Builds an object representation of a row in the DB `commit_statuses`
// table from the data returned by GitHub's API.
function DBStatus(statusData) {
   this.data = {
      commit: statusData.sha,
      state: statusData.state,
      description: statusData.description,
      log_url: statusData.target_url
   };
}

DBStatus.prototype.save = function() {
   var q_update = 'REPLACE INTO commit_statuses SET ?';

   db.query(q_update, this.data, function(err, rows) {
      if (err) { console.log(err); }
   });
};

DBStatus.prototype.toObject = function() {
   var data = this.data;
   var obj = _.extend({}, data);
   return obj;
};

module.exports = DBStatus;
