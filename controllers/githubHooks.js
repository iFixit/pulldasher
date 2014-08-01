var config = require('../config'),
    Promise = require('promise'),
    Pull = require('../models/pull'),
    Status = require('../models/status'),
    Signature = require('../models/signature'),
    Comment = require('../models/comment'),
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
         // Promise that resolves when everything that needs to be done before
         // we call `updatePull` has finished.
         var preUpdate = Promise.resolve();

         switch(body.action) {
            case "opened":
            case "reopened":
            case "closed":
            case "merged":
               break;
            case "synchronize":
               preUpdate = dbManager.invalidateSignatures(
                  body.pull_request.number,
                  ['QA', 'CR']
               );
         }

         // Update DB with new pull request content.
         preUpdate.done(function() {
            dbManager.updatePull(new Pull(body.pull_request));
         });
      } else if (event === 'issue_comment') {
         // Parse any signature(s) out of the comment.
         var sigs = Signature.parseComment(body.comment, body.issue.number);
         dbManager.insertSignatures(sigs);

         body.comment.number = body.issue.number;
         body.comment.repo = body.repository.name;
         var comment = new Comment(body.comment);

         dbManager.updateComment(comment);
      }

      return res.status(200).send('Success!');
   }

};

module.exports = HooksController;
