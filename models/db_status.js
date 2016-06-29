var _ = require('underscore'),
    db = require('../lib/db');

// Builds an object representation of a row in the DB `commit_statuses`
// table from the data returned by GitHub's API.
function DBStatus(status) {
   var statusData = status.data;
   this.data = {
      commit: statusData.sha,
      state: statusData.state,
      description: statusData.description,
      log_url: statusData.target_url
   };
}

DBStatus.prototype.save = function() {
   var statusData = this.data;
   var q_update = 'REPLACE INTO commit_statuses SET ?';

   return db.query(q_update, statusData);
};

DBStatus.prototype.toObject = function() {
   return _.extend({}, this.data);
};

module.exports = DBStatus;
