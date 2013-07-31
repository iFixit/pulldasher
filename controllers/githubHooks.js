var config = require('../config');

/*---------------------
   :: Hooks
   -> controller
---------------------*/

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
         return sails.log.warn(err);
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
       if (err) return sails.log.warn(err);
       else {
         Pull.update({'number': number },{
           'state': state,
           'build_url': 'http://www.***REMOVED***/ifixit/' + ref + '--' + sha + '.log'
           }, function(err,pull) {
             sails.log.warn(pull);
             if (err) return sails.log.warn(err);
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
                  if(err) return sails.log.warn(err);
                  else Pull.publishCreate(pull);
                  });
}

function closePull(number) {
   sails.log.warn('killing',number);

   Pull.find({'number':number}, function(err,pull) {
       if (err) return sails.log.warn(err);
       else {
         Pull.destroy({ 'id': pull.id }, function(err) {
           if (err) return sails.log.warn(err);
           else {
             sails.log.info('Deleted',number);
             Pull.publishDestroy(pull);
             }
         });
       }
   });
}

var HooksController = {

   main: function(req, res) {

     var secret = req.param('secret');
     console.log('Secret',secret);
     if (secret != config.hook_secret) {
       sails.log.error('Invalid Hook Secret: ', secret);
       return res.status(401).send('Invalid POST');
     }

     // Begin the webhook decoding
     var body = req.body;
     switch(body.action) {
       // Pull opened
       case "opened":
         newPull(body.number, body.pull_request);
         break;
       // Pull reopened
       case "reopened":
         newPull(body.number, body.pull_request);
         break;
       // Pull closed
       case "closed":
         closePull(body.number);
         break;
       // Pull merged
       case "merged":
         closePull(body.number);
         break;
       // New commit to pull
       case "synchronize":
         newCommit(body.number, body.pull_request.head.sha, body.sender, body.pull_request.updated_at);
         break;
       // Comment created
       case "created":
         newComment(body.issue.number, body.comment);
         break;
       // For when state changes
       case undefined:
         if (body.pull_request) stateChange(body.pull_request.number, body.sha, body.state, body.pull_request.head.ref);
         else sails.log.warn(body);
         break;
       default:
         sails.log.warn('Got unknown webhook action:',body.action);
         break;
     }
   }

};
module.exports = HooksController;
