import config from "./lib/config-loader.js";
import express from "express";
import bodyParser from "body-parser";
import expressSession from "express-session";
import authManager from "./lib/authentication.js";
import socketAuthenticator from "./lib/socket-auth.js";
import refresh from "./lib/refresh.js";
import pullManager from "./lib/pull-manager.js";
import dbManager from "./lib/db-manager.js";
import pullQueue from "./lib/pull-queue.js";
import mainController from "./controllers/main.js";
import hooksController from "./controllers/githubHooks.js";
import Debug from "./lib/debug.js";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname } from "path";

const reqLogger = Debug("pulldasher:server:request");
const debug = Debug("pulldasher");

const app = express();
const httpServer = createServer(app);
const maxPostSize = 1024 * 1024;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.set("view engine", "html");

/**
 * Middleware
 */
app.use("/public", express.static(__dirname + "/public"));
app.use(bodyParser.urlencoded({ limit: maxPostSize, extended: false }));
app.use(bodyParser.json({ limit: maxPostSize }));
app.use(
  expressSession({
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
  })
);
app.use(authManager.passport.initialize());
app.use(authManager.passport.session());

app.use(function (req, res, next) {
  reqLogger("%s %s", req.method, req.url);
  next();
});

/**
 * Routes
 */
authManager.setupRoutes(app);
app.use("/", express.static(__dirname + "/frontend/dist"));
app.get("/token", mainController.getToken);
app.post("/hooks/main", hooksController.main);

debug("Loading all recent pulls from the DB");
dbManager
  .getRecentPulls(pullManager.getOldestAllowedPullTimestamp())
  .then(function (pulls) {
    debug("Loaded %s pulls", pulls.length);
    pullQueue.pause();
    pulls.forEach(function (pull) {
      pullManager.updatePull(pull);
    });
    pullQueue.resume();
  })
  .then(function () {
    debug("Refreshing all open pulls from the API");
    refresh.openPulls();
  })
  .done();

/*
@TODO: Update pulls which were open last time Pulldasher ran but are closed now.
dbManager.closeStalePulls();
*/

//====================================================
// Socket.IO
const io = new Server(httpServer);
io.on("connection", function (socket) {
  var unauthenticated_timeout =
    config.unauthenticated_timeout !== undefined
      ? config.unauthenticated_timeout
      : 10 * 1000;

  var autoDisconnect = setTimeout(function () {
    socket.disconnect();
  }, unauthenticated_timeout);

  socket.once("authenticate", function (token) {
    // They did respond. No need to drop their connection for not responding.
    clearTimeout(autoDisconnect);

    var user = socketAuthenticator.retrieveUser(token);
    if (user) {
      socket.emit("authenticated");
      pullManager.addSocket(socket);
    } else {
      socket.emit("unauthenticated");
      socket.disconnect();
    }
  });

  socket.on("refresh", function (repo, number) {
    refresh.pull(repo, number);
  });
});

debug("Listening on port %s", config.port);
httpServer.listen(config.port);
