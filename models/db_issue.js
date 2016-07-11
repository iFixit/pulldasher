var utils = require('../lib/utils');
var db = require('../lib/db');
var utils = require('../lib/utils');

function DBIssue(issue) {
   this.data = {
      number: issue.number,
      title: issue.title,
      assignee: issue.assignee,
      status: issue.status,
      dateCreated: utils.toUnixTime(issue.dateCreated),
      dateClosed: utils.toUnixTime(issue.dateClosed)
   };

   if (issue.difficulty) {
      this.data.difficulty = extractInt(issue.difficulty);
   } else {
      this.data.difficulty = null;
   }

   if (issue.milestone) {
      this.data.milestone_title = issue.milestone.title;
      this.data.milestone_due_date = utils.toUnixTime(issue.milestone.dueDate);
   } else {
      this.data.milestone_title = null;
      this.data.milestone_due_date = null;
   }
}

DBIssue.findByNumber = function(number) {
   var q_select = 'SELECT * FROM `issues` WHERE `number` = ?';
   return db.query(q_select, [number]).
   then(function(rows) {
      if (rows) {
         return rows[0];
      } else {
         return null;
      }
   });
};

DBIssue.prototype.save = function() {
   var issueData = this.data;
   var q_update = 'REPLACE INTO issues SET ?';

   return db.query(q_update, issueData);
};

function extractInt(str) {
   var result = str && str.match(/[0-9]+/);
   return result ? parseInt(result[0], 10) : null;
}

module.exports = DBIssue;
