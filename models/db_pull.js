var utils = require('../lib/utils'),
    getLogin = require('../lib/get-user-login'),
    db = require('../lib/db');

// Builds an object representation of a row in the DB `pulls` table
// from the data returned by GitHub's API.
function DBPull(pull) {
   var pullData = pull.data;
   this.data = {
      repo: pullData.repo,
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
      head_branch: pullData.head.ref,
      head_sha: pullData.head.sha,
      base_branch: pullData.base.ref,
      owner: getLogin(pullData.user),
      cr_req: pullData.cr_req,
      qa_req: pullData.qa_req,
      closes: pullData.closes,
      connects: pullData.connects,
      passing: pullData.passing,
   };
}

DBPull.prototype.save = function() {
   var pullData = this.data;
   var q_update = 'REPLACE INTO pulls SET ?';

   return db.query(q_update, pullData);
};

module.exports = DBPull;
