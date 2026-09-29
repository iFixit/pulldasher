import { test } from "node:test";
import assert from "node:assert/strict";
import gitManager from "../lib/git-manager.js";
import { createRecentPullsSweep, repoOwners } from "../lib/refresh.js";

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

// Each window starts 5 minutes before the previous sweep started, and the
// first one reaches back a full interval so it covers a short restart.
test("the sweep refreshes every pull the search finds and advances its window", async (t) => {
  const searches = [];
  t.mock.method(gitManager, "searchUpdatedPulls", (owner, since) => {
    searches.push(`${owner} ${since.toISOString()}`);
    return Promise.resolve(
      owner === "a"
        ? [{ repo: "a/one", number: 1 }]
        : [{ repo: "b/two", number: 2 }]
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
    "a 2026-09-29T11:35:00.000Z",
    "b 2026-09-29T11:35:00.000Z",
    "a 2026-09-29T11:55:00.000Z",
    "b 2026-09-29T11:55:00.000Z",
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
    "2026-09-29T11:35:00.000Z",
    "2026-09-29T11:35:00.000Z",
  ]);
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
