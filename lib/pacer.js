import config from "./config-loader.js";
import debug from "./debug.js";
import Promise from "bluebird";

const pacerDebug = debug("pulldasher:pacer");

// Only log a paced delay once it's long enough to explain a visibly slow
// backfill — short spacing isn't worth the noise.
const LOG_DELAY_THRESHOLD_MS = 5000;

/**
 * A pacer proactively paces bulk GitHub requests so a backfill yields to live
 * traffic instead of draining the shared token's quota to zero. It is a
 * per-process instance the entry point constructs and installs: the CLI
 * backfill bins build a real one (`createPacer`), and so does the server for
 * "Refresh all". Webhook/socket refreshes run against `noopPacer`, so live
 * traffic is never delayed. Rate state is global to the token, so within a
 * process every bulk call gates against the same view, fed by `observe` on
 * every response (live calls included).
 *
 * `observe(headers)` — record the latest quota from any response (free).
 * `gate()` — await this before each *bulk* unit of work (a consumer drain or a
 *   pagination page); it spreads bulk work across the reset window and blocks
 *   entirely while below the reserve floor.
 *
 * Pacing is calibrated by actual consumption, not by gate count: each gate
 * advances a token-bucket cursor by the number of requests spent since the last
 * gate (`x-ratelimit-used` delta), so a pull whose processing fans out to a
 * dozen calls correctly waits a dozen intervals — and a live-traffic spike,
 * which also bumps `used`, pushes the cursor out and makes bulk yield.
 */
export function createPacer({ reserve = config.github.bulkReserve ?? 1000 } = {}) {
  let remaining = null;
  let reset = null;
  let used = null;
  let lastUsed = null;
  let nextSlot = 0;

  return {
    observe: function (headers) {
      // GraphQL and search answer with their own budgets in the same headers;
      // only REST's (`core`) is the quota bulk work spends.
      if (!headers || (headers["x-ratelimit-resource"] ?? "core") !== "core") {
        return;
      }
      if (headers["x-ratelimit-remaining"] !== undefined) {
        remaining = Number(headers["x-ratelimit-remaining"]);
      }
      if (headers["x-ratelimit-reset"] !== undefined) {
        reset = Number(headers["x-ratelimit-reset"]);
      }
      if (headers["x-ratelimit-used"] !== undefined) {
        used = Number(headers["x-ratelimit-used"]);
      }
    },

    gate: function () {
      const now = Date.now();
      const result = computePace({
        remaining,
        reset,
        used,
        reserve,
        now,
        nextSlot,
        lastUsed,
      });
      nextSlot = result.nextSlot;
      lastUsed = result.lastUsed;
      const delayMs = result.delayMs;

      // The floor-pause is the only positive delay that isn't even-spread pacing.
      if (delayMs > 0 && remaining != null && remaining <= reserve) {
        pacerDebug(
          "bulk paused: remaining %s ≤ reserve %s, waiting %ss for quota reset",
          remaining,
          reserve,
          Math.round(delayMs / 1000)
        );
      } else if (delayMs >= LOG_DELAY_THRESHOLD_MS) {
        pacerDebug(
          "pacing bulk: waiting %sms (remaining %s)",
          Math.round(delayMs),
          remaining
        );
      }

      return Promise.delay(delayMs);
    },
  };
}

// The Null Object pacer the server and webhook/socket path run against: every
// call is total, so call sites stay unconditional (no null guards on the hot
// Octokit hooks or the queue consumer).
export const noopPacer = {
  observe: function () {},
  gate: function () {
    return Promise.resolve();
  },
};

/**
 * Pure pacing decision. Given the latest quota view and a token-bucket cursor,
 * returns how long the next bulk request should wait, the advanced cursor, and
 * the `used` baseline to diff against next time.
 *
 *   - unknown quota, or a `reset` already in the past (stale window) → allow
 *     immediately; the next response refreshes the view.
 *   - `remaining ≤ reserve` → pause until `reset` (let the window refill).
 *   - otherwise → even-spread: the spendable budget (`remaining − reserve`)
 *     divided across the time left in the window gives the per-request interval.
 *     Advance the cursor by `spent × interval`, where `spent` is the requests
 *     consumed since the last gate (`used − lastUsed`), so the spacing tracks
 *     real consumption — a multi-call item or a live spike pushes the next slot
 *     further out. A shrinking `remaining` also widens the interval, so bulk
 *     yields on both signals.
 */
export function computePace({
  remaining,
  reset,
  used,
  reserve,
  now,
  nextSlot,
  lastUsed,
}) {
  const baseline = used ?? lastUsed;
  // No quota view, or a window that already rolled over (our `remaining` is
  // stale): proceed now and let the next response refresh the view.
  const allowNow = { delayMs: 0, nextSlot: now, lastUsed: baseline };
  if (remaining == null || reset == null) {
    return allowNow;
  }
  const resetMs = reset * 1000;
  if (resetMs <= now) {
    return allowNow;
  }
  if (remaining <= reserve) {
    return { delayMs: resetMs - now, nextSlot: resetMs, lastUsed: baseline };
  }
  const interval = (resetMs - now) / (remaining - reserve);
  // Clamp at 0: across a window rollover the server resets `used` to ~0 while
  // our `lastUsed` still holds the pre-reset high, so the delta can go negative.
  const spent =
    used == null || lastUsed == null ? 0 : Math.max(0, used - lastUsed);
  const slot = Math.max(now, nextSlot + spent * interval);
  return { delayMs: slot - now, nextSlot: slot, lastUsed: baseline };
}
