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

// MySQL closes a connection after wait_timeout seconds without a query (60 on
// prod), and the pool only finds out when the next query on it fails with
// errno 4031 ("disconnected by the server because of inactivity"). The
// server closed the connection before that query arrived, so the query never
// ran and one retry on a fresh connection is safe, writes included. Any other
// error, a connection lost mid-query among them, is passed on unchanged.
const SERVER_CLOSED_IDLE = 4031;

export async function retryIfIdleClosed(run) {
   try {
      return await run();
   } catch (err) {
      if (err?.errno !== SERVER_CLOSED_IDLE) throw err;
      return run();
   }
}

const db = {
   // the pool, for a test to see what each query is sent with
   pool,
   query: function (query, params) {
      return retryIfIdleClosed(() =>
         pool.query(query, params)
      ).then(result => result[0]); // [rows, fields]
   },
   // The refresh-* bins call this to close the pool so the process can exit
   // cleanly once a backfill finishes.
   end: function () {
      return pool.end();
   }
};

export default db;
