/**
 * The one entry the pulldasher backend bundles to run the SAME review
 * derivation the board uses. The frontend imports these modules directly
 * (Vite); the backend imports the compiled `shared/dist/index.js` produced by
 * `npm run build:shared` (esbuild). Keeping both consumers on one source is
 * the whole point of shared/ — the bucket/CI/weight logic can never drift
 * between what the board shows and what the API returns.
 *
 * These modules are pure and dependency-free (no npm packages, no React, no
 * DOM, no clock read except an injectable `now`), which is what lets esbuild
 * bundle them into a single self-contained file the plain-JS backend imports.
 */
export {
   derive,
   ciVerdict,
   ciFailing,
   headStatuses,
   headPushedAt,
   reviewWeight,
   weightFromLabels,
   parseWeightLabels,
   crDone,
   qaDone,
   lastPushEpoch,
   isIterating,
   STARVE_DAYS,
   ROT_DAYS,
   STATUS_ORDER,
} from './model/status';
export type { DerivedPull, Status, CiVerdict, Weight } from './model/status';

export { checkLedgers, ciSecsWord } from './model/ci';
export type { CheckLedger } from './model/ci';

export { isBotLogin } from './model/visibility';

export { epoch } from './format';
export type { PullData, RepoSpec, Signature, CommitStatus, Label } from './types';
