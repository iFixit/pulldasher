var utils   = require('../lib/utils');
var _       = require('underscore');
var config  = require('../config');

function Pull(data, signatures, comments, commitStatus, labels) {
   this.data = {
      number: data.number,
      state: data.state,
      title: data.title,
      body: data.body,
      created_at: new Date(data.created_at),
      updated_at: new Date(data.updated_at),
      closed_at: new Date(data.closed_at),
      merged_at: new Date(data.merged_at),
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
         ref: data.base.ref
      },
      user: {
         login: data.user.login
      }
   };

   this.signatures = signatures || [];
   this.comments = comments || [];
   this.commitStatus = commitStatus;
   this.labels = labels || [];

   // If github pull-data, parse the body for the cr and qa req... else
   // use the values stored in the db.
   if (typeof data.cr_req === 'undefined') {
      var bodyTags = Pull.parseBody(this.data.body);
      this.data.cr_req = bodyTags['cr_req'];
      this.data.qa_req = bodyTags['qa_req'];
   } else {
      this.data.cr_req = data.cr_req;
      this.data.qa_req = data.qa_req;
   }
}

Pull.prototype.toObject = function() {
   var data = _.extend({}, this.data);
   data.status = this.getStatus();
   data.labels = this.labels.map(function(label) { return label.data });
   return data;
};

/**
 * Get all signatures of a given tag.
 */
Pull.prototype.getSignatures = function getSignatures(tagName) {
   return this.signatures.filter(function(signature) {
      return signature.data.type === tagName;
   });
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
 *    'commit_status' : A Status object or null.
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
      'dev_block'    : this.getSignatures('dev_block'),
      'deploy_block' : this.getSignatures('deploy_block'),
      'commit_status' : this.commitStatus
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

/**
 * Takes an object representing a DB row, and returns an instance of this
 * Pull object.
 */
Pull.getFromDB = function(data, signatures, comments, commitStatus, labels) {
   var pullData = {
      number: data.number,
      state: data.state,
      title: data.title,
      body: data.body,
      created_at: utils.fromUnixTime(data.date),
      updated_at: utils.fromUnixTime(data.date_updated),
      closed_at: utils.fromUnixTime(data.date_closed),
      merged_at: utils.fromUnixTime(data.date_merged),
      head: {
         ref: data.head_branch,
         sha: data.head_sha,
         repo: {
            owner: {
               login: data.repo_owner
            },
            name: data.repo_name
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

   return new Pull(pullData, signatures, comments, commitStatus, labels);
}

module.exports = Pull;
