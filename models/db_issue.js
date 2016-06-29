var utils = require('../lib/utils');
var db = require('../lib/db');
var log = require('debug')('pulldasher:dbissue');
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

   if (isNaN(issue.difficulty)) {
      this.data.difficulty = null;
   } else {
      this.data.difficulty = parseInt(issue.difficulty, 10);
   }

   if (issue.milestone) {
      this.data.milestone_title = issue.milestone.title;
      this.data.milestone_due_date = utils.toUnixTime(issue.milestone.dueDate);
   } else {
      this.data.milestone_title = null;
      this.data.milestone_due_date = null;
   }
}

DBIssue.prototype.save = function() {
   var issueData = this.data;
   var q_update = 'REPLACE INTO issues SET ?';

   return db.query(q_update, issueData);
};

module.exports = DBIssue;
