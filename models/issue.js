var utils   = require('../lib/utils');
var _       = require('underscore');
var config  = require('../config');
var log     = require('debug')('pulldasher:issue');
var Promise = require('promise');
var DBIssue = require('./db_issue');

/**
 * Create a new issue. Not meant to be used directly, see
 * Issue.getFromGH or Issue.getFromDB
 */
function Issue(data, labels) {
   _.extend(this, data);
   if (labels) {
      this.updateFromLabels(labels);
   }
}

/**
 * Create properties on this object for each label it has of the configured
 * labels.
 *
 * @labels: array of Label objects
 */
Issue.prototype.updateFromLabels = function(labels) {
   var self = this;
   if (labels) {
      log("Processing %s labels on #%s", labels.length, self.number);
      (config.labels || []).forEach(function(labelConfig) {
         self[labelConfig.name] = null;
         labels.forEach(function(label) {
            var labelName = label.data.title;
            log("Testing label '%s' against regex %s", labelName, labelConfig.regex);
            if (labelConfig.regex.test(labelName)) {
               log("Setting %s on #%s because of a label reading %s",
                labelConfig.name, self.number, labelName);

               if (labelConfig.process) {
                  self[labelConfig.name] = labelConfig.process(labelName);
               } else {
                  self[labelConfig.name] = labelName;
               }
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
Issue.getFromGH = function(data, labels) {
   var issueData = {
      number: data.number,
      title: data.title,
      status: data.state,
      date_created: new Date(data.created_at),
      date_closed: new Date(data.closed_at),
      milestone: data.milestone ? {
         title: data.milestone.title,
         due_on: new Date(data.milestone.due_on)
      } : null,
      assignee: data.assignee ? data.assignee.login : null,
      labels: labels || [],
   };

   return new Issue(issueData, labels);
};

/**
 * A factory method to create an issue from a DBIssue.
 */
Issue.getFromDB = function(data, labels) {
   var issueData = {
      number: data.number,
      title: data.title,
      status: data.state,
      date_created: utils.fromUnixTime(data.date_created),
      date_closed: utils.fromUnixTime(data.date_closed),
      milestone: data.milestone_title ? {
         title: data.milestone_title,
         due_on: utils.fromUnixTime(data.milestone_due_on)
      } : null,
      difficulty: data.difficulty,
      assignee: data.assignee,
      labels: labels || []
   };
   return new Issue(issueData, labels)
};

module.exports = Issue;
