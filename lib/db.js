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

pool.query = function query() {
   var args = Array.prototype.slice.call(arguments, 0);

   return new Promise(function(resolve, reject) {
      args.push(function callback(err, res) {
         if (err) { reject(err); }
         resolve(res);
      });

      pool.callback_query.apply(pool, args);
   });
}

module.exports = pool;
