import utils from '../lib/utils.js';
import db from '../lib/db.js';

/**
 * Create a new instance from an Issue object
 */
class DBIssue {
   constructor(issue) {
      this.data = {
         repo: issue.repo,
         number: issue.number,
         title: issue.title,
         author: issue.author,
         assignee: issue.assignee,
         status: issue.status,
         state_reason: issue.state_reason,
         date_assigned: utils.toUnixTime(issue.date_assigned),
         date_created: utils.toUnixTime(issue.date_created),
         date_closed: utils.toUnixTime(issue.date_closed),
         difficulty: issue.difficulty,
      };

      if (issue.milestone) {
         this.data.milestone_title = issue.milestone.title;
         this.data.milestone_due_on = utils.toUnixTime(issue.milestone.due_on);
      } else {
         this.data.milestone_title = null;
         this.data.milestone_due_on = null;
      }
   }

   save() {
      const issueData = this.data;
      const q_update = 'REPLACE INTO issues SET ?';
      return db.query(q_update, issueData);
   }
}

export default DBIssue;
