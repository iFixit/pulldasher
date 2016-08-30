var config = require('./config'),
    httpServer,
    express = require('express'),
    partials = require('express-partials'),
    authManager = require('./lib/authentication'),
    passport = authManager.passport,
    socketAuthenticator = require('./lib/socket-auth'),
    refresh = require('./lib/refresh.js'),
    pullManager = require('./lib/pull-manager'),
    mainController = require('./controllers/main'),
    hooksController = require('./controllers/githubHooks'),
    reqLogger = require('debug')('pulldasher:server:request'),
    debug = require('debug')('pulldasher');

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
app.use(express.urlencoded());
app.use(express.json());
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

// Called, to populate app, on startup.
refresh.openPulls();

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
      refresh.pull(number);
   });

   var unauthenticated_timeout = config.unauthenticated_timeout !== undefined ?
      config.unauthenticated_timeout : 10 * 1000;

   var autoDisconnect = setTimeout(function() {
      socket.disconnect();
   }, unauthenticated_timeout);
});

debug("Listening on port %s", config.port);
httpServer.listen(config.port);
