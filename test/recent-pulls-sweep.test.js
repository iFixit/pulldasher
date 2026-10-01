import { test } from "node:test";
import assert from "node:assert/strict";
import gitManager from "../lib/git-manager.js";
import dbManager from "../lib/db-manager.js";
import { createRecentPullsSweep, createRefresh, repoOwners } from "../lib/refresh.js";

const MINUTE = 60 * 1000;

function fakeClock(start) {
  let time = start;
  const now = () => time;
  now.advance = (ms) => (time += ms);
  return now;
}

test("repoOwners lists each owner once, ignoring case", () => {
  const repos = [
    { name: "iFixit/ifixit" },
    { name: "ifixit/expo" },
    { name: "other/repo" },
  ];
  assert.deepEqual(repoOwners(repos), ["ifixit", "other"]);
});

// Each window starts an hour before the previous sweep started, and the first
// one reaches back a full interval so it covers a short restart.
test("the sweep refreshes every pull the search finds and advances its window", async (t) => {
  const searches = [];
  t.mock.method(gitManager, "searchUpdatedPulls", (owner, since) => {
    searches.push(`${owner} ${since.toISOString()}`);
    // A new updated_at on every search, so each sweep re-reads both.
    const updatedAt = new Date(now()).toISOString();
    return Promise.resolve(
      owner === "a"
        ? [{ repo: "a/one", number: 1, updatedAt }]
        : [{ repo: "b/two", number: 2, updatedAt }]
    );
  });
  const refreshed = [];
  const refreshApi = {
    pull: (repo, number) => {
      refreshed.push(`${repo}#${number}`);
      return Promise.resolve();
    },
  };
  const now = fakeClock(Date.parse("2026-09-29T12:00:00Z"));
  const sweep = createRecentPullsSweep(refreshApi, ["a", "b"], now);

  await sweep();
  now.advance(20 * MINUTE);
  await sweep();

  assert.deepEqual(searches, [
    "a 2026-09-29T10:40:00.000Z",
    "b 2026-09-29T10:40:00.000Z",
    "a 2026-09-29T11:00:00.000Z",
    "b 2026-09-29T11:00:00.000Z",
  ]);
  assert.deepEqual(refreshed, ["a/one#1", "b/two#2", "a/one#1", "b/two#2"]);
});

test("a failed search keeps its window for the next sweep", async (t) => {
  const searches = [];
  let fail = true;
  t.mock.method(gitManager, "searchUpdatedPulls", (owner, since) => {
    searches.push(since.toISOString());
    return fail ? Promise.reject(new Error("search 503")) : Promise.resolve([]);
  });
  t.mock.method(console, "error", () => {});
  const now = fakeClock(Date.parse("2026-09-29T12:00:00Z"));
  const sweep = createRecentPullsSweep(
    { pull: () => Promise.resolve() },
    ["a"],
    now
  );

  await sweep();
  fail = false;
  now.advance(20 * MINUTE);
  await sweep();

  assert.deepEqual(searches, [
    "2026-09-29T10:40:00.000Z",
    "2026-09-29T10:40:00.000Z",
  ]);
});

// After an outage, the first window starts an hour before the newest update
// the DB held at boot, and its start is never more than a day back.
test("the first sweep after a restart reaches back to the newest update the DB held", async (t) => {
  const searches = [];
  t.mock.method(gitManager, "searchUpdatedPulls", (owner, since) => {
    searches.push(since.toISOString());
    return Promise.resolve([]);
  });
  const refreshApi = { pull: () => Promise.resolve() };
  const now = fakeClock(Date.parse("2026-09-29T15:00:00Z"));
  const at = (iso) => Date.parse(iso) / 1000;

  // The 2026-09-29 cominor outage: nothing written after 10:28:56Z.
  await createRecentPullsSweep(refreshApi, ["a"], now, at("2026-09-29T10:28:56Z"))();
  // Down for three days: capped at a day.
  await createRecentPullsSweep(refreshApi, ["a"], now, at("2026-09-26T15:00:00Z"))();
  // Updated a minute before the restart: the usual 20-minute window.
  await createRecentPullsSweep(refreshApi, ["a"], now, at("2026-09-29T14:59:00Z"))();

  assert.deepEqual(searches, [
    "2026-09-29T09:28:56.000Z",
    "2026-09-28T14:00:00.000Z",
    "2026-09-29T13:40:00.000Z",
  ]);
});

// The overlap finds the same hits again; only a new updated_at re-reads one.
test("a hit already re-read at the same updated_at is skipped", async (t) => {
  let hits = [
    { repo: "a/one", number: 1, updatedAt: "2026-09-29T11:50:00Z" },
    { repo: "a/one", number: 2, updatedAt: "2026-09-29T11:50:00Z" },
  ];
  t.mock.method(gitManager, "searchUpdatedPulls", () => Promise.resolve(hits));
  const refreshed = [];
  const refreshApi = {
    pull: (repo, number) => {
      refreshed.push(number);
      return Promise.resolve();
    },
  };
  const now = fakeClock(Date.parse("2026-09-29T12:00:00Z"));
  const sweep = createRecentPullsSweep(refreshApi, ["a"], now);

  await sweep();
  hits = [hits[0], { ...hits[1], updatedAt: "2026-09-29T12:10:00Z" }];
  now.advance(20 * MINUTE);
  await sweep();

  assert.deepEqual(refreshed, [1, 2, 2]);
});

test("a pull that failed to refresh is retried by the next sweep", async (t) => {
  t.mock.method(gitManager, "searchUpdatedPulls", () =>
    Promise.resolve([{ repo: "a/one", number: 1, updatedAt: "2026-09-29T11:50:00Z" }])
  );
  let fail = true;
  const attempts = [];
  const refreshApi = {
    pull: (repo, number) => {
      attempts.push(number);
      return fail ? Promise.reject(new Error("transient 500")) : Promise.resolve();
    },
  };
  const now = fakeClock(Date.parse("2026-09-29T12:00:00Z"));
  const sweep = createRecentPullsSweep(refreshApi, ["a"], now);

  await sweep();
  fail = false;
  now.advance(20 * MINUTE);
  await sweep();
  now.advance(20 * MINUTE);
  await sweep();

  assert.deepEqual(attempts, [1, 1]);
});

// refreshApi.pull resolves after a failed parse or save, so the sweep learns
// about it only through the onFailure it passes.
test("a pull that failed to save is retried by the next sweep", async (t) => {
  t.mock.method(gitManager, "searchUpdatedPulls", () =>
    Promise.resolve([{ repo: "a/one", number: 1, updatedAt: "2026-09-29T11:50:00Z" }])
  );
  let fail = true;
  const attempts = [];
  const refreshApi = {
    pull: (repo, number, onFailure) => {
      attempts.push(number);
      if (fail) onFailure(repo, number);
      return Promise.resolve();
    },
  };
  const now = fakeClock(Date.parse("2026-09-29T12:00:00Z"));
  const sweep = createRecentPullsSweep(refreshApi, ["a"], now);

  await sweep();
  fail = false;
  now.advance(20 * MINUTE);
  await sweep();
  now.advance(20 * MINUTE);
  await sweep();

  assert.deepEqual(attempts, [1, 1]);
});

test("refresh.pull reports a failed save to its onFailure and still resolves", async (t) => {
  t.mock.method(gitManager, "getPull", (repo, number) =>
    Promise.resolve({ number, base: { repo: { full_name: repo } } })
  );
  t.mock.method(gitManager, "parse", (response) => Promise.resolve(response));
  t.mock.method(dbManager, "updateAllPullData", () => Promise.reject(new Error("db down")));
  t.mock.method(console, "error", () => {});
  const failures = [];

  await createRefresh().pull("a/one", 1, (repo, number) => failures.push(`${repo}#${number}`));

  assert.deepEqual(failures, ["a/one#1"]);
});

test("one pull failing to refresh doesn't stop the sweep", async (t) => {
  t.mock.method(gitManager, "searchUpdatedPulls", () =>
    Promise.resolve([
      { repo: "a/one", number: 1 },
      { repo: "a/one", number: 2 },
    ])
  );
  const refreshed = [];
  const refreshApi = {
    pull: (repo, number) => {
      refreshed.push(number);
      return number === 1
        ? Promise.reject(new Error("transient 500"))
        : Promise.resolve();
    },
  };

  await createRecentPullsSweep(refreshApi, ["a"])();

  assert.deepEqual(refreshed, [1, 2]);
});
