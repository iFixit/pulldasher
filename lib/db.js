var mysql = require('mysql'),
    config = require('./config'),
    Promise = require('bluebird');

const pool = mysql.createPool({
   host: config.mysql.host,
   database: config.mysql.db,
   user: config.mysql.user,
   password: config.mysql.pass
});

pool.query = Promise.promisify(pool.query);

module.exports = pool;
