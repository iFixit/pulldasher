var util = require('util');
var events = require('events');
var _ = require('underscore');
var Signature = require('./signature');
var config = require('../config');

function Pull(data, signatures, headCommit) {
   this.data = {
      number: data.number,
      state: data.state,
      title: data.title,
      body: data.body,
      created_at: data.created_at,
      updated_at: data.updated_at,
      closed_at: data.closed_at,
      merged_at: data.merged_at,
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
   this.headCommit = headCommit || undefined;
}

Pull.prototype.toObject = function () {
   return _.extend({}, this.data);
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
 * }
 */
Pull.prototype.getStatus = function getStatus() {
   var status = {
      // TODO get these from the pull's comment or default
      // if the pull doesn't specify
      'qa_req' : config.default_qa_req,
      'cr_req' : config.default_cr_req,
      'QA' : this.getSignatures('QA'),
      'CR' : this.getSignatures('CR'),
      'dev_block'    : this.getSignatures('dev_block'),
      'deploy_block' : this.getSignatures('deploy_block')
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
 * Takes an object representing a DB row, and returns an object which mimics
 * a GitHub API response which may be used to initialize an instance of this
 * Pull object.
 */
Pull.getFromDB = function(data) {
   return {
      number: data.number,
      state: data.state,
      title: data.title,
      body: data.body,
      created_at: data.created_at,
      updated_at: data.updated_at,
      closed_at: data.closed_at,
      merged_at: data.merged_at,
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
      }
   };
}

module.exports = Pull;
