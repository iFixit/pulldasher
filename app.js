var config = require('./config'),
    httpServer,
    express = require('express'),
    partials = require('express-partials'),
    Promise = require('promise'),
    authManager = require('./lib/authentication'),
    passport = authManager.passport,
    socketAuthenticator = require('./lib/socket-auth'),
    queue = require('./lib/pull-queue.js'),
    pullManager = require('./lib/pull-manager'),
    dbManager = require('./lib/db-manager'),
    gitManager = require('./lib/git-manager'),
    Pull = require('./models/pull'),
    Signature = require('./models/signature'),
    mainController = require('./controllers/main'),
    pullController = require('./controllers/pull')(pullManager),
    hooksController = require('./controllers/githubHooks'),
    reqLogger = require('debug')('pulldasher:server:request');
    resLogger = require('debug')('pulldasher:server:response');

var app = express();

httpServer = require('http').createServer(app)

app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');


/**
 * Middleware
 */
app.use("/public", express.static(__dirname + '/public'));
app.use(partials());
app.use(express.bodyParser());
app.use(express.cookieParser());
app.use(express.session({secret: config.session.secret}));
app.use(passport.initialize());
app.use(passport.session());

app.use(function(req, res, next) {
   reqLogger(req.headers);
   resLogger(res.headers);
   next();
});;


/**
 * Routes
 */
authManager.setupRoutes(app);
app.get('/',         mainController.index);
app.get('/pull',     pullController.index);
app.get('/pull/add', pullController.add);
app.post('/hooks/main', hooksController.main);


/**
 * Accepts a promise that resolves to a pull, adds it to the view, updates the
 * DB to reflect any changes.
 */
function update(pullPromise) {
   return pullPromise.then(function(pull) {
      return dbManager.updatePull(pull).then(function() {
         var updates = [];

         if (pull.commitStatus) {
            updates.push(
               dbManager.updateCommitStatus(pull.commitStatus)
            );
         }

         updates.push(
            // Delete all signatures related to this pull from the DB
            // before we rewrite them to avoid duplicates.
            dbManager.deleteSignatures(pull.data.number).then(function() {
               pull.signatures.sort(Signature.compare);
               return dbManager.insertSignatures(pull.signatures);
            })
         );

         pull.comments.forEach(function(comment) {
            updates.push(
               dbManager.updateComment(comment)
            );
         });

         return Promise.all(updates);
      });
   });
}

/**
 * Refreshes the specified pull.
 */
function refresh(number) {
   var githubPull = gitManager.getPull(number);

   queue.pause();

   githubPull.done(function(gPull) {
      var pullPromise = gitManager.parse(gPull);
      update(pullPromise).done(function() {
         queue.resume();
      });
   });
}

/**
 * Refreshes all open pulls.
 */
function refreshAll() {
   var githubPulls = gitManager.getAllPulls();

   queue.pause();

   githubPulls.done(function(gPulls) {
      var pullsUpdated = gPulls.map(function(gPull) {
         var pull = gitManager.parse(gPull);

         return new Promise(function(resolve, reject) {
            update(pull).done(function() {
               resolve();
            });
         });
      });

      Promise.all(pullsUpdated).done(function() {
         queue.resume();
      });
   });
}


// Called, to populate app, on startup.
refreshAll();

/*
@TODO: Update pulls which were open last time Pulldasher ran but are closed now.
dbManager.closeStalePulls();
*/


//====================================================
// Socket.IO

var io = require('socket.io').listen(httpServer);
io.sockets.on('connection', function (socket) {
   socket.on('authenticate', function(token) {
      var user = socketAuthenticator.retrieveUser(token);
      if (user) {
         socket.emit('authenticated');
         pullManager.addSocket(socket);
         clearTimeout(autoDisconnect);
      } else {
         socket.disconnect();
      }
   });

   socket.on('refresh', function(number) {
      if (number) {
         refresh(number);
      } else {
         refreshAll();
      }
   });

   var autoDisconnect = setTimeout(function() {
      socket.disconnect();
   }, 10*1000);
});

httpServer.listen(config.port);
