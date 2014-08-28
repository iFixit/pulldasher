var _ = require('underscore'),
    db = require('../lib/db'),
    Promise = require('promise');


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
      owner: pullData.user.login,
      cr_req: pullData.cr_req,
      qa_req: pullData.qa_req
   };
}

DBPull.prototype.save = function() {
   var pullData = this.data;
   var q_update = 'REPLACE INTO pulls SET ?';

   return new Promise(function(resolve, reject) {
      db.query(q_update, pullData, function(err, rows) {
         if (err) { return reject(err); }
         resolve();
      });
   });
};

module.exports = DBPull;
