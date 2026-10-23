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
   reviewPolicy,
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

export {
   buildToday,
   dayIn,
   dayStart,
   projectOf,
   projectSlugs,
   utcDay,
   windowStats,
   DEFAULT_PROJECT_PREFIX,
   LIVE_DAYS,
   MISC_SLUG,
   ONGOING_LABEL,
   PARENT_PREFIX,
} from './model/projects';
export type { Project, PullSpan, ReviewSpan, Today, WindowStats } from './model/projects';

export { prStage } from './model/stage';
export type { PrStage } from './model/stage';

export {
   addWeeks,
   bucketOf,
   checkRoadmapFields,
   checkRoadmapUpdate,
   endOf,
   healthStanding,
   inProgress,
   isUnderWay,
   issuePace,
   mondayOf,
   moveBefore,
   planEnd,
   planFor,
   planLately,
   updatesOwed,
   updateStanding,
   DONE_WHEN_MAX,
   END_KINDS,
   MAX_WEEKS,
   PILE_AGE_DAYS,
   PILE_GROWTH,
   PILE_MIN,
   ROADMAP_HEALTHS,
   PROJECT_SLUG,
   ROADMAP_ORIGINS,
   ROADMAP_STATUSES,
   UPDATE_DUE_DAYS,
   WAITS_ON_MAX,
   waitsOnProblem,
} from './model/roadmap';
export type {
   EndKind,
   RoadmapFields,
   RoadmapHealth,
   RoadmapItem,
   RoadmapOrigin,
   RoadmapStatus,
   RoadmapUpdate,
} from './model/roadmap';

export { epoch } from './format';
export type { PullData, RepoSpec, Signature, CommitStatus, Label } from './types';

export {
   checkDecideRotation,
   checkDeveloperTeams,
   checkOngoingProjects,
   decideTurn,
} from './model/settings';
export type { DecideRotation, DeveloperTeams } from './model/settings';

export {
   answeredOnItsOwn,
   closedIssues,
   decideProjects,
   decideQueue,
   needsDecision,
   issuesAllClosed,
   DECIDE_MIN_PRS,
   STALL_DAYS,
} from './model/decide';
export type {
   ClosedIssue,
   GrownProject,
   DecideProject,
   DecideReason,
   DecideRow,
   PlanCounts,
} from './model/decide';
export {
   checkInitiativeFields,
   goingProjects,
   grew,
   homesOf,
   initiativeSpan,
   GROWTH_FLOOR,
   INITIATIVE_GOAL_MAX,
   INITIATIVE_KINDS,
   INITIATIVE_NAME_MAX,
   INITIATIVE_STATUSES,
} from './model/initiatives';
export type {
   Filing,
   Initiative,
   InitiativeFields,
   InitiativeKind,
   InitiativeSpan,
   InitiativeStatus,
} from './model/initiatives';
export { autoCalls, AUTO_LOGIN, IDLE_DAYS, LEAD_DAYS } from './model/autoCalls';
export type { AutoCall, AutoPull } from './model/autoCalls';
export { labeledBy, slugName } from './model/projectLabel';
export type { MachineLabelRun } from './model/projectLabel';
export { loadByWeek, mondaysBetween, peakFrom, spansFrom } from './model/load';
export type { InFlightSpan, LoadWeek, OriginCounts } from './model/load';
export { timeSpent } from './model/retro';
export type { TimeRow, Touch } from './model/retro';

export {
   afterEndOf,
   bodyLinks,
   issueCounts,
   issueKey,
   issueQuery,
   issueText,
   itemState,
   parseIssueRef,
   planOfWork,
   planWork,
   projectCounts,
   projectWork,
   RECENT_DAYS,
   SUGGEST_DAYS,
   TAIL_DAYS,
} from './model/work';
export type {
   AttachedIssue,
   IssueCounts,
   IssueHit,
   IssuePull,
   IssueQuery,
   IssueRef,
   ItemState,
   PlanWork,
   ProjectIssue,
   ProjectWork,
   SuggestedIssue,
   WorkInputs,
   WorkPull,
} from './model/work';
