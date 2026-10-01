import { ago, n, pullKey } from '../../../shared/format';
import type { ClosedIssue } from '../../../shared/model/decide';
import { dayStart } from '../../../shared/model/projects';
import type { RoadmapItem } from '../../../shared/model/roadmap';
import { prStage, type PrStage } from '../../../shared/model/stage';
import { CR_INCOMPLETE, type DerivedPull } from '../../../shared/model/status';
import {
   afterEndOf,
   planOfWork,
   type AttachedIssue,
   type IssuePull,
   type IssueRef,
   type ProjectIssue,
   type ProjectWork,
} from '../../../shared/model/work';
import type { PullData } from '../../../shared/types';
import { parked, STALE_CLAIM_SECS } from './actions';
import { dayOf } from './days';
import { claimFor, requestedReviewers } from './reviewers';
import { days } from './words';

export { prStage, type PrStage };

/**
 * Where work stands, in a product manager's words rather than the board's
 * CR and QA ones. An open PR is ready to merge, on hold, waiting on review,
 * or in development. An open issue is as far along as its least finished
 * open PR; with none open, either its PRs merged and the issue is still
 * open, or no PR does it yet. Closing an issue is a person's call, so a
 * closed one is done or dropped whatever its PRs say.
 */

export type IssueStage = PrStage | 'merged' | 'none' | 'done' | 'dropped';

export const STAGE_WORDS: Record<IssueStage, string> = {
   ready: 'Ready to merge',
   hold: 'On hold',
   review: 'Waiting on review',
   // not "being worked on": the tab says that of a project whose PRs moved
   // lately (words.ts BEING_WORKED_ON), which a PR waiting on review is too
   work: 'In development',
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
 * in development or ready to merge, whose turn it is to review, or what
 * holds it. Says how long it's been open once that's past `ageWarnDays`,
 * the board's own age warning. With `line`, the words start a line: they
 * take a capital, unless they start with a login, which is never changed.
 * With `onRow`, the words sit under the PR's own row, so they leave out
 * what the row already shows: its author (the face), an outside block (its
 * "external" flag) and its age (the rail); with nothing left, they're
 * empty.
 */
export function holderWords(
   p: DerivedPull,
   opts: {
      turns?: ReadonlyMap<string, string>;
      ageWarnDays?: number;
      line?: boolean;
      onRow?: boolean;
   } = {}
): string {
   // the board's own words, which a line's start capitalizes
   const own = (words: string) => (opts.line ? words[0].toUpperCase() + words.slice(1) : words);
   const stage = prStage(p);
   let who: string;
   if (stage === 'hold') {
      if (parked(p)) who = own('parked');
      else if (p.externalBlock) who = opts.onRow ? '' : own('blocked outside the repo');
      else
         who = own(
            p.deployBlockedBy.length
               ? `deploy hold by ${p.deployBlockedBy.join(', ')}`
               : 'deploy hold'
         );
   } else if (stage === 'review') {
      who = reviewWaits(p, opts.turns?.get(pullKey(p.data)) ?? null, own);
   } else {
      who = opts.onRow ? '' : own(`with ${p.data.user.login}`);
   }
   const age = Math.floor(p.ageDays);
   return !opts.onRow && opts.ageWarnDays != null && age >= opts.ageWarnDays
      ? `${who}, PR open ${days(age)}`
      : who;
}

/**
 * Who a PR waiting on review waits on, in the order the board's own notes
 * weigh it (actions.ts reviewerNote): someone testing it now, the people
 * asked to look again, the ones a review was asked of, someone looking,
 * whose turn it is; only then nobody yet. `own` marks the board's words,
 * as against a login.
 */
function reviewWaits(p: DerivedPull, turn: string | null, own: (words: string) => string): string {
   const list = (logins: string[]) => logins.join(', ');
   if (p.status === 'needs_qa') {
      if (p.qaingLogin) return `${p.qaingLogin} is testing it`;
      if (p.reqaBy.length) return own(`waiting on ${list(p.reqaBy)} to test again`);
   }
   // the rest of code review's; once it's met, a leftover request for changes
   // or a claim holds nobody up, as on the board
   if (CR_INCOMPLETE.includes(p.status)) {
      if (p.status === 'needs_recr' && p.recrBy.length) {
         return own(`waiting on ${list(p.recrBy)} to look again`);
      }
      // changes were asked for and the author has pushed since
      if (p.changesRequestedBy.length) {
         return own(`waiting on ${list(p.changesRequestedBy)} to look again`);
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
   if (asked.length) return own(`waiting on ${list(asked)}`);
   if (p.engagedNoStamp.length) return `${list(p.engagedNoStamp)} looking`;
   if (turn) return `${turn}’s turn`;
   return own(p.status === 'needs_qa' ? 'needs a tester' : 'needs a reviewer');
}

const DAY = 86400;

/**
 * Why a PR stands out against its project's plan, in words for its line:
 * it opened after the plan was marked done or dropped (or, with no plan
 * that says so, after the project's issue was closed), or after the plan's
 * last planned week. Null when neither, or when its opening isn't known.
 */
export function lateWords(
   createdAt: number | null,
   plans: readonly RoadmapItem[],
   closed: ClosedIssue | null = null
): string | null {
   if (createdAt == null) return null;
   const plan = planOfWork(plans, createdAt);
   // when it was called finished: its plan's say first, then its issue's
   const mark =
      plan && (plan.status === 'done' || plan.status === 'dropped')
         ? { as: plan.status, at: plan.status_at ?? plan.updated_at }
         : closed;
   if (mark?.at && createdAt > mark.at) {
      return mark.as === 'done' ? 'opened after it was marked done' : 'opened after it was dropped';
   }
   return plan && createdAt >= afterEndOf(plan) ? 'opened after the plan ended' : null;
}

/** When a plan took effect: its first day, or when it was put on the
 * roadmap if that came later (an update is owed counting from the same
 * moment). Issues attached after it were added along the way. */
export function plannedAt(plan: Pick<RoadmapItem, 'start' | 'created_at'>): number {
   return Math.max(dayStart(plan.start) ?? 0, plan.created_at ?? 0);
}

/** An issue attached after its project's plan took effect, as opposed to
 * the work planned; false with no plan to tell by. */
export const addedLater = (issue: Pick<AttachedIssue, 'attachedAt'>, planned: number | null) =>
   planned != null && issue.attachedAt != null && issue.attachedAt > planned;

/** how many trailing days set the pace an issue forecast runs on */
const PACE_DAYS = 28;

/**
 * The day a time fell on here, the way the tab says a day: "Sep 21", with
 * its year when that isn't this one ("Mar 3, 2024"). One unbreakable
 * phrase, so a narrow line never leaves "Sep" at its end and "21" on the
 * next.
 */
export function dateWords(at: number, now: number = Date.now() / 1000): string {
   const date = new Date(at * 1000);
   const thisYear = date.getFullYear() === new Date(now * 1000).getFullYear();
   return date
      .toLocaleDateString(undefined, {
         month: 'short',
         day: 'numeric',
         year: thisYear ? undefined : 'numeric',
      })
      .replace(/ /g, '\u00a0');
}

/** A median time in the words a person says it: hours under a day ("about
 * 7 hours"), whole days from there ("6 days"), never "0.3 days". */
export function durationWords(d: number): string {
   const hours = Math.round(d * 24);
   if (hours < 1) return 'under an hour';
   if (hours === 1) return 'about an hour';
   return hours < 24 ? `about ${n(hours, 'hour')}` : days(Math.round(d));
}

/**
 * A rough finish for a project's issues: how many closed (done or
 * dropped) and how many were added over the last four weeks set a pace,
 * and the open ones at that pace give a day, or the words that there's no
 * end in sight. With none closed there's no pace to compare, so it only
 * counts. `due` (YYYY-MM-DD) adds "after the target" to a day past it.
 * `how` says how it's worked out. Null when no issue is open.
 */
export function issueForecast(
   issues: readonly Pick<ProjectIssue, 'state' | 'closedAt' | 'attachedAt'>[],
   due: string | null,
   now: number = Date.now() / 1000
): { text: string; how: string } | null {
   const open = issues.filter(i => i.state === 'open').length;
   if (!open) return null;
   const since = now - PACE_DAYS * DAY;
   const closed = issues.filter(i => i.state !== 'open' && (i.closedAt ?? 0) >= since).length;
   const added = issues.filter(i => (i.attachedAt ?? 0) >= since).length;
   const how = `In the last four weeks ${closed} of its issues closed (done or dropped) and ${added} were added; ${open} are open. A rough guide: it assumes that pace holds.`;
   if (!closed && !added) return { text: 'no issue closed or added in four weeks', how };
   const tally = `${closed || 'none'} closed, ${added || 'none'} added in four weeks`;
   // a young project's issues all arrived lately: "faster than they close"
   // would say it's losing ground before anything had a chance to close
   if (!closed) return { text: tally, how };
   if (closed <= added) {
      const pace = closed === added ? 'as fast as' : 'faster than';
      return { text: `${tally}: issues arrive ${pace} they close`, how };
   }
   const weeks = Math.ceil((open * PACE_DAYS) / 7 / (closed - added));
   const eta = now + weeks * 7 * DAY;
   // the milestone's day as GitHub means it, the same day the target shows
   const late = due != null && dayOf(new Date(eta * 1000)) > due.slice(0, 10);
   return {
      text: `${tally}: done around ${dateWords(eta, now)}${late ? ', after the target' : ''}`,
      how,
   };
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
