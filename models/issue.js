import utils from "../lib/utils.js";
import _ from "underscore";
import config from "../lib/config-loader.js";
import log from "../lib/debug.js";
import DBIssue from "./db_issue.js";
import getLogin from "../lib/get-user-login.js";

const debug = log("pulldasher:issue");

/**
 * Create a new issue. Not meant to be used directly, see
 * Issue.getFromGH or Issue.getFromDB
 */
class Issue {
  constructor(data, labels) {
    _.extend(this, data);
    if (labels) {
      this.updateFromLabels(labels);
    }
  }

  static findByNumber(repo, number) {
    return DBIssue.findByNumber(repo, number).then(Issue.getFromDB);
  }

  /**
   * Create properties on this object for each label it has of the configured
   * labels.
   *
   * @labels: array of Label objects
   */
  updateFromLabels(labels) {
    const self = this;
    if (labels) {
      debug("Processing %s labels on #%s", labels.length, self.number);
      (config.labels || []).forEach((labelConfig) => {
        self[labelConfig.name] = null;
        labels.forEach((label) => {
          const labelName = label.data.title;
          debug(
            "Testing label '%s' against regex %s",
            labelName,
            labelConfig.regex
          );
          if (labelConfig.regex.test(labelName)) {
            debug(
              "Setting %s on #%s because of a label reading %s",
              labelConfig.name,
              self.number,
              labelName
            );

            if (labelConfig.process) {
              self[labelConfig.name] = labelConfig.process(labelName);
            } else {
              self[labelConfig.name] = labelName;
            }
          }
        });
      });
    } else {
      debug("No labels on %s", self.number);
    }
  }

  /**
   * A factory method to create an issue from GitHub data. Currently, the data
   * in Issue is almost identical to the data coming from GitHub.
   */
  static getFromGH(data, labels) {
    const issueData = {
      repo: data.repo,
      number: data.number,
      title: data.title,
      status: data.state,
      date_created: new Date(data.created_at),
      date_closed: utils.fromDateString(data.closed_at),
      milestone: data.milestone
        ? {
          title: data.milestone.title,
          due_on: new Date(data.milestone.due_on),
        }
        : null,
      assignee: getLogin(data.assignee),
      labels: labels || [],
    };

    return new Issue(issueData, labels);
  }

  /**
   * A factory method to create an issue from a DBIssue.
   */
  static getFromDB(data, labels) {
    const issueData = {
      repo: data.repo,
      number: data.number,
      title: data.title,
      status: data.status,
      date_created: utils.fromUnixTime(data.date_created),
      date_closed: utils.fromUnixTime(data.date_closed),
      milestone: data.milestone_title
        ? {
          title: data.milestone_title,
          due_on: utils.fromUnixTime(data.milestone_due_on),
        }
        : null,
      difficulty: data.difficulty,
      assignee: data.assignee,
      labels: labels || [],
    };
    return new Issue(issueData, labels);
  }
}

export default Issue;
