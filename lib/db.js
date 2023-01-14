var mysql = require('mysql'),
    config = require('./config-loader'),
    Promise = require('bluebird');

const pool = mysql.createPool({
   host: config.mysql.host,
   database: config.mysql.db,
   user: config.mysql.user,
   password: config.mysql.pass,
   charset: "utf8mb4",
});

pool.query = Promise.promisify(pool.query);

module.exports = pool;
