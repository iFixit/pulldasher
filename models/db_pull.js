var _ = require('underscore'),
    db = require('../lib/db');

// Builds an object representation of a row in the DB `pulls` table
// from the data returned by GitHub's API.
function DBPull(pullData) {
   this.data = {
      number: pullData.number,
      state: pullData.state,
      title: pullData.title,
      body: pullData.body,
      created_at: pullData.created_at,
      updated_at: pullData.updated_at,
      closed_at: pullData.closed_at,
      merged_at: pullData.merged_at,
      head_branch: pullData.head.ref,
      head_sha: pullData.head.sha,
      repo_owner: pullData.head.repo.owner.login,
      repo_name: pullData.head.repo.name,
      base_branch: pullData.base.ref,
      owner: pullData.user.login
   };
}

DBPull.prototype.save = function() {
   var q_update = 'REPLACE INTO pulls SET ?';

   db.query(q_update, this.data, function(err, rows) {
      if (err) { console.log(err); }
   });
};

DBPull.prototype.toObject = function() {
   var data = this.data;
   var obj = _.extend({}, data);
   return obj;
};

module.exports = DBPull;
