var utils = require("../lib/utils");
var db = require("../lib/db");

/**
 * Create a new instance from an Issue object
 */
function DBIssue(issue) {
  this.data = {
    repo: issue.repo,
    number: issue.number,
    title: issue.title,
    assignee: issue.assignee,
    status: issue.status,
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

DBIssue.findByNumber = function (repo, number) {
  var q_select = "SELECT * FROM `issues` WHERE `number` = ? AND repo = ?";
  return db.query(q_select, [repo, number]).then(function (rows) {
    if (rows) {
      return rows[0];
    } else {
      return null;
    }
  });
};

DBIssue.prototype.save = function () {
  var issueData = this.data;
  var q_update = "REPLACE INTO issues SET ?";

  return db.query(q_update, issueData);
};

module.exports = DBIssue;
