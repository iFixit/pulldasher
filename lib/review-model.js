import config from './config-loader.js';
import { derive } from '../shared/dist/index.js';

/**
 * The server-side half of "one derive, two consumers": run the SAME
 * bucket/CI/weight derivation the board runs. The logic lives in shared/
 * (compiled to shared/dist/index.js by `npm run build:shared`) and is imported
 * unchanged both here and by the frontend, so the /api/v1 classification can
 * never disagree with what the board shows.
 *
 * derive() reads only DB-backed fields (sign-offs, CI statuses, labels,
 * mergeable, base/head) -- never the in-memory-only review_requests cache -- so
 * its output is correct immediately after a cold restart, before any refresh.
 */

/** The RepoSpec (name + required/ignored status contexts) for a pull's repo,
 * or undefined for a repo with no per-repo CI config. */
function specForRepo(repo) {
   return config.repos.find(r => r.name === repo);
}

/**
 * Normalize a Pull to the exact shape a client receives over socket.io
 * (Dates -> ISO strings, Signature/Status model instances -> plain data), so
 * the server-side derive sees byte-identical input to the board's client-side
 * derive. This equivalence is what the api parity test asserts.
 */
function toWire(pull) {
   return JSON.parse(JSON.stringify(pull.toObject()));
}

/**
 * Derive one Pull into its DerivedPull (status bucket, CI verdict, weight,
 * sign-off counts, staleness, age, ...).
 *
 * `weightLabels` is left at derive()'s empty-Map default: the org's
 * weightLabels/bots config lives only in the frontend's config.json today, so
 * until it is wired server-side weight falls back to the size heuristic (which
 * needs no config). Wiring that config is an additive follow-up, not a blocker.
 */
export function derivePull(pull, now = Date.now() / 1000) {
   const wire = toWire(pull);
   return derive(wire, specForRepo(wire.repo), now);
}

/** Derive a list of Pulls against one shared `now` (a consistent clock for a
 * single request/snapshot). */
export function deriveAll(pulls, now = Date.now() / 1000) {
   return pulls.map(pull => derivePull(pull, now));
}
