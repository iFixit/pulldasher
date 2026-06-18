import { test } from "node:test";
import assert from "node:assert/strict";
import { Octokit } from "@octokit/rest";
import installEtagCache from "../lib/etag-cache.js";

/**
 * Builds an Octokit whose network layer is a stub `fetch`, plus a log of the
 * requests it saw, so we can assert on conditional-request behavior without
 * hitting the network.
 */
function octokitWithFakeFetch(responder) {
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url, method: options.method, headers: options.headers });
    return responder(url, options, requests.length);
  };
  const octokit = new Octokit({ auth: "test-token", request: { fetch } });
  installEtagCache(octokit);
  return { octokit, requests };
}

function json(data, { status = 200, etag } = {}) {
  const headers = { "content-type": "application/json" };
  if (etag) {
    headers.etag = etag;
  }
  return new Response(status === 304 ? null : JSON.stringify(data), {
    status,
    headers,
  });
}

test("replays the cached body when GitHub returns 304", async () => {
  const body = [{ id: 1, title: "first" }];
  const { octokit, requests } = octokitWithFakeFetch((url, options, n) =>
    n === 1
      ? json(body, { etag: '"abc"' })
      : json(null, { status: 304, etag: '"abc"' })
  );

  const first = await octokit.request("GET /repos/{o}/{r}/pulls", {
    o: "iFixit",
    r: "pulldasher",
  });
  const second = await octokit.request("GET /repos/{o}/{r}/pulls", {
    o: "iFixit",
    r: "pulldasher",
  });

  assert.deepEqual(second.data, body, "304 response serves the cached body");
  assert.deepEqual(first.data, second.data);
  assert.equal(requests.length, 2, "second request still hits the network");
  assert.equal(
    requests[0].headers["if-none-match"],
    undefined,
    "first request sends no conditional header"
  );
  assert.equal(
    requests[1].headers["if-none-match"],
    '"abc"',
    "second request replays the cached ETag"
  );
});

test("does not send a conditional header for non-GET requests", async () => {
  const { octokit, requests } = octokitWithFakeFetch(() =>
    json({ ok: true }, { etag: '"xyz"' })
  );

  await octokit.request("POST /repos/{o}/{r}/issues", {
    o: "iFixit",
    r: "pulldasher",
    title: "hi",
  });
  await octokit.request("POST /repos/{o}/{r}/issues", {
    o: "iFixit",
    r: "pulldasher",
    title: "hi",
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[1].headers["if-none-match"], undefined);
});
