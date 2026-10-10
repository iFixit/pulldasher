import utils from '../lib/utils.js';
import getLogin from '../lib/get-user-login.js';
import db from '../lib/db.js';

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
      draft: pullData.draft ? 1 : 0,
      date: utils.toUnixTime(pullData.created_at),
      date_updated: utils.toUnixTime(pullData.updated_at),
      date_pushed: utils.toUnixTime(pullData.date_pushed),
      date_closed: utils.toUnixTime(pullData.closed_at),
      date_merged: utils.toUnixTime(pullData.merged_at),
      mergeable: pullData.mergeable,
      milestone_title: pullData.milestone.title,
      milestone_due_on: utils.toUnixTime(pullData.milestone.due_on),
      head_branch: pullData.head.ref,
      head_sha: pullData.head.sha,
      base_branch: pullData.base.ref,
      owner: getLogin(pullData.user),
      // Serialize to a JSON string; MySQL parses it into the JSON column.
      assignees: JSON.stringify(pullData.assignees || []),
      requested_reviewers: JSON.stringify(pullData.requested_reviewers || []),
      requested_teams: JSON.stringify(pullData.requested_teams || []),
      cr_req: pullData.cr_req,
      qa_req: pullData.qa_req,
      closes: pullData.closes,
      connects: pullData.connects,
      additions: pullData.additions,
      deletions: pullData.deletions,
      changed_files: pullData.changed_files,
   };
   // only a full refresh computed them; the column holds {sha, hints} so a
   // restart knows which head they were for
   if (pullData.input_hints) {
      this.data.input_hints = JSON.stringify({
         sha: pullData.input_hints_sha,
         hints: pullData.input_hints,
      });
   }
}

DBPull.prototype.save = function () {
   var pullData = this.data;
   // A webhook's body carries no push time; an upsert that leaves out the
   // column keeps the stored one, where REPLACE would blank it.
   if (pullData.date_pushed == null) delete pullData.date_pushed;
   var q_update = 'INSERT INTO pulls SET ? ON DUPLICATE KEY UPDATE ?';

   return db.query(q_update, [pullData, pullData]);
};

export default DBPull;
