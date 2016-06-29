var config = require('./config'),
    _ = require('underscore'),
    httpServer,
    express = require('express'),
    partials = require('express-partials'),
    Promise = require('promise'),
    authManager = require('./lib/authentication'),
    passport = authManager.passport,
    socketAuthenticator = require('./lib/socket-auth'),
    queue = require('./lib/pull-queue.js'),
    refresh = require('./lib/refresh.js'),
    pullManager = require('./lib/pull-manager'),
    dbManager = require('./lib/db-manager'),
    gitManager = require('./lib/git-manager'),
    Signature = require('./models/signature'),
    mainController = require('./controllers/main'),
    hooksController = require('./controllers/githubHooks'),
    debug = require('debug')('pulldasher'),
    reqLogger = require('debug')('pulldasher:server:request');

var args = process.argv.slice(2);
var app = express();

httpServer = require('http').createServer(app);

app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');


/**
 * Middleware
 */
app.use("/public", express.static(__dirname + '/public'));
app.use("/spec", express.static(__dirname + '/views/current/spec'));
app.use("/css", express.static(__dirname + '/views/current/css'));
app.use("/html", express.static(__dirname + '/views/current/html'));
app.use("/fonts", express.static(__dirname + '/bower_components/bootstrap/dist/fonts'));
app.use("/lib", express.static(__dirname + '/bower_components'));
app.use(partials());
app.use(express.bodyParser());
app.use(express.cookieParser());
app.use(express.session({secret: config.session.secret}));
app.use(passport.initialize());
app.use(passport.session());

app.use(function(req, res, next) {
   reqLogger("%s %s", req.method, req.url);
   next();
});


/**
 * Routes
 */
authManager.setupRoutes(app);
app.get('/',            mainController.index);
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

         updates.push(
            dbManager.deleteLabels(pull.data.number).then(function() {
               return dbManager.insertLabels(pull.labels, pull.data.number);
            })
         );

         return Promise.all(updates);
      });
   });
}

/**
 * Refreshes the specified pull.
 */
function refresh(number) {
   queue.pause();
   gitManager.getPull(number).
   then(parseAndUpdate).
   done(queue.resume.bind(queue));
}

/**
 * Parse the pull and update the database with the new data
 */
function parseAndUpdate(gPull) {
   // This returns a promise because it has to get more data
   var pull = gitManager.parse(gPull);
   return update(pull);
}

/**
 * Refreshes all open pulls. If parameter `all` is true, refreshes all pulls,
 * open *and* closed.
 */
function refreshAll(all) {
   var githubPulls;

   if (all === true) {
      debug("rebuilding all pulls");
      githubPulls = gitManager.getAllPulls();
   } else {
      debug("rebuilding all open pulls");
      githubPulls = gitManager.getOpenPulls();
   }

   githubPulls.done(function(gPulls) {
      debug("done retrieving pulls");
      function next() {
         if (!gPulls.length) {
            debug("done building all pulls");
            return;
         }

         var gPull = gPulls.shift();
         debug("building pull %s", gPull.number);

         queue.pause();
         var pull = gitManager.parse(gPull);

         update(pull).done(function() {
            queue.resume();
            next();
         });
      };
      next();
   });
}

// Gets all pulls, open and closed, if argument is passed.
var all = _.contains(args, 'rebuild-history');

// Called, to populate app, on startup.
refreshAll(all);

/*
@TODO: Update pulls which were open last time Pulldasher ran but are closed now.
dbManager.closeStalePulls();
*/


//====================================================
// Socket.IO
var io = require('socket.io').listen(httpServer);
io.sockets.on('connection', function (socket) {
   socket.on('authenticate', function(token) {
      // They did respond. No need to drop their connection for not responding.
      clearTimeout(autoDisconnect);

      var user = socketAuthenticator.retrieveUser(token);
      if (user) {
         socket.emit('authenticated');
         pullManager.addSocket(socket);
      } else {
         socket.emit('unauthenticated');
         socket.disconnect();
      }
   });

   socket.on('refresh', function(number) {
      refresh(number);
   });

   var unauthenticated_timeout = config.unauthenticated_timeout !== undefined ?
      config.unauthenticated_timeout : 10 * 1000;

   var autoDisconnect = setTimeout(function() {
      socket.disconnect();
   }, unauthenticated_timeout);
});

httpServer.listen(config.port);
