var config = require('../config'),
    Pull = require('../models/pull'),
    Status = require('../models/status'),
    Signature = require('../models/signature'),
    dbManager = require('../lib/db-manager');

var HooksController = {

   main: function(req, res) {

      var secret = req.param('secret');
      if (secret != config.github.hook_secret) {
         console.log('Invalid Hook Secret: ', secret);
         return res.status(401).send('Invalid POST');
      }

      // Begin the webhook decoding
      var body = JSON.parse(req.body.payload);
      var event = req.get('X-GitHub-Event');

      if (event === 'status') {
         dbManager.updateCommitStatus(new Status(body));
      } else if (event === 'pull_request') {
         switch(body.action) {
            case "opened":
            case "reopened":
            case "closed":
            case "merged":
            case "synchronize":
               // @TODO: Deactivate current CR, QA signoffs. Do NOT deactivate
               //  dev_block, deploy_block comments.
         }

         // Update DB with new pull request content.
         dbManager.updatePull(new Pull(body.pull_request));
      } else if (event === 'issue_comment') {
         // Parse any signature(s) out of the comment.
         var sigs = Signature.parseComment(body.comment, body.issue.number);

         sigs.forEach(function(sig) {
            dbManager.insertSignature(sig);
         });
      }

      // Emit notification to pullManager to update the view via the DB.

      return res.status(200).send('Success!');
   }

};

module.exports = HooksController;
