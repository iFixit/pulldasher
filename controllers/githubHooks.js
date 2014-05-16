var config = require('../config'),
    Pull = require('../models/pull'),
    Status = require('../models/status'),
    dbManager = require('../lib/db-manager');

function newCommit(number, sha, sender, recent) {

   Pull.update({'number':number}, {
           head: sha,
           st: { qa: 0, cr: 0 },
           confirms: { qa: [], cr: [] },
           state: 'unknown',
           lastCommitter: sender,
           recent: recent,
           qaStatus: "bad",
           crStatus: "bad"
         }, function(err, pull) {
       if (err) {
         return console.log(err);
       } else {
         Pull.publishUpdate([ pull.id ], pull);
       }
   });
}

function newComment(number, comment) {
   var cr = 0
     , qa = 0
     , block = 0
     , qareg = /QA\s:.+:/
     , crreg = /CR\s:.+:/
     , blockreg = /DEV_BLOCK(?!~)/i
     , noDeployreg = /NO_DEPLOY(?!~)/i;

   Pull.findByNumber(number, function(err,pull) {
       if (err) return sails.log.warn(err);
       else {

         if (crreg.exec(comment.body)) {
           var conf = { 'time': comment.created_at, 'user': comment.user };
           pull.st.cr++;
           pull.crStatus = pull.st.cr > 1 ? "good" : "bad";
           pull.confirms.cr.push(conf);
           pull['allst'].cr++;
           pull.allConfirms.cr.push(conf);
         }

         if (qareg.exec(comment.body)) {
           var conf = { 'time': comment.created_at, 'user': comment.user };
           pull.qaStatus = "good";
           pull.st.qa++;
           pull.confirms.qa.push(conf);
           pull.allst.qa++;
           pull.allConfirms.qa.push(conf);
         }

         if (blockreg.exec(comment.body)) {
           pull.blocked = true;
         }

         if (noDeployreg.exec(comment.body)) {
           pull.no_deploy = true;
         }

         Pull.update({'number':number}, {
           blocked : pull.blocked,
           no_deploy: pull.no_deploy,
           crStatus: pull.crStatus,
           qaStatus: pull.qaStatus,
           st : pull.st,
           allst : pull.allst,
           confirms : pull.confirms,
           allConfirms : pull.allConfirms
           }, function(err, pull) {
             if (err) return sails.log.warn(err)
             else {
               Pull.publishUpdate([pull.id], pull);
             }
           });
       }
   });
}

function stateChange(number, sha, state, ref) {
   Pull.findByNumber(number, function(err,pull) {
       if (err) return console.log(err);
       else {
         Pull.update({'number': number },{
           'state': state,
           'build_url': 'http://www.***REMOVED***/ifixit/' + ref + '--' + sha + '.log'
           }, function(err,pull) {
             console.log(pull);
             if (err) return console.log(err);
             else Pull.publishUpdate([pull.id], pull);
         });
       }
   });
}

function newPull(number, pull) {

   Pull.create( { 'number': number,
                  name: pull.title,
                  recent: pull.updated_at,
                  head: pull.head.sha,
                  repo: pull.head.repo.html_url,
                  lastCommitter: pull.head.user,
                  st : { cr: 0, qa:0 },
                  confirms : { cr: [], qa: [] },
                  allst : { cr: 0, qa:0 },
                  allConfirms : { cr: [], qa: [] },
                  qaStatus: "bad",
                  crStatus: "bad",
                  blocked: false,
                  no_deploy: false,
                  state: 'unknown',
                  build_url: 'not.a.url',
                  creator: pull.user
                }).done(function(err,pull) {
                  if(err) return console.log(err);
                  else Pull.publishCreate(pull);
                  });
}

function closePull(number) {
   console.log('killing', number);

   Pull.find({'number':number}, function(err,pull) {
       if (err) return console.log(err);
       else {
         Pull.destroy({ 'id': pull.id }, function(err) {
           if (err) return console.log(err);
           else {
             console.log('Deleted', number);
             Pull.publishDestroy(pull);
             }
         });
       }
   });
}

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
      }

      if (event === 'pull_request') {
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
      }

      if (event === 'issue_comment') {
         // Comment created.

         // Update comments DB table with body.issue.number, body.comment
         // if issue is pull_request.
      }

      // Emit notification to pullManager to update the view via the DB.

      return res.status(200).send('Success!');
   }

};
module.exports = HooksController;
