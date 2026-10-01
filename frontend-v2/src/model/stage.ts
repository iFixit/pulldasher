import { ago, pullKey } from '../../../shared/format';
import { prStage, type PrStage } from '../../../shared/model/stage';
import { CR_INCOMPLETE, type DerivedPull } from '../../../shared/model/status';
import type { IssuePull, IssueRef, ProjectIssue, ProjectWork } from '../../../shared/model/work';
import type { PullData } from '../../../shared/types';
import { parked, STALE_CLAIM_SECS } from './actions';
import { claimFor, requestedReviewers } from './reviewers';

export { prStage, type PrStage };

/**
 * Where work stands, in a product manager's words rather than the board's
 * CR and QA ones. An open PR is ready to merge, on hold, waiting on review,
 * or being worked on. An open issue is as far along as its least finished
 * open PR; with none open, either its PRs merged and the issue is still
 * open, or no PR does it yet. Closing an issue is a person's call, so a
 * closed one is done or dropped whatever its PRs say.
 */

export type IssueStage = PrStage | 'merged' | 'none' | 'done' | 'dropped';

export const STAGE_WORDS: Record<IssueStage, string> = {
   ready: 'Ready to merge',
   hold: 'On hold',
   review: 'Waiting on review',
   work: 'Being worked on',
   merged: 'PRs merged, issue still open',
   none: 'No PR yet',
   done: 'Done',
   dropped: 'Dropped',
};

/** The order a project's page lists them: nearest to shipping first, then
 * the work not started, then the closed. */
export const STAGE_ORDER: readonly IssueStage[] = [
   'ready',
   'hold',
   'review',
   'work',
   'merged',
   'none',
   'done',
   'dropped',
];

// an issue is as far along as its least finished open PR
const LEAST_FINISHED: readonly PrStage[] = ['work', 'review', 'hold', 'ready'];

/** An issue's stage, and the open PR that sets it (the least finished). */
export interface IssueStanding {
   stage: IssueStage;
   /** null when no open PR the board can read sets it */
   pull: DerivedPull | null;
}

export function issueStanding(
   issue: Pick<ProjectIssue, 'state' | 'prs'>,
   live: (ref: IssueRef) => DerivedPull | undefined
): IssueStanding {
   if (issue.state !== 'open') return { stage: issue.state, pull: null };
   let least: IssueStanding | null = null;
   for (const pr of issue.prs) {
      const p = live(pr);
      if (!p && pr.state !== 'open') continue;
      // an open PR the board can't read is still being worked on, as far as anyone knows
      const stage = p ? prStage(p) : 'work';
      const rank = LEAST_FINISHED.indexOf(stage);
      if (!least || rank < LEAST_FINISHED.indexOf(least.stage as PrStage)) {
         least = { stage, pull: p ?? null };
      }
   }
   if (least) return least;
   return { stage: issue.prs.some(pr => pr.state === 'merged') ? 'merged' : 'none', pull: null };
}

/**
 * Who holds an open PR right now, in a few words: its author while it's
 * being worked on or ready to merge, whose turn it is to review, or what
 * holds it. Says how long it's been open once that's past `ageWarnDays`,
 * the board's own age warning.
 */
export function holderWords(
   p: DerivedPull,
   opts: { turns?: ReadonlyMap<string, string>; ageWarnDays?: number } = {}
): string {
   const stage = prStage(p);
   let who: string;
   if (stage === 'hold') {
      if (parked(p)) who = 'parked';
      else if (p.externalBlock) who = 'blocked outside the repo';
      else
         who = p.deployBlockedBy.length
            ? `deploy hold by ${p.deployBlockedBy.join(', ')}`
            : 'deploy hold';
   } else if (stage === 'review') {
      who = reviewWaits(p, opts.turns?.get(pullKey(p.data)) ?? null);
   } else {
      who = `with ${p.data.user.login}`;
   }
   const days = Math.floor(p.ageDays);
   return opts.ageWarnDays != null && days >= opts.ageWarnDays
      ? `${who}, PR open ${days} days`
      : who;
}

/**
 * Who a PR waiting on review waits on, in the order the board's own notes
 * weigh it (actions.ts reviewerNote): someone testing it now, the people
 * asked to look again, the ones a review was asked of, someone looking,
 * whose turn it is; only then nobody yet.
 */
function reviewWaits(p: DerivedPull, turn: string | null): string {
   const list = (logins: string[]) => logins.join(', ');
   if (p.status === 'needs_qa') {
      if (p.qaingLogin) return `${p.qaingLogin} is testing it`;
      if (p.reqaBy.length) return `waiting on ${list(p.reqaBy)} to test again`;
   }
   // the rest of code review's; once it's met, a leftover request for changes
   // or a claim holds nobody up, as on the board
   if (CR_INCOMPLETE.includes(p.status)) {
      if (p.status === 'needs_recr' && p.recrBy.length) {
         return `waiting on ${list(p.recrBy)} to look again`;
      }
      // changes were asked for and the author has pushed since
      if (p.changesRequestedBy.length) {
         return `waiting on ${list(p.changesRequestedBy)} to look again`;
      }
      // someone took it to review, in the row's words
      const claim = claimFor(p.data);
      if (claim) {
         return claim.at != null && Date.now() / 1000 - claim.at > STALE_CLAIM_SECS
            ? `${claim.login} claimed it ${ago(claim.at)} ago`
            : `${claim.login} is reading it`;
      }
   }
   const asked = requestedReviewers(p);
   if (asked.length) return `waiting on ${list(asked)}`;
   if (p.engagedNoStamp.length) return `${list(p.engagedNoStamp)} looking`;
   if (turn) return `${turn}’s turn`;
   return p.status === 'needs_qa' ? 'needs a tester' : 'needs a reviewer';
}

/** How many of a list of PRs are at each stage, and the ones merged. */
export function stageCounts(
   prs: readonly IssuePull[],
   live: (ref: IssueRef) => DerivedPull | undefined
): Record<PrStage, DerivedPull[]> {
   const out: Record<PrStage, DerivedPull[]> = { ready: [], hold: [], review: [], work: [] };
   for (const pr of prs) {
      const p = live(pr);
      if (p) out[prStage(p)].push(p);
   }
   return out;
}

/**
 * A project's page with each PR's state as the board knows it now. The page
 * is read once, when it opens; the board hears each merge and close as it
 * happens, so a PR that merged since then reads as merged, not open.
 */
export function withBoardStates(
   page: ProjectWork,
   live: (ref: IssueRef) => DerivedPull | undefined,
   known: (ref: IssueRef) => PullData | undefined
): ProjectWork {
   const now = (pr: IssuePull): IssuePull => {
      const gone = live(pr) ? undefined : known(pr);
      const state = live(pr) ? 'open' : gone ? (gone.merged_at ? 'merged' : 'closed') : pr.state;
      return state === pr.state ? pr : { ...pr, state };
   };
   return {
      ...page,
      issues: page.issues.map(issue => ({ ...issue, prs: issue.prs.map(now) })),
      unlinked: page.unlinked.map(now),
   };
}
