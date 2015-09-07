var utils   = require('../lib/utils');
var _       = require('underscore');
var config  = require('../config');

/**
 * Create a new issue.
 */
function Issue(data) {
   _.extend(this, data);
}

Issue.prototype.difficulty = function() {
   if (!this.difficulty) {
      this.parseLabels();
   }
   return this.difficulty;
};

/**
 * Create properties on this object for each label it has of the configured
 * labels.
 */
Issue.prototype.parseLabels = function() {
   config.labels.forEach(function(labelConfig) {
      this.labels.forEach(function(label) {
         if (labelConfig.regex.test(label.name)) {
            this[labelConfig.name] = label.name;
         }
      });
   });
};

/**
 * A factory method to create an issue from GitHub data. Currently, the data
 * in Issue is almost identical to the data coming from GitHub.
 */
Issue.getFromGH = function(data) {
   var issueData = {
      number: data.number,
      title: data.title,
      milestone: data.milestone ? {
         title: data.milestone.title,
         dueDate: utils.toUnixTime(data.milestone.due_on)
      } : null
   };
   return new Issue(data);
};

/**
 * A factory method to create an issue from a DBIssue.
 */
Issue.getFromDB = function(data) {
   var issueData = {
      number: data.number,
      title: data.title,
      milestone: data.milestone_title ? {
         title: data.milestone_title,
         dueDate: data.milestone_due_on
      } : null,
      difficulty: data.difficulty
   };
   return new Issue(issueData);
};
module.exports = Issue;
