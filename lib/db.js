import mysql from "mysql2/promise";
import config from "./config-loader.js";
import EncodingToCharset from "../node_modules/mysql2/lib/constants/encoding_charset.js";

// OMG, this took forever to figure out
// Add support for understanding utf8mb3 charset to the mysql2 library
// https://github.com/sidorares/node-mysql2/issues/1398
// We don't have any utf8mb3 columns, but if you run a query that generates
// no result (DELETE, REPLACE, ...) it will return metadata indicating that the
// empty result is in the "servers" charset, which is utf8mb3 (still)

// Add support for utf8mb3 charset
EncodingToCharset.utf8mb3 = 192;

const pool = mysql.createPool({
   host: config.mysql.host,
   database: config.mysql.db,
   user: config.mysql.user,
   password: config.mysql.pass,
   charset: "utf8mb4",
});

export default {
   query: function (query, params) {
      return pool.query(query, params)
         .then((result) => result[0]); // [rows, fields]
   }
};
