var util = require('util');
var events = require('events');
var _ = require('underscore');
var Signature = require('./signature');
var config = require('../config');

function Pull(data, comments, headCommit) {
   this.data = data || {};
   this.signatures = Signature.createFromGithubComments(comments, data.number);
   this.headCommit = headCommit;
   this.updateActiveSignatures();
}
module.exports = Pull;
util.inherits(Pull, events.EventEmitter);

Pull.prototype.setData = function (data) {
   this.data = data;
   this.emit('dataChanged');
}

Pull.prototype.toObject = function () {
   var data = this.data;
   var obj = _.extend({}, data);
   return obj;
}

/**
 * Get all signatures of a given tag. This function returns *all* the signatures
 * (whether or not they are active). To get all active signatures of a given tag,
 * use getActiveSignatures().
 */
Pull.prototype.getSignatures = function getSignatures(tagName) {
   return this.signatures.filter(function(signature) {
      return signature.data.type === tagName;
   });
};

/**
 * Get all the *active* signatures of a given tag. The definition of
 * active depends on the tag.
 *
 * For QA/CR, active means the QA/CR signatures which occur after the last commit.
 *
 * For dev/deploy_block, active means the last dev/deploy_block signature
 * (max of one, usually 0) that occurs after the last un_dev/deploy_block (if any).
 */
Pull.prototype.getActiveSignatures = function getActiveSignatures(tagName) {

   var signatures = this.getSignatures(tagName);

   /**
    * Iterates through all of a pull's signatures, checking for a blocking
    * tag (e.g. 'dev_block') and returns either the last occurring, blocking
    * Signature object or (if there is no blocking signature, or if it is
    * followed by an unblocking signature) returns null.
    *
    * @param signatures - All of a pull's signatures
    * @param name - Name of blocking tag (e.g. 'dev_block')
    * @return Signature|null
    */
   function getBlockingSignature(signatures, name) {
      var block = name;
      var unblock = 'un_' + name;
      var sigType;
      // Sort signatures by date, newest first.
      signatures.sort(function(a, b) {
         return Date.parse(b.data.created_at) - Date.parse(a.data.created_at);
      });

      // Check each pull signature to see if it's a blocking or unblocking tag.
      for (var i = 0; i < signatures.length; i++) {
         sigType = signatures[i].data.type;

         if (sigType === block) { // This pull is blocked.
            return signatures[i];
         } else if (sigType === unblock) { // This pull is unblocked.
            return null;
         }
      }

      return null;
   }

   switch (tagName) {
      case 'QA':
      case 'CR':
         var headCommitDate = new Date(this.headCommit.commit.committer.date);
         signatures = signatures.filter(function afterHeadCommit(signature) {
            return new Date(signature.data.created_at) > headCommitDate;
         });
         break;
      case 'dev_block':
      case 'deploy_block':
         blockingSig = getBlockingSignature(this.signatures, tagName);
         signatures = blockingSig != null ? [blockingSig] : [];
         break;
      default:
         signatures = [];
   }

   return signatures;
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
 *    'dev_block'     : The last 'dev_block' signature if pull is dev blocked, or an empty array
 *    'deploy_block'  : The last 'deploy_block' signature if pull is deploy blocked, or an empty array
 *    'ready'         : A boolean indicating whether the pull is ready to be deployed.
 * }
 */
Pull.prototype.getStatus = function getStatus() {
   var status = {
      // TODO get these from the pull's comment or default
      // if the pull doesn't specify
      'qa_req' : config.default_qa_req,
      'cr_req' : config.default_cr_req,
      'QA' : this.getActiveSignatures('QA'),
      'CR' : this.getActiveSignatures('CR'),
   };

   status['dev_block']    = this.getActiveSignatures('dev_block');
   status['deploy_block'] = this.getActiveSignatures('deploy_block');

   status['ready'] =
            status['dev_block'].length === 0 &&
            status['deploy_block'].length === 0 &&
            status['QA'].length >= status['qa_req'] &&
            status['CR'].length >= status['cr_req'];

   return status;
};

/**
 * We can't know which signatures are active until we have all the signatures for a pull.
 * Call this method after all the signatures of this pull are synced with github.
 * This method updates the active field of all signatures.
 */
Pull.prototype.updateActiveSignatures = function updateActiveSignatures()
{
   var activeSignatures = config.tags.reduce(function getActive(activeSignatures, tagName)
   {
      return activeSignatures.concat(this.getActiveSignatures(tagName));
   }.bind(this), []);

   this.signatures.forEach(function updateActive(signature)
   {
      if (activeSignatures.indexOf(signature) != -1)
         signature.data.active = true;
      else
         signature.data.active = false;
   });
};
