var config = require('./lib/config-loader'),
    express = require('express'),
    bodyParser = require('body-parser'),
    expressSession = require('express-session'),
    authManager = require('./lib/authentication'),
    passport = authManager.passport,
    socketAuthenticator = require('./lib/socket-auth'),
    refresh = require('./lib/refresh'),
    pullManager = require('./lib/pull-manager'),
    dbManager = require('./lib/db-manager'),
    pullQueue  = require('./lib/pull-queue'),
    mainController = require('./controllers/main'),
    hooksController = require('./controllers/githubHooks'),
    reqLogger = require('./lib/debug')('pulldasher:server:request'),
    debug = require('./lib/debug')('pulldasher');

var app = express();
var httpServer = require('http').createServer(app);
const maxPostSize = 1024*1024;

app.set('view engine', 'html');

/**
 * Middleware
 */
app.use("/public", express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({ limit: maxPostSize, extended: false }));
app.use(bodyParser.json({limit: maxPostSize}));
app.use(expressSession({
   secret: config.session.secret,
   resave: false,
   saveUninitialized: false
}));
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
app.use("/", express.static(__dirname + '/frontend/dist'));
app.get('/token',       mainController.getToken);
app.post('/hooks/main', hooksController.main);

debug("Loading all recent pulls from the DB");
dbManager.getRecentPulls(pullManager.getOldestAllowedPullTimestamp())
.then(function(pulls) {
   debug("Loaded %s pulls", pulls.length);
   pullQueue.pause();
   pulls.forEach(function(pull) {
      pullManager.updatePull(pull);
   });
   pullQueue.resume();
}).then(function() {
   debug("Refreshing all open pulls from the API");
   refresh.openPulls();
}).done();

/*
@TODO: Update pulls which were open last time Pulldasher ran but are closed now.
dbManager.closeStalePulls();
*/


//====================================================
// Socket.IO
const { Server } = require('socket.io');
const io = new Server(httpServer);
io.on('connection', function (socket) {
   var unauthenticated_timeout = config.unauthenticated_timeout !== undefined ?
      config.unauthenticated_timeout : 10 * 1000;

   var autoDisconnect = setTimeout(function() {
      socket.disconnect();
   }, unauthenticated_timeout);

   socket.once('authenticate', function(token) {
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

   socket.on('refresh', function(repo, number) {
      refresh.pull(repo, number);
   });
});

debug("Listening on port %s", config.port);
httpServer.listen(config.port);
