var config = require('./config'),
    httpServer,
    express = require('express'),
    partials = require('express-partials'),
    passport = require('./lib/authentication'),
    socketAuthenticator = require('./lib/socket-auth'),
    pullManager = require('./lib/pull-manager')(),
    main = require('./controllers/main.js'),
    pullController = require('./controllers/pull.js')(pullManager),
    authController = require('./controllers/auth.js');

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
authController(app);
app.get('/',         main.index);
app.get('/pull',     pullController.index);
app.get('/pull/add', pullController.add);


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
