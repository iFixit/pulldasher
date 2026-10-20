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

// MySQL closes a connection after wait_timeout seconds of no queries (60 on
// prod), and mysql2 only drops an idle pool connection after its own
// idleTimeout, which also defaults to 60s. On that tie the pool hands out a
// connection the server already closed, and the query fails with errno 4031
// ("disconnected by the server because of inactivity"). Drop idle connections
// at half the server's limit so the pool always gets there first.
const IDLE_TIMEOUT_MS = 30 * 1000;

const pool = mysql.createPool({
   host: config.mysql.host,
   database: config.mysql.db,
   user: config.mysql.user,
   password: config.mysql.pass,
   charset: "utf8mb4",
   idleTimeout: IDLE_TIMEOUT_MS,
});

export default {
   query: function (query, params) {
      return pool.query(query, params)
         .then((result) => result[0]); // [rows, fields]
   },
   // The refresh-* bins call this to close the pool so the process can exit
   // cleanly once a backfill finishes.
   end: function () {
      return pool.end();
   }
};
