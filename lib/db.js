var mysql = require('mysql'),
    config = require('../config');

var pool = mysql.createPool({
   host: config.mysql.host,
   database: config.mysql.db,
   user: config.mysql.user,
   password: config.mysql.pass
});

module.exports = pool;
