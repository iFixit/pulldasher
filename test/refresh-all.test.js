import { test } from "node:test";
import assert from "node:assert/strict";
import gitManager from "../lib/git-manager.js";
import dbManager from "../lib/db-manager.js";
import Pull from "../models/pull.js";
import {
  coveredRepos,
  createRefreshAll,
  pullsToRefresh,
} from "../lib/refresh-all.js";

const CLOSED_SINCE = new Date("2026-09-18T00:00:00Z");
const HEAD_COMMITTED = "2026-09-20T10:00:00Z";

// A pull as the board holds it (pull-manager keeps Pull objects loaded from
// the DB), in step with listed() below unless a test changes one side.
function shown({
  repo = "test/repo-a",
  number = 1,
  state = "open",
  sha = "head1",
  draft = false,
  updatedAt = "2026-09-20T12:00:00Z",
  labels = ["size: S"],
  comments = ["2026-09-20T11:00:00Z"],
  reviews = [],
  signatures = [],
  statuses = ["success"],
} = {}) {
  const user = { login: "someone" };
  return new Pull(
    {
      repo,
      number,
      state,
      draft,
      updated_at: new Date(updatedAt),
      head: { sha },
      user: { login: "author" },
      cr_req: 1,
      qa_req: 1,
    },
    signatures.map((sig) => ({
      data: { user, active: 1, ...sig, created_at: new Date(sig.at) },
    })),
    comments.map((at, i) => ({
      data: {
        comment_type: "issue",
        comment_id: i,
        created_at: new Date(at),
        user,
      },
    })),
    reviews.map((review) => ({
      data: { ...review, submitted_at: new Date(review.at), user },
    })),
    statuses.map((state) => ({ data: { state } })),
    labels.map((title) => ({ data: { title } }))
  );
}

// The same pull as getPullsToCompare lists it.
function listed({
  repo = "test/repo-a",
  number = 1,
  sha = "head1",
  draft = false,
  updatedAt = "2026-09-20T12:00:00Z",
  labels = ["size: S"],
  comments = 1,
  reviews = 0,
} = {}) {
  return {
    repo,
    number,
    state: "open",
    updatedAt,
    draft,
    headSha: sha,
    headCommittedAt: HEAD_COMMITTED,
    labels,
    comments,
    reviews,
  };
}

const closedListing = (number, closedAt, repo = "test/repo-a") => ({
  repo,
  number,
  state: "closed",
  updatedAt: closedAt,
  closedAt,
});

function due(board, listing, listedRepos = ["test/repo-a"]) {
  return pullsToRefresh(board, listing, listedRepos, CLOSED_SINCE).map(
    (pull) => `${pull.repo}#${pull.number} ${pull.why}`
  );
}

test("a pull that matches GitHub isn't refreshed", () => {
  assert.deepEqual(due([shown()], [listed()]), []);
});

test("a pull open on GitHub but missing from the board is refreshed", () => {
  assert.deepEqual(due([], [listed({ number: 7 })]), ["test/repo-a#7 missing"]);
});

test("a pull the board holds closed that GitHub lists open is refreshed", () => {
  assert.deepEqual(due([shown({ state: "closed" })], [listed()]), [
    "test/repo-a#1 missing",
  ]);
});

test("a pull the board holds open that GitHub doesn't list open is refreshed", () => {
  const board = [
    shown({ number: 2 }),
    shown({ repo: "test/repo-b", number: 3 }),
  ];

  // repo-b's listing failed, which proves nothing about its pulls
  assert.deepEqual(due(board, []), ["test/repo-a#2 closed"]);
});

test("a pull closed since the cutoff and missing from the board is refreshed", () => {
  const listing = [
    closedListing(8, "2026-09-27T10:00:00Z"),
    // closed before the board's cutoff: the board wouldn't show it
    closedListing(9, "2026-09-01T10:00:00Z"),
  ];

  assert.deepEqual(due([], listing), ["test/repo-a#8 missing"]);
  // already on the board: nothing to add
  assert.deepEqual(
    due([shown({ number: 8, state: "closed" })], listing.slice(0, 1)),
    []
  );
});

test("a pull pushed to since the board read it is refreshed", () => {
  assert.deepEqual(due([shown()], [listed({ sha: "head2" })]), [
    "test/repo-a#1 head",
  ]);
});

test("a pull marked ready for review since the board read it is refreshed", () => {
  assert.deepEqual(due([shown({ draft: true })], [listed()]), [
    "test/repo-a#1 draft",
  ]);
});

test("a pull labeled since the board read it is refreshed", () => {
  assert.deepEqual(
    due([shown()], [listed({ labels: ["size: S", "project:x"] })]),
    ["test/repo-a#1 labels"]
  );
});

test("a pull with a comment the board missed is refreshed, even after newer ones arrived", () => {
  const board = [
    shown({ comments: ["2026-09-20T11:00:00Z", "2026-09-21T09:00:00Z"] }),
  ];

  assert.deepEqual(
    due(board, [listed({ comments: 3, updatedAt: "2026-09-21T09:00:00Z" })]),
    ["test/repo-a#1 comments"]
  );
  // the DB keeps deleted comments, so more on the board than on GitHub is fine
  assert.deepEqual(
    due(board, [listed({ comments: 1, updatedAt: "2026-09-21T09:00:00Z" })]),
    []
  );
});

test("a pull with a review the board missed is refreshed", () => {
  assert.deepEqual(due([shown()], [listed({ reviews: 1 })]), [
    "test/repo-a#1 reviews",
  ]);
});

test("a pull GitHub updated after everything the board knows is refreshed", () => {
  assert.deepEqual(
    due([shown()], [listed({ updatedAt: "2026-09-21T00:00:00Z" })]),
    ["test/repo-a#1 updated"]
  );
});

// Comment and review webhooks never touch the pull's row, but GitHub's
// updated_at moves with them: the newest comment counts as known.
test("a pull whose newest activity is a comment the board has isn't refreshed", () => {
  const board = [shown({ comments: ["2026-09-22T08:00:00Z"] })];

  assert.deepEqual(
    due(board, [listed({ updatedAt: "2026-09-22T08:00:00Z" })]),
    []
  );
});

test("a stamp the board shows standing though it predates the head commit is refreshed", () => {
  const stamp = { type: "CR", comment_id: 50, at: "2026-09-20T09:00:00Z" };

  assert.deepEqual(due([shown({ signatures: [stamp] })], [listed()]), [
    "test/repo-a#1 stamp",
  ]);
  // an approval GitHub kept across the push stays standing, as parse() keeps it
  const reviews = [
    { review_id: 50, state: "APPROVED", at: "2026-09-20T09:00:00Z" },
  ];
  assert.deepEqual(
    due([shown({ signatures: [stamp], reviews })], [listed({ reviews: 1 })]),
    []
  );
});

test("a pull whose checks the board still shows running is refreshed", () => {
  assert.deepEqual(
    due([shown({ statuses: ["success", "pending"] })], [listed()]),
    ["test/repo-a#1 ci"]
  );
});

test("coveredRepos adds every repo the board shows to the configured ones", () => {
  const board = [
    shown({ repo: "iFixit/ops" }),
    shown({ repo: "ifixit/ifixit" }),
  ];

  assert.deepEqual(coveredRepos([{ name: "iFixit/ifixit" }], board), [
    "iFixit/ifixit",
    "iFixit/ops",
  ]);
});

// A press lists the board's repos, refetches only what differs, one pull per
// pacer slot, and tells every board how far it got.
test("a press refreshes only the pulls that differ and reports its progress", async (t) => {
  const board = [
    shown({ number: 1 }),
    shown({ repo: "iFixit/ops", number: 2 }),
  ];
  const listedRepos = [];
  t.mock.method(gitManager, "getPullsToCompare", (repo) => {
    listedRepos.push(repo);
    return Promise.resolve(
      repo === "test/repo-a"
        ? [listed({ number: 1 }), listed({ number: 5 })]
        : []
    );
  });
  const fetched = [];
  t.mock.method(gitManager, "getPull", (repo, number) => {
    fetched.push(`${repo}#${number}`);
    if (number === 2) return Promise.reject(new Error("transient 502"));
    return Promise.resolve({ number, base: { repo: { full_name: repo } } });
  });
  t.mock.method(gitManager, "parse", (response) => Promise.resolve(response));
  t.mock.method(dbManager, "updateAllPullData", () => Promise.resolve());
  t.mock.method(console, "error", () => {});
  let gates = 0;
  const progress = [];
  const press = createRefreshAll({
    board: () => board,
    repos: [{ name: "test/repo-a" }],
    closedSince: () => CLOSED_SINCE,
    pacer: { gate: () => Promise.resolve(gates++) },
    onProgress: (p) =>
      progress.push(`${p.state} ${p.done}/${p.total} failed ${p.failed}`),
  });

  await press.start();

  assert.deepEqual(listedRepos, ["test/repo-a", "iFixit/ops"]);
  assert.deepEqual(fetched, ["test/repo-a#5", "iFixit/ops#2"]);
  assert.equal(gates, 2);
  assert.deepEqual(progress, [
    "checking 0/0 failed 0",
    "refreshing 0/2 failed 0",
    "refreshing 1/2 failed 0",
    "refreshing 2/2 failed 1",
    "done 2/2 failed 1",
  ]);
});

test("a second press while one runs doesn't start another", async (t) => {
  let listings = 0;
  t.mock.method(gitManager, "getPullsToCompare", () => {
    listings++;
    return Promise.resolve([]);
  });
  const press = createRefreshAll({
    board: () => [],
    repos: [{ name: "test/repo-a" }],
    closedSince: () => CLOSED_SINCE,
  });

  const first = press.start();
  assert.equal(press.start(), null);
  await first;
  await press.start();

  assert.equal(listings, 2);
  assert.equal(press.progress().state, "done");
});
