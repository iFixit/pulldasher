import debug from "./debug.js";

const cacheDebug = debug("pulldasher:etag-cache");

/**
 * Installs an in-process ETag cache on an Octokit instance.
 *
 * GitHub does not count a conditional request against the primary rate limit
 * when it returns `304 Not Modified`. By remembering the `ETag` of every GET
 * response and replaying it via `If-None-Match`, unchanged resources cost no
 * quota. This matters most at startup, where `refresh.openPulls()` re-fetches
 * every open pull even though almost none have changed since the last run.
 *
 * See: https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api
 *
 * The cache is a bounded, insertion-ordered Map used as a rough LRU: touching
 * an entry (on hit or refresh) moves it to the end, and the oldest entry is
 * evicted once `maxEntries` is exceeded. It caches GETs only; other methods
 * pass straight through.
 */
export default function installEtagCache(octokit, { maxEntries = 2000 } = {}) {
  const cache = new Map();

  function touch(key, value) {
    // Re-insert so the entry counts as most-recently-used.
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > maxEntries) {
      cache.delete(cache.keys().next().value);
    }
  }

  octokit.hook.wrap("request", async (request, options) => {
    if ((options.method || "GET").toUpperCase() !== "GET") {
      return request(options);
    }

    // Resolve the full path + query string so paginated pages key separately.
    const { method, url } = octokit.request.endpoint(options);
    const key = `${method} ${url}`;
    const cached = cache.get(key);

    if (cached) {
      options.headers = { ...options.headers, "if-none-match": cached.etag };
    }

    try {
      const response = await request(options);
      const etag = response.headers && response.headers.etag;
      if (etag) {
        touch(key, { etag, response });
      }
      return response;
    } catch (error) {
      if (error.status === 304 && cached) {
        cacheDebug("304 hit: %s", key);
        touch(key, cached);
        return cached.response;
      }
      throw error;
    }
  });

  return cache;
}
