var utils   = require('../lib/utils');
var _       = require('underscore');
var config  = require('../config');
var queue = require('../lib/pull-queue');
var Promise = require('promise');
var debug = require('../lib/debug')('pulldasher:pull');
var DBPull = require('./db_pull');
var getLogin = require('../lib/get-user-login');

function Pull(data, signatures, comments, commitStatuses, labels) {
   this.data = data;
   this.signatures = signatures || [];
   this.comments = comments || [];
   this.commitStatuses = commitStatuses || [];
   this.labels = labels || [];

   // If github pull-data, parse the body for the cr and qa req... else
   // use the values stored in the db.
   if (typeof data.cr_req === 'undefined') {
      var bodyTags = Pull.parseBody(this.data.body);
      this.data.cr_req = bodyTags['cr_req'];
      this.data.qa_req = bodyTags['qa_req'];
      this.data.closes = bodyTags['closes'];
      this.data.connects = bodyTags['connects'];
   } else {
      this.data.cr_req = data.cr_req;
      this.data.qa_req = data.qa_req;
      this.data.closes = data.closes;
      this.data.connects = data.connects;
   }

   const isPassing = () => {
      var repoConfig = config.repos.find(repo => repo.full_name === this.data.repo);
      var requiredBuilds = repoConfig.required_passing_builds;

      var passingBuilds = this.commitStatuses.filter(
         build => build.state === 'success')
         .map(build => {return build.data.context;});

      return !_.without(requiredBuilds, ...passingBuilds);
   };

   this.data.passing = isPassing();
}

Pull.prototype.update = function() {
   debug('Calling `updatePull` for pull #%s in repo %s', this.data.number,
    this.data.repo);
   var dbPull = new DBPull(this);
   var number = dbPull.data.number;
   var repo = dbPull.data.repo;

   return dbPull.save().
   then(function() {
      queue.markPullAsDirty(repo, number);
      debug('updatePull: Pull #%s updated in repo %s', number, repo);
   });
};

Pull.prototype.syncToIssue = function() {
   return Promise.resolve(this);
   /* The below needs to be rethought a bit and possibly the causal direction
    * reversed (updates to the issue should propagate to the pull).
   var Issue = require('./issue');
   var self = this;
   var connected = this.data.closes || this.data.connects;
   if (!this.data.milestone.title && connected) {
      return Issue.findByNumber(this.data.repo, connected).
      then(function(issue) {
         debug("Updating pull from issue: %s", issue.number);
         if (issue.milestone) {
            var milestone = self.data.milestone;
            milestone.title = issue.milestone.title;
            milestone.due_on = issue.milestone.due_on;
         }
         self.data.difficulty = issue.difficulty;
         return self.update();
      }).
      then(function() {
         // This makes it easier to chain a call to this function
         return self;
      });
   } else {
      return new Promise.resolve(self);
   }
   */
};

Pull.prototype.toObject = function() {
   var data = _.extend({}, this.data);
   data.status = this.getStatus();
   data.labels = this.labels.map(function(label) { return label.data; });
   return data;
};

/**
 * Get all signatures of a given tag.
 */
Pull.prototype.getSignatures = function(tagName) {
   return this.getAllSignatures(tagName).filter(function(signature) {
      return signature.data.active === 1;
   });
};

Pull.prototype.getAllSignatures = function(tagName) {
   return this.signatures.filter(function(signature) {
      return signature.data.type === tagName;
   });
};

Pull.prototype.isOpen = function() {
   return this.data.state === 'open';
};


/**
 * Return an object:
 * {
 *    'qa_req'        : The *needed* number of QA signatures occuring after the last commit
 *                       in order for this pull to be ready for deploy.
 *    'cr_req'        : The *needed* number of CR signatures occuring after the last commit
 *                       in order for this pull to be ready for deploy.
 *    'QA'            : An array of signatures occuring after latest commit with QA tags
 *    'CR'            : An array of signatures occuring after latest commit with CR tags
 *    'dev_block'     : An array containing the last 'dev_block' signature if the pull is dev blocked,
 *                       or an empty array
 *    'deploy_block'  : An array containing the last 'deploy_block' signature if pull is deploy blocked,
 *                       or an empty array
 *    'ready'         : A boolean indicating whether the pull is ready to be deployed.
 *    'commit_statuses' : A Status object or null.
 * }
 */
Pull.prototype.getStatus = function getStatus() {
   var status = {
      // TODO get these from the pull's comment or default
      // if the pull doesn't specify
      'qa_req' : this.data.qa_req,
      'cr_req' : this.data.cr_req,
      'QA' : this.getSignatures('QA'),
      'CR' : this.getSignatures('CR'),
      'allQA' : this.getAllSignatures('QA'),
      'allCR' : this.getAllSignatures('CR'),
      'dev_block'    : this.getSignatures('dev_block'),
      'deploy_block' : this.getSignatures('deploy_block'),
      'commit_statuses' : this.commitStatuses
   };

   status['ready'] =
            status['dev_block'].length === 0 &&
            status['deploy_block'].length === 0 &&
            status['QA'].length >= status['qa_req'] &&
            status['CR'].length >= status['cr_req'];

   return status;
};

/**
 * Parse body of Pull Request for special tags (e.g. cr_req, qa_req).
 */
Pull.parseBody = function(body) {
   var bodyTags = [];

   config.body_tags.forEach(function(tag) {
      var matches = body.match(tag.regex);

      if (matches) {
         bodyTags[tag.name] = matches[1];
      } else {
         bodyTags[tag.name] = tag.default;
      }
   });

   return bodyTags;
};

Pull.fromGithubApi = function(data, signatures, comments, commitStatuses, labels) {
   data = {
      repo: data.base.repo.full_name,
      number: data.number,
      state: data.state,
      title: data.title,
      body: data.body,
      created_at: utils.fromDateString(data.created_at),
      updated_at: utils.fromDateString(data.updated_at),
      closed_at: utils.fromDateString(data.closed_at),
      merged_at: utils.fromDateString(data.merged_at),
      difficulty: data.difficulty,
      milestone: {
         title: data.milestone && data.milestone.title,
         due_on: data.milestone && utils.fromDateString(data.milestone.due_on)
      },
      head: {
         ref: data.head.ref,
         sha: data.head.sha,
         repo: {
            owner: {
               login: data.head.repo.owner.login
            },
            name: data.head.repo.name
         }
      },
      base: {
         ref: data.base.ref,
      },
      user: {
         login: getLogin(data.user)
      }
   };

   return new Pull(data, signatures, comments, commitStatuses, labels);
};

/**
 * Takes an object representing a DB row, and returns an instance of this
 * Pull object.
 */
Pull.getFromDB = function(data, signatures, comments, commitStatuses, labels) {
   var pullData = {
      repo: data.repo,
      number: data.number,
      state: data.state,
      title: data.title,
      body: data.body,
      created_at: utils.fromUnixTime(data.date),
      updated_at: utils.fromUnixTime(data.date_updated),
      closed_at: utils.fromUnixTime(data.date_closed),
      merged_at: utils.fromUnixTime(data.date_merged),
      difficulty: data.difficulty,
      milestone: {
         title: data.milestone_title,
         due_on: utils.fromUnixTime(data.milestone_due_on)
      },
      head: {
         ref: data.head_branch,
         sha: data.head_sha,
         repo: {
            owner: {
               login: data.repo.split("/")[0],
            }
         }
      },
      base: {
         ref: data.base_branch
      },
      user: {
         login: data.owner
      },
      cr_req: data.cr_req,
      qa_req: data.qa_req
   };

   return new Pull(pullData, signatures, comments, commitStatuses, labels);
};

module.exports = Pull;
