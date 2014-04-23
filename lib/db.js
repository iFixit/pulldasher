var mysql = require('mysql'),
    config = require('../config');

var connection;

function newConnection() {
   return mysql.createConnection({
      host: config.mysql.host,
      database: config.mysql.db,
      user: config.mysql.user,
      password: config.mysql.pass
   });
}

if (connection === undefined) {
   connection = newConnection();
}

// If our connection times out, this will re-create it.
connection.on('error', function(err) {
   if (err.code === 'PROTOCOL_CONNECTION_LOST') {
      connection = newConnection();
   }
});

module.exports = connection;
