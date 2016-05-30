var utils   = require('../lib/utils');
var _       = require('underscore');
var config  = require('../config');
var log     = require('debug')('pulldasher:issue');
var Promise = require('promise');

/**
 * Create a new issue.
 */
function Issue(data) {
   _.extend(this, data);
}

/**
 * Create properties on this object for each label it has of the configured
 * labels.
 */
Issue.prototype.updateFromLabels = function(labels) {
   var self = this;
   if (labels) {
      config.labels.forEach(function(labelConfig) {
         labels.forEach(function(label) {
            if (labelConfig.regex.test(label.name)) {
               log("Attached %s to %s because of a label reading %s", labelConfig.name, self.number, label.name);
               self[labelConfig.name] = label.name;
            }
         });
      });
   } else {
      log("No labels on %s", self.number);
   }
};

/**
 * A factory method to create an issue from GitHub data. Currently, the data
 * in Issue is almost identical to the data coming from GitHub.
 */
Issue.getFromGH = function(data) {
   var issueData = {
      number: data.number,
      title: data.title,
      status: data.state,
      dateCreated: new Date(data.created_at),
      dateClosed: new Date(data.closed_at),
      milestone: data.milestone ? {
         title: data.milestone.title,
         dueDate: new Date(data.milestone.due_on)
      } : null,
      assignee: data.assignee ? data.assignee.login : null
   };
   var issue = new Issue(issueData);
   issue.updateFromLabels(data.labels);
   return Promise.resolve(issue);
};

/**
 * A factory method to create an issue from a DBIssue.
 */
Issue.getFromDB = function(data) {
   var issueData = {
      number: data.number,
      title: data.title,
      status: data.state,
      dateCreated: utils.fromUnixTime(data.dateCreated),
      dateClosed: utils.fromUnixTime(data.dateClosed),
      milestone: data.milestone_title ? {
         title: data.milestone_title,
         dueDate: utils.fromUnixTime(data.milestone_due_on)
      } : null,
      difficulty: data.difficulty,
      assignee: data.assignee
   };
   return new Issue(issueData);
};
module.exports = Issue;
