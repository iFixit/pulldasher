var utils = require('../lib/utils'),
    db = require('../lib/db');

// Builds an object representation of a row in the DB `pulls` table
// from the data returned by GitHub's API.
function DBPull(pull) {
   var pullData = pull.data;
   this.data = {
      number: pullData.number,
      state: pullData.state,
      title: pullData.title,
      body: pullData.body,
      date: utils.toUnixTime(pullData.created_at),
      date_updated: utils.toUnixTime(pullData.updated_at),
      date_closed: utils.toUnixTime(pullData.closed_at),
      date_merged: utils.toUnixTime(pullData.merged_at),
      difficulty: pullData.difficulty,
      milestone_title: pullData.milestone.title,
      milestone_due_on: utils.toUnixTime(pullData.milestone.due_on),
      milestone_number: pullData.milestone.number,
      head_branch: pullData.head.ref,
      head_sha: pullData.head.sha,
      repo_owner: pullData.head.repo.owner.login,
      repo_name: pullData.head.repo.name,
      base_branch: pullData.base.ref,
      owner: pullData.user.login,
      cr_req: pullData.cr_req,
      qa_req: pullData.qa_req,
      closes: pullData.closes,
      connects: pullData.connects
   };
}

DBPull.prototype.save = function() {
   var pullData = this.data;
   var q_update = 'REPLACE INTO pulls SET ?';

   return db.query(q_update, pullData);
};

module.exports = DBPull;
