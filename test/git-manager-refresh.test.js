import { test } from "node:test";
import assert from "node:assert/strict";
import gitManager from "../lib/git-manager.js";

// Stand in for api.github.com: each route answers by path (and, for GraphQL,
// by query), and every call made is recorded as "METHOD /path".
function fakeGithub(t, routes) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const { pathname } = new URL(typeof url === "string" ? url : url.url);
    const method = init.method || "GET";
    calls.push(`${method} ${pathname}`);
    const route = routes.find(([pattern]) => pattern.test(pathname));
    const { status = 200, body } = route
      ? route[1](init.body ? JSON.parse(init.body) : null)
      : { status: 404, body: { message: "Not Found" } };
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return calls;
}

const repo = "/repos/test/repo-a";
const job = {
  name: "phpunit",
  status: "completed",
  conclusion: "success",
  html_url: "https://github.com/test/repo-a/actions/runs/77/job/9",
  started_at: "2026-09-20T10:02:00Z",
  completed_at: "2026-09-20T10:09:00Z",
};

function parseRoutes(checkRuns) {
  return [
    [/^\/user$/, () => ({ body: { login: "pulldasher-bot" } })],
    [/\/pulls\/3\/comments$/, () => ({ body: [] })],
    [/\/issues\/3\/comments$/, () => ({ body: [] })],
    [
      /\/commits\/abc$/,
      () => ({
        body: { commit: { committer: { date: "2026-09-20T10:00:00Z" } } },
      }),
    ],
    [/\/commits\/abc\/status$/, () => ({ body: { statuses: [] } })],
    [/\/commits\/abc\/check-runs$/, checkRuns],
    [
      /\/actions\/runs$/,
      () => ({
        body: {
          total_count: 1,
          workflow_runs: [{ id: 77, repository: { full_name: "test/repo-a" } }],
        },
      }),
    ],
    [
      /\/actions\/runs\/77\/jobs$/,
      () => ({ body: { total_count: 1, jobs: [job] } }),
    ],
    [
      /\/issues\/3\/events$/,
      () => ({
        body: [
          {
            event: "labeled",
            label: { name: "size: S" },
            actor: { login: "labeler" },
            created_at: "2026-09-20T10:01:00Z",
          },
        ],
      }),
    ],
    [/\/pulls\/3\/reviews$/, () => ({ body: [] })],
  ];
}

// A pulls.get response, so parse fetches no diff stats.
const githubPull = () => ({
  number: 3,
  state: "open",
  title: "t",
  body: "",
  draft: false,
  created_at: "2026-09-19T00:00:00Z",
  updated_at: "2026-09-20T10:01:00Z",
  user: { login: "author" },
  labels: [{ name: "size: S" }],
  requested_reviewers: [],
  assignees: [],
  milestone: null,
  head: {
    ref: "f",
    sha: "abc",
    repo: { name: "repo-a", owner: { login: "test" } },
  },
  base: { ref: "master", repo: { full_name: "test/repo-a" } },
  additions: 1,
  deletions: 1,
  changed_files: 1,
  mergeable: true,
});

test("parse reads the checks in one call and the labels from the pull itself", async (t) => {
  const calls = fakeGithub(
    t,
    parseRoutes(() => ({ body: { total_count: 1, check_runs: [job] } }))
  );

  const pull = await gitManager.parse(githubPull());

  assert.deepEqual(
    pull.commitStatuses.map((s) => `${s.data.context}=${s.data.state}`),
    ["phpunit=success"]
  );
  assert.deepEqual(
    pull.labels.map((l) => `${l.data.title} by ${l.data.user}`),
    ["size: S by labeler"]
  );
  assert.ok(
    !calls.includes(`GET ${repo}/issues/3`),
    "no issues.get for the labels"
  );
  assert.ok(
    !calls.some((call) => call.includes("/actions/")),
    "no workflow runs or jobs"
  );
});

// Fine-grained tokens can't read check runs (1accc56c): GitHub answers 403,
// and from then on this process lists each workflow run's jobs instead.
test("parse lists workflow jobs once check runs are refused", async (t) => {
  const calls = fakeGithub(
    t,
    parseRoutes(() => ({
      status: 403,
      body: { message: "Resource not accessible by personal access token" },
    }))
  );

  const first = await gitManager.parse(githubPull());
  const second = await gitManager.parse(githubPull());

  for (const pull of [first, second]) {
    assert.deepEqual(
      pull.commitStatuses.map(
        (s) => `${s.data.context}=${s.data.state} ${s.data.target_url}`
      ),
      [`phpunit=success ${job.html_url}`]
    );
  }
  assert.equal(calls.filter((call) => call.endsWith("/check-runs")).length, 1);
});

test("getPullsToCompare reads both lists in one call, then only the one with more", async (t) => {
  const node = (number, extra = {}) => ({
    number,
    updatedAt: "2026-09-28T00:00:00Z",
    isDraft: false,
    headRefOid: `sha${number}`,
    labels: { nodes: [{ name: "size: S" }] },
    comments: { totalCount: 2 },
    reviews: { totalCount: 1 },
    commits: {
      nodes: [
        {
          commit: {
            oid: `sha${number}`,
            committedDate: "2026-09-27T00:00:00Z",
          },
        },
      ],
    },
    ...extra,
  });
  const connection = (nodes, endCursor) => ({
    pageInfo: { hasNextPage: Boolean(endCursor), endCursor },
    nodes,
  });
  const asked = [];
  fakeGithub(t, [
    [
      /^\/graphql$/,
      ({ variables }) => {
        asked.push(
          `open ${variables.withOpen} ${variables.openCursor}, closed ${variables.withClosed}`
        );
        const repository = {};
        if (variables.withOpen) {
          repository.open = variables.openCursor
            ? connection([
                node(2, {
                  commits: {
                    nodes: [{ commit: { oid: "old", committedDate: "x" } }],
                  },
                }),
              ])
            : connection([node(1)], "c1");
        }
        if (variables.withClosed) {
          // newest update first: #4 is older than the cutoff, so page 2 (empty
          // here) is never asked for
          repository.closed = variables.closedCursor
            ? connection([])
            : connection(
                [
                  {
                    number: 3,
                    updatedAt: "2026-09-27T00:00:00Z",
                    closedAt: "2026-09-26T00:00:00Z",
                  },
                  {
                    number: 4,
                    updatedAt: "2026-09-01T00:00:00Z",
                    closedAt: "2026-09-01T00:00:00Z",
                  },
                ],
                "c2"
              );
        }
        return { body: { data: { repository } } };
      },
    ],
  ]);

  const pulls = await gitManager.getPullsToCompare(
    "test/repo-a",
    new Date("2026-09-18T00:00:00Z")
  );

  assert.deepEqual(asked, [
    "open true null, closed true",
    "open true c1, closed false",
  ]);
  assert.deepEqual(pulls, [
    {
      repo: "test/repo-a",
      number: 1,
      state: "open",
      updatedAt: "2026-09-28T00:00:00Z",
      draft: false,
      headSha: "sha1",
      headCommittedAt: "2026-09-27T00:00:00Z",
      labels: ["size: S"],
      comments: 2,
      reviews: 1,
    },
    {
      repo: "test/repo-a",
      number: 2,
      state: "open",
      updatedAt: "2026-09-28T00:00:00Z",
      draft: false,
      headSha: "sha2",
      // the last commit listed isn't the head, so its date says nothing
      headCommittedAt: null,
      labels: ["size: S"],
      comments: 2,
      reviews: 1,
    },
    {
      repo: "test/repo-a",
      number: 3,
      state: "closed",
      updatedAt: "2026-09-27T00:00:00Z",
      closedAt: "2026-09-26T00:00:00Z",
    },
  ]);
});
