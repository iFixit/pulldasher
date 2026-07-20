import db from "../lib/db.js";
import debug from "../lib/debug.js";

const statsDebug = debug("pulldasher:stats");

// This data moves slowly (it's dominated by history, not the live board), so
// memoize the whole response for a while rather than re-running four
// aggregate queries on every dashboard load.
const CACHE_TTL_MS = 10 * 60 * 1000;
let cache = null; // { at: <ms timestamp>, body: <response object> }

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/**
 * Opened vs merged pulls per calendar month, last 12 months.
 */
function queryMonthly() {
  const since = Math.floor((Date.now() - 12 * MONTH_MS) / 1000);
  const q =
    "\
      SELECT month, SUM(opened) AS opened, SUM(merged) AS merged FROM ( \
        SELECT DATE_FORMAT(FROM_UNIXTIME(date), '%Y-%m') AS month, 1 AS opened, 0 AS merged \
          FROM pulls WHERE date >= ? \
        UNION ALL \
        SELECT DATE_FORMAT(FROM_UNIXTIME(date_merged), '%Y-%m') AS month, 0 AS opened, 1 AS merged \
          FROM pulls WHERE date_merged >= ? \
      ) x \
      GROUP BY month ORDER BY month";

  return db.query(q, [since, since]).then(function (rows) {
    return rows.map(function (row) {
      return {
        month: row.month,
        opened: Number(row.opened),
        merged: Number(row.merged),
      };
    });
  });
}

/**
 * Merge age (time from open to merge) grouped by the day it merged, last 60
 * days: average and max hours, plus how many merged that day.
 */
function queryMergeAgeByDay() {
  const since = Math.floor((Date.now() - 60 * DAY_MS) / 1000);
  const q =
    "\
      SELECT DATE(FROM_UNIXTIME(date_merged)) AS day, \
             AVG(date_merged - date) AS avg_seconds, \
             MAX(date_merged - date) AS max_seconds, \
             COUNT(*) AS merged \
        FROM pulls \
       WHERE date_merged >= ? \
       GROUP BY day ORDER BY day";

  return db.query(q, [since]).then(function (rows) {
    return rows.map(function (row) {
      return {
        day: formatDate(row.day),
        avgHours: round1(row.avg_seconds / 3600),
        maxHours: round1(row.max_seconds / 3600),
        merged: Number(row.merged),
      };
    });
  });
}

/**
 * Per-pull hours from open to first CR signature, for merged pulls in the
 * last 12 months. One row per (repo, number) — used both to compute the
 * monthly average in SQL and, in JS, the monthly median (MySQL has no
 * MEDIAN aggregate, and the row count here is small enough — thousands, not
 * millions — that pulling the raw latencies and sorting in JS is simpler
 * than a second, uglier query).
 */
function queryFirstCrLatencies() {
  const since = Math.floor((Date.now() - 12 * MONTH_MS) / 1000);
  const q =
    "\
      SELECT DATE_FORMAT(FROM_UNIXTIME(p.date_merged), '%Y-%m') AS month, \
             (cr.min_date - p.date) AS latency_seconds \
        FROM pulls p \
        JOIN ( \
          SELECT repo, number, MIN(date) AS min_date \
            FROM pull_signatures \
           WHERE type = 'CR' \
           GROUP BY repo, number \
        ) cr ON cr.repo = p.repo AND cr.number = p.number \
       WHERE p.date_merged >= ? \
         AND cr.min_date > p.date";

  return db.query(q, [since]);
}

/**
 * Average PR duration (open to merge) grouped by ISO week, last 26 weeks.
 */
function queryDurationByWeek() {
  const since = Math.floor((Date.now() - 26 * WEEK_MS) / 1000);
  const q =
    "\
      SELECT YEARWEEK(FROM_UNIXTIME(date_merged), 3) AS iso_yearweek, \
             AVG(date_merged - date) AS avg_seconds, \
             COUNT(*) AS merged \
        FROM pulls \
       WHERE date_merged >= ? \
       GROUP BY iso_yearweek ORDER BY iso_yearweek";

  return db.query(q, [since]).then(function (rows) {
    return rows.map(function (row) {
      return {
        isoWeek: formatIsoWeek(row.iso_yearweek),
        avgHours: round1(row.avg_seconds / 3600),
        merged: Number(row.merged),
      };
    });
  });
}

/**
 * Reduces the raw per-pull first-CR latencies (one row per merged pull, as
 * returned by queryFirstCrLatencies) into one row per month, with both a mean
 * and a JS-computed median (see queryFirstCrLatencies for why the median is
 * computed here instead of in SQL).
 */
function firstCrByMonth(rows) {
  const byMonth = new Map();
  rows.forEach(function (row) {
    if (!byMonth.has(row.month)) {
      byMonth.set(row.month, []);
    }
    byMonth.get(row.month).push(Number(row.latency_seconds) / 3600);
  });

  return [...byMonth.keys()].sort().map(function (month) {
    const hours = byMonth.get(month);
    const avgHours = hours.reduce(function (a, b) { return a + b; }, 0) / hours.length;
    return {
      month,
      avgHours: round1(avgHours),
      medianHours: round1(median(hours)),
      sampled: hours.length,
    };
  });
}

function median(xs) {
  if (!xs.length) return 0;
  const sorted = [...xs].sort(function (a, b) { return a - b; });
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// mysql2 returns DATE columns as JS Date objects (in the connection's local
// time) — format as a plain YYYY-MM-DD so the wire shape is timezone-free.
function formatDate(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

// MySQL's YEARWEEK(..., 3) (ISO mode) returns e.g. 202629 for ISO week 29 of
// 2026; split it back into "2026-W29".
function formatIsoWeek(yearweek) {
  const n = Number(yearweek);
  const year = Math.floor(n / 100);
  const week = n % 100;
  return year + "-W" + String(week).padStart(2, "0");
}

function loadHistory() {
  return Promise.all([
    queryMonthly(),
    queryMergeAgeByDay(),
    queryFirstCrLatencies(),
    queryDurationByWeek(),
  ]).then(function (results) {
    const monthly = results[0];
    const mergeAgeByDay = results[1];
    const firstCrRows = results[2];
    const durationByWeek = results[3];

    return {
      monthly: monthly,
      mergeAgeByDay: mergeAgeByDay,
      firstCrByMonth: firstCrByMonth(firstCrRows),
      durationByWeek: durationByWeek,
    };
  });
}

// Named exports below are the pure reducers (grouping/median/date-formatting)
// factored out so they're independently testable without a live DB connection
// (mirrors lib/refresh.js exporting processIssueItem/processPullItem for the
// same reason).
export { firstCrByMonth, median, formatDate, formatIsoWeek, round1 };

export default {
  /**
   * GET /v2/stats-history — aggregate PR history (months/weeks/days, not the
   * live board) for the frontend-v2 Stats lens trend cards. Auth-gated
   * exactly like /token (see lib/authentication.js setupRoutes). Read-only,
   * memoized for CACHE_TTL_MS since the underlying data moves slowly.
   */
  getHistory: function (req, res) {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
      statsDebug("getHistory: serving cached response");
      return res.json(cache.body);
    }

    loadHistory()
      .then(function (body) {
        cache = { at: Date.now(), body: body };
        res.json(body);
      })
      .catch(function (err) {
        console.error("stats-history query failed:", err);
        res.status(500).json({ error: "stats query failed" });
      });
  },
};
