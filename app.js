var config = require('./config'),
    httpServer,
    express = require('express'),
    partials = require('express-partials'),
    authManager = require('./lib/authentication'),
    passport = authManager.passport,
    socketAuthenticator = require('./lib/socket-auth'),
    pullManager = require('./lib/pull-manager'),
    dbManager = require('./lib/db-manager'),
    gitManager = require('./lib/git-manager'),
    Pull = require('./models/pull'),
    Signature = require('./models/signature'),
    mainController = require('./controllers/main'),
    pullController = require('./controllers/pull')(pullManager),
    hooksController = require('./controllers/githubHooks');

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
app.use(express.logger());


/**
 * Routes
 */
authManager.setupRoutes(app);
app.get('/',         mainController.index);
app.get('/pull',     pullController.index);
app.get('/pull/add', pullController.add);
app.post('/hooks/main', hooksController.main);

/**
 * On first run, get all the open pulls, add them to the view,
 * and update the DB to reflect any changes since last run.
 */
gitManager.getAllPulls().done(function(arrayOfPullPromises) {
   arrayOfPullPromises.forEach(function(pullPromise) {
      pullPromise.done(function(pull) {
         dbManager.updatePull(pull).done(function() {
            if (pull.commitStatus) {
               dbManager.updateCommitStatus(pull.commitStatus);
            }
         });

         // Delete all signatures related to this pull from the DB
         // before we rewrite them to avoid duplicates.
         dbManager.deleteSignatures(pull.data.number).done(function() {
            pull.signatures.sort(Signature.compare);
            dbManager.insertSignatures(pull.signatures);
         });

         pull.comments.forEach(function(comment) {
            dbManager.updateComment(comment);
         });
      });
   });

   // Update pulls which were open last time Pulldasher ran but are closed now.
   // @TODO dbManager.closeStalePulls();
});
//====================================================
// Socket.IO

var io = require('socket.io').listen(httpServer);
io.set('log level', 2);
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
   var autoDisconnect = setTimeout(function() {
      socket.disconnect();
   }, 10*1000);
});

httpServer.listen(config.port);
