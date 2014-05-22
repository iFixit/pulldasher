var util = require('util');
var events = require('events');
var _ = require('underscore');
var Signature = require('./signature')

function Pull(data, comments, headCommit) {
   this.data = data || {};
   this.signatures = Signature.createFromGithubComments(comments, data.number);
   this.headCommit = headCommit;
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
 * Get all the *active* signatures of a given tag. The definition of
 * active depends on the tag.
 *
 * For QA/CR, active means the QA/CR signatures which occur after the last commit.
 *
 * For dev/deploy_block, active means the last dev/deploy_block signature
 * (max of one, usually 0) that occurs after the last un_dev/deploy_block (if any).
 *
 * The same as above applies for un_dev/deploy_block, however these block-cancelation
 * signatures must appear after the block signature (visa-versa of above).
 */
Pull.prototype.getActiveSignatures = function getActiveSignatures(tagName)
{
   function buildFilterReturningSignaturesMatchingTag(tagName)
   {
      return function filter(signature)
      {
         return signature.data.type == tagName;
      };
   }

   var signatures = this.signatures.filter(
      buildFilterReturningSignaturesMatchingTag(tagName)
   );

   function buildFilterReturningSignaturesAfterDate(date)
   {
      return function filter(signature)
      {
         return new Date(signature.data.created_at) > date;
      };
   }

   // returns an array with zero or one elements
   // This function is just so that we don't have to repeat this logic several times below.
   // Its use is best explained in an example.
   // ex:
   //   getLastSignatureFromBAfterA(un_dev_blockSignatures, dev_blockSignatures)
   //   returns the last dev_block signature from dev_blockSignatures only if it occurs after
   //   the last un_dev_block signature. If un_dev_blockSignatures is empty, simply returns the last
   //   dev_block signature.
   //   
   //   Warning!! mutates passed arrays
   function getLastSignatureFromBAfterA(signaturesA, signaturesB)
   {
      var lastDate = signaturesA.length ?
         new Date(signaturesA[signaturesA.length - 1].data.created_at) :
         null;

      if (lastDate)
      {
         signaturesB = signaturesB.filter(
            buildFilterReturningSignaturesAfterDate(lastDate)
         );
      }

      if (signaturesB.length)
      {
         signaturesB = signaturesB.slice(-1);
      }

      return signaturesB;
   }

   switch (tagName)
   {
      case 'QA':
      case 'CR':
         var headCommitDate = new Date(this.headCommit.commit.committer.date);
         signatures = signatures.filter(
            buildFilterReturningSignaturesAfterDate(headCommitDate)
         );
         break;
      case 'un_dev_block':
         signatures = getLastSignatureFromBAfterA(
            this.signatures.filter(
               buildFilterReturningSignaturesMatchingTag('dev_block')
            ),
            signatures
         );
         break;
      case 'dev_block':
         signatures = getLastSignatureFromBAfterA(
            this.signatures.filter(
               buildFilterReturningSignaturesMatchingTag('un_dev_block')
            ),
            signatures
         );
         break;
      case 'un_deploy_block':
         signatures = getLastSignatureFromBAfterA(
            this.signatures.filter(
               buildFilterReturningSignaturesMatchingTag('deploy_block')
            ),
            signatures
         );
         break;
      case 'deploy_block':
         signatures = getLastSignatureFromBAfterA(
            this.signatures.filter(
               buildFilterReturningSignaturesMatchingTag('un_deploy_block')
            ),
            signatures
         );
         break;
      default:
         throw new Error('Unknown tag name: ' + tagName);
   }

   return signatures;
};
