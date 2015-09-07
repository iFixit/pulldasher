var utils = require('../lib/utils');
var db = require('../lib/db');
var log = require('debug')('pulldasher:dbissue');

function DBIssue(issue) {
   this.data = {
      number: issue.number,
      title: issue.title,
      //pull: issue.associatedPull(),
   };

   if (isNaN(issue.difficulty())) {
      this.data.difficulty = null;
   } else {
      this.data.difficulty = parseInt(issue.difficulty(), 10);
   }

   if (issue.milestone) {
      this.data.milestone_title = issue.milestone.title;
      this.data.milestone_due_date = issue.milestone.dueDate;
   } else {
      this.data.milestone_title = null;
      this.data.milestone_due_date = null;
   }
}

DBIssue.prototype.save = function() {
   var issueData = this.data;
   log(issueData);
   var q_update = 'REPLACE INTO issues SET ?';

   return db.query(q_update, issueData);
};

module.exports = DBIssue;
