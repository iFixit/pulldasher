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
 * Get all signatures of a given tag. This function returns *all* the signatures
 * (whether or not they are active). To get all active signatures of a given tag,
 * use getActiveSignatures().
 */
Pull.prototype.getSignatures = function getSignatures(tagName)
{
   return this.signatures.filter(
      function(signature)
      {
         return signature.data.type == tagName;
      }
   );
};

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

   var signatures = this.getSignatures(tagName);

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
            this.getSignatures('dev_block'), signatures
         );
         break;
      case 'dev_block':
         signatures = getLastSignatureFromBAfterA(
            this.getSignatures('un_dev_block'), signatures
         );
         break;
      case 'un_deploy_block':
         signatures = getLastSignatureFromBAfterA(
            this.getSignatures('deploy_block'), signatures
         );
         break;
      case 'deploy_block':
         signatures = getLastSignatureFromBAfterA(
            this.getSignatures('un_deploy_block'), signatures
         );
         break;
      default:
         throw new Error('Unknown tag name: ' + tagName);
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
 *    'dev_block'     : The last 'dev_block' signature occuring after the
 *                       last 'un_dev_block' signature. If there is no
 *                       un_dev_block' signature, this field holds the
 *                       last 'dev_block' signature. If there are none,
 *                       this field is null.
 *    'deploy_block'  : Same as above .. substituting deploy for dev.
 *    'ready'         : A boolean indicating whether the pull is ready to be deployed.
 *                      A pull that is ready to be deployed meets the following condition:
 *                         deploy_block === null && dev_block === null &&
 *                         CR.length >= cr_req && QA.length >= qa_req
 * }
 */
Pull.prototype.getStatus = function getStatus()
{
   var status = {
      // TODO get these from the pull's comment or default if the pull doesn't specify
      'qa_req' : 1,
      'cr_req' : 2,
      'QA' : this.getActiveSignatures('QA'),
      'CR' : this.getActiveSignatures('CR'),
   };

   status['dev_block'] = this.getActiveSignatures('dev_block');
   status['dev_block'] = status['dev_block'].length ? status['dev_block'][0] : null;

   status['deploy_block'] = this.getActiveSignatures('deploy_block');
   status['deploy_block'] = status['deploy_block'].length ? status['deploy_block'][0] : null;

   status['ready'] =
            status['dev_block'] === null &&
            status['deploy_block'] === null &&
            status['QA'].length >= status['qa_req'] &&
            status['CR'].length >= status['cr_req'];

   return status;
};
