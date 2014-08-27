var mysql = require('mysql'),
    config = require('../config'),
    Promise = require('promise');

var pool = mysql.createPool({
   host: config.mysql.host,
   database: config.mysql.db,
   user: config.mysql.user,
   password: config.mysql.pass
});

pool.callback_query = pool.query

pool.query = Promise.denodeify(pool.query);

module.exports = pool;
