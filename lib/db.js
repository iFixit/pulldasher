var mysql = require('mysql')
    config = require('../config');

var conn;

function createConnection() {
   conn = mysql.createConnection({
      host: config.mysql.host,
      database: config.mysql.db,
      user: config.mysql.user,
      password: config.mysql.pass
   });
}

module.exports = {
   connect: function() {
      createConnection();
      return conn;
   },

   end: function() {
      conn.end();
   }
};

