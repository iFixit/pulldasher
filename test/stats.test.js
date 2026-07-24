import { test } from "node:test";
import assert from "node:assert/strict";

// Fixture config (test/fixtures/config.js) carries a mysql.* block so
// importing lib/db.js (transitively, via controllers/stats.js) doesn't blow
// up at module-load time. Nothing here actually queries the DB — only the
// pure reducer functions below are exercised.
const {
  firstCrByMonth,
  median,
  formatDate,
  formatIsoWeek,
  round1,
} = await import("../controllers/stats.js");

test("median returns 0 for an empty array", () => {
  assert.equal(median([]), 0);
});

test("median averages the two middle values for an even-length array", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test("median returns the middle value for an odd-length array", () => {
  assert.equal(median([5, 1, 3]), 3);
});

test("round1 rounds to one decimal place", () => {
  assert.equal(round1(1.449), 1.4);
  assert.equal(round1(1.451), 1.5);
});

test("formatDate renders a Date as YYYY-MM-DD", () => {
  assert.equal(formatDate(new Date(2026, 0, 5)), "2026-01-05");
});

test("formatIsoWeek splits a MySQL YEARWEEK(..., 3) value into YYYY-Www", () => {
  assert.equal(formatIsoWeek(202629), "2026-W29");
  assert.equal(formatIsoWeek(202601), "2026-W01");
});

test("firstCrByMonth groups per-pull latencies into sorted monthly avg+median rows", () => {
  const rows = [
    { month: "2026-07", latency_seconds: 3600 * 2 },
    { month: "2026-07", latency_seconds: 3600 * 4 },
    { month: "2026-06", latency_seconds: 3600 * 10 },
  ];

  const result = firstCrByMonth(rows);

  assert.deepEqual(
    result.map(r => r.month),
    ["2026-06", "2026-07"]
  );
  const july = result.find(r => r.month === "2026-07");
  assert.equal(july.sampled, 2);
  assert.equal(july.avgHours, 3);
  assert.equal(july.medianHours, 3);
});

test("firstCrByMonth returns an empty array for no rows", () => {
  assert.deepEqual(firstCrByMonth([]), []);
});
