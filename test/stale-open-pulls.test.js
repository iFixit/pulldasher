import { test } from "node:test";
import assert from "node:assert/strict";
import gitManager from "../lib/git-manager.js";
import dbManager from "../lib/db-manager.js";
import { createRefresh, findMissingOpenPulls, findStaleOpenPulls } from "../lib/refresh.js";

const githubPull = (repo, number) => ({ number, base: { repo: { full_name: repo } } });

test("findStaleOpenPulls keeps DB-open pulls missing from a successful listing", () => {
  const dbOpenPulls = [
    { repo: "test/repo-a", number: 1 },
    { repo: "test/repo-a", number: 2 },
    { repo: "test/repo-b", number: 3 },
    { repo: "Test/Repo-C", number: 4 },
  ];

  const stale = findStaleOpenPulls(
    dbOpenPulls,
    [githubPull("test/repo-a", 1)],
    ["test/repo-a", "test/repo-c"]
  );

  assert.deepEqual(stale, [
    { repo: "test/repo-a", number: 2 },
    { repo: "Test/Repo-C", number: 4 },
  ]);
});

test("findMissingOpenPulls keeps listed pulls the DB doesn't hold as open", () => {
  const listed = [githubPull("Test/Repo-A", 1), githubPull("test/repo-a", 2)];

  const missing = findMissingOpenPulls([{ repo: "test/repo-a", number: 1 }], listed);

  assert.deepEqual(missing, [githubPull("test/repo-a", 2)]);
});

// A pull whose close webhook was lost stays open in the DB. openPulls refetches it,
// skipping repos whose listing failed and reporting a refetch that fails.
test("openPulls refetches pulls the DB holds as open that GitHub no longer lists", async (t) => {
  t.mock.method(gitManager, "getOpenPulls", (repo) => {
    if (repo === "test/repo-b") return Promise.reject(new Error("transient 502"));
    return Promise.resolve(repo === "test/repo-a" ? [githubPull(repo, 1)] : []);
  });
  t.mock.method(dbManager, "getOpenPullIds", () =>
    Promise.resolve([
      { repo: "test/repo-a", number: 1 },
      { repo: "test/repo-a", number: 2 },
      { repo: "test/repo-b", number: 3 },
      { repo: "test/repo-c", number: 4 },
    ])
  );
  const fetched = [];
  t.mock.method(gitManager, "getPull", (repo, number) => {
    fetched.push(`${repo}#${number}`);
    if (number === 4) return Promise.reject(new Error("transient 500"));
    return Promise.resolve({ ...githubPull(repo, number), state: "closed" });
  });
  const saved = [];
  t.mock.method(gitManager, "parse", (response) => Promise.resolve(response));
  t.mock.method(dbManager, "updateAllPullData", (pull) => {
    saved.push(`${pull.base.repo.full_name}#${pull.number}`);
    return Promise.resolve();
  });

  const result = await createRefresh().openPulls();

  assert.deepEqual(fetched, ["test/repo-a#2", "test/repo-c#4"]);
  assert.deepEqual(saved, ["test/repo-a#1", "test/repo-a#2"]);
  assert.deepEqual(result, {
    failedRepos: ["test/repo-b"],
    failedItems: [{ repo: "test/repo-c", number: 4 }],
  });
});

// The server calls openPulls at startup without handling its promise, so a DB
// failure while looking for stale pulls must not reject.
test("openPulls still resolves when the DB can't list open pulls", async (t) => {
  t.mock.method(gitManager, "getOpenPulls", () => Promise.resolve([]));
  t.mock.method(dbManager, "getOpenPullIds", () => Promise.reject(new Error("db down")));
  const getPull = t.mock.method(gitManager, "getPull", () => Promise.resolve(null));

  const result = await createRefresh().openPulls();

  assert.equal(getPull.mock.callCount(), 0);
  assert.deepEqual(result, { failedRepos: [], failedItems: [] });
});
