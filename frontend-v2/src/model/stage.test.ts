import { describe, expect, it } from 'vitest';
import type { RoadmapItem } from '../../../shared/model/roadmap';
import type { DerivedPull, Status } from '../../../shared/model/status';
import type { IssuePull, ProjectWork } from '../../../shared/model/work';
import type { PullData } from '../../../shared/types';
import {
   addedLater,
   dateWords,
   durationWords,
   holderWords,
   issueForecast,
   issueStanding,
   lateWords,
   plannedAt,
   prStage,
   withBoardStates,
} from './stage';

/** A DerivedPull with only the fields the stage rules read. */
function dp(
   number: number,
   status: Status,
   o: Partial<{
      author: string;
      conflict: boolean;
      changesRequestedAt: number | null;
      headPushedAt: number | null;
      deployBlockedBy: string[];
      externalBlock: boolean;
      cryo: boolean;
      ageDays: number;
      qaingLogin: string | null;
      recrBy: string[];
      /** someone took it to review, at this epoch second */
      claim: { login: string; at: number | null };
   }> = {}
): DerivedPull {
   const asked = o.changesRequestedAt != null;
   return {
      data: {
         repo: 'iFixit/ifixit',
         number,
         user: { login: o.author ?? 'dana' },
         // a claim is a review request the reviewer made of themselves
         requested_reviewers: o.claim ? [o.claim.login] : [],
         review_requests: o.claim ? [{ ...o.claim, self: true }] : [],
         status: {
            unstamped_reviewers: asked
               ? [{ login: 'erin', state: 'CHANGES_REQUESTED', date: o.changesRequestedAt }]
               : [],
         },
      },
      status,
      conflict: o.conflict ?? false,
      changesRequestedBy: asked ? ['erin'] : [],
      headPushedAt: o.headPushedAt ?? null,
      deployBlockedBy: o.deployBlockedBy ?? [],
      devBlockedBy: [],
      externalBlock: o.externalBlock ?? false,
      cryo: o.cryo ?? false,
      ageDays: o.ageDays ?? 1,
      ci: 'passing',
      qaingLogin: o.qaingLogin ?? null,
      recrBy: o.recrBy ?? [],
      reqaBy: [],
      engagedNoStamp: [],
   } as unknown as DerivedPull;
}

const pr = (number: number, state: IssuePull['state'] = 'open'): IssuePull => ({
   repo: 'iFixit/ifixit',
   number,
   title: `PR ${number}`,
   author: 'dana',
   createdAt: 0,
   state,
});

describe('prStage', () => {
   it('reads a PR’s state as a product manager would', () => {
      expect(prStage(dp(1, 'deploy_block'))).toBe('hold');
      expect(prStage(dp(1, 'ready', { cryo: true }))).toBe('hold');
      expect(prStage(dp(1, 'needs_cr', { externalBlock: true }))).toBe('hold');
      expect(prStage(dp(1, 'draft'))).toBe('work');
      expect(prStage(dp(1, 'dev_block'))).toBe('work');
      expect(prStage(dp(1, 'ci_red'))).toBe('work');
      expect(prStage(dp(1, 'unmergeable', { conflict: true }))).toBe('work');
      expect(prStage(dp(1, 'needs_cr'))).toBe('review');
      expect(prStage(dp(1, 'needs_recr'))).toBe('review');
      expect(prStage(dp(1, 'needs_qa'))).toBe('review');
      expect(prStage(dp(1, 'ready'))).toBe('ready');
      expect(prStage(dp(1, 'ci_pending'))).toBe('ready');
      // a clean PR waiting on the one it's stacked on
      expect(prStage(dp(1, 'unmergeable'))).toBe('ready');
      // signed off but in conflict, while CI runs: the board says Rebase
      expect(prStage(dp(1, 'ci_pending', { conflict: true }))).toBe('work');
   });

   it('gives a PR back to its author while asked-for changes wait on them', () => {
      expect(prStage(dp(1, 'needs_cr', { changesRequestedAt: 100 }))).toBe('work');
      // pushed since: the reviewer's turn again
      expect(prStage(dp(1, 'needs_cr', { changesRequestedAt: 100, headPushedAt: 200 }))).toBe(
         'review'
      );
      // on a re-review too: a stamp went stale, then changes were asked for
      expect(prStage(dp(1, 'needs_recr', { changesRequestedAt: 100 }))).toBe('work');
      expect(prStage(dp(1, 'needs_recr', { changesRequestedAt: 100, headPushedAt: 200 }))).toBe(
         'review'
      );
   });
});

describe('issueStanding', () => {
   const board = new Map([
      [1, dp(1, 'ready')],
      [2, dp(2, 'needs_cr')],
      [3, dp(3, 'draft')],
      [4, dp(4, 'deploy_block')],
   ]);
   const live = (ref: { number: number }) => board.get(ref.number);

   it('takes the stage of its least finished open PR', () => {
      expect(issueStanding({ state: 'open', prs: [pr(1), pr(2)] }, live).stage).toBe('review');
      expect(issueStanding({ state: 'open', prs: [pr(1), pr(4)] }, live).stage).toBe('hold');
      const mixed = issueStanding({ state: 'open', prs: [pr(1), pr(4), pr(2), pr(3)] }, live);
      expect([mixed.stage, mixed.pull?.data.number]).toEqual(['work', 3]);
      // an open PR the board can't read counts as being worked on
      expect(issueStanding({ state: 'open', prs: [pr(1), pr(9)] }, live)).toEqual({
         stage: 'work',
         pull: null,
      });
   });

   it('says when its PRs merged with the issue still open, or no PR does it yet', () => {
      expect(issueStanding({ state: 'open', prs: [pr(8, 'merged')] }, live).stage).toBe('merged');
      expect(issueStanding({ state: 'open', prs: [pr(8, 'closed')] }, live).stage).toBe('none');
      expect(issueStanding({ state: 'open', prs: [] }, live).stage).toBe('none');
   });

   it('leaves a closed issue done or dropped, whatever its PRs say', () => {
      expect(issueStanding({ state: 'done', prs: [pr(3)] }, live).stage).toBe('done');
      expect(issueStanding({ state: 'dropped', prs: [] }, live).stage).toBe('dropped');
   });
});

describe('holderWords', () => {
   it('names who holds a PR, and how long it’s been open once that’s past the warning', () => {
      expect(holderWords(dp(1, 'draft', { author: 'mlahargou' }))).toBe('with mlahargou');
      expect(holderWords(dp(1, 'ready', { author: 'mlahargou' }))).toBe('with mlahargou');
      const turns = new Map([['iFixit/ifixit#2', 'erin']]);
      expect(holderWords(dp(2, 'needs_cr'), { turns })).toBe('erin’s turn');
      expect(holderWords(dp(3, 'needs_cr'), { turns })).toBe('needs a reviewer');
      expect(holderWords(dp(3, 'needs_qa'))).toBe('needs a tester');
      // a named person holds it before anyone's turn does
      expect(holderWords(dp(3, 'needs_qa', { qaingLogin: 'k0rvus' }), { turns })).toBe(
         'k0rvus is testing it'
      );
      expect(holderWords(dp(2, 'needs_recr', { recrBy: ['djmetzle', 'caphene'] }), { turns })).toBe(
         'waiting on djmetzle, caphene to look again'
      );
      expect(holderWords(dp(4, 'deploy_block', { deployBlockedBy: ['sctice'] }))).toBe(
         'deploy hold by sctice'
      );
      expect(holderWords(dp(5, 'ready', { cryo: true }))).toBe('parked');
      expect(holderWords(dp(1, 'draft', { ageDays: 38.6 }), { ageWarnDays: 14 })).toBe(
         'with dana, PR open 38 days'
      );
      expect(holderWords(dp(1, 'draft', { ageDays: 3 }), { ageWarnDays: 14 })).toBe('with dana');
   });

   it('names who took a PR to review, as its row does', () => {
      const now = Date.now() / 1000;
      const turns = new Map([['iFixit/ifixit#2', 'erin']]);
      expect(
         holderWords(dp(2, 'needs_cr', { claim: { login: 'bob', at: now - 60 } }), { turns })
      ).toBe('bob is reading it');
      expect(holderWords(dp(2, 'needs_cr', { claim: { login: 'bob', at: now - 3 * 3600 } }))).toBe(
         'bob claimed it 3h ago'
      );
   });

   it('drops code review’s holders once code review is met', () => {
      // a change request left over after enough others stamped it
      expect(holderWords(dp(3, 'needs_qa', { changesRequestedAt: 100 }))).toBe('needs a tester');
   });

   it('starts a line with a capital, but never changes a login', () => {
      const turns = new Map([['iFixit/ifixit#2', 'andyg0808']]);
      expect(holderWords(dp(1, 'draft', { author: 'mlahargou' }), { line: true })).toBe(
         'With mlahargou'
      );
      expect(holderWords(dp(3, 'needs_cr'), { line: true })).toBe('Needs a reviewer');
      expect(holderWords(dp(2, 'needs_cr'), { turns, line: true })).toBe('andyg0808’s turn');
      expect(holderWords(dp(3, 'needs_qa', { qaingLogin: 'jrodger312' }), { line: true })).toBe(
         'jrodger312 is testing it'
      );
   });

   it('says nothing its own row shows, under that row', () => {
      const onRow = { onRow: true, ageWarnDays: 14 };
      // the face is the author, the "external" flag says it, the rail its age
      expect(holderWords(dp(1, 'draft', { ageDays: 38 }), onRow)).toBe('');
      expect(holderWords(dp(1, 'needs_cr', { externalBlock: true }), onRow)).toBe('');
      // who it waits on, and what holds it, the row doesn't say
      const turns = new Map([['iFixit/ifixit#2', 'erin']]);
      expect(holderWords(dp(2, 'needs_cr', { ageDays: 38 }), { ...onRow, turns })).toBe(
         'erin’s turn'
      );
      expect(holderWords(dp(5, 'ready', { cryo: true }), onRow)).toBe('parked');
   });
});

const DAY = 86400;
const plan = (o: Partial<RoadmapItem>): RoadmapItem =>
   ({
      id: 1,
      project: 'p',
      status: 'active',
      start: '2026-08-03',
      weeks: 4,
      status_at: null,
      updated_at: null,
      created_at: null,
      ...o,
   } as RoadmapItem);
// noon UTC on a day, as epoch secs
const at = (day: string) => Date.parse(`${day}T12:00:00Z`) / 1000;

describe('lateWords', () => {
   it('says a PR opened after its plan ended', () => {
      const plans = [plan({})];
      // the plan's last day is Aug 30
      expect(lateWords(at('2026-08-30'), plans)).toBeNull();
      expect(lateWords(at('2026-09-02'), plans)).toBe('opened after the plan ended');
      expect(lateWords(null, plans)).toBeNull();
   });

   it('says it opened after the plan was marked done, not after it ended', () => {
      const done = plan({ status: 'done', status_at: at('2026-09-10') });
      expect(lateWords(at('2026-09-05'), [done])).toBe('opened after the plan ended');
      expect(lateWords(at('2026-09-12'), [done])).toBe('opened after it was marked done');
      expect(lateWords(at('2026-09-12'), [{ ...done, status: 'dropped' }])).toBe(
         'opened after it was dropped'
      );
   });

   it('goes by the project’s closed issue when no plan says it’s finished', () => {
      const issue = { as: 'done' as const, at: at('2026-08-20') };
      expect(lateWords(at('2026-08-25'), [], issue)).toBe('opened after it was marked done');
      expect(lateWords(at('2026-08-25'), [plan({ weeks: 8 })], issue)).toBe(
         'opened after it was marked done'
      );
      // a close time nobody knows says nothing
      expect(lateWords(at('2026-08-25'), [], { as: 'done', at: 0 })).toBeNull();
   });
});

describe('addedLater', () => {
   it('counts from the plan’s start, or from when it was made if that’s later', () => {
      const started = plannedAt(plan({}));
      expect(started).toBe(Date.parse('2026-08-03T00:00:00Z') / 1000);
      expect(plannedAt(plan({ created_at: at('2026-08-10') }))).toBe(at('2026-08-10'));
      expect(addedLater({ attachedAt: at('2026-08-01') }, started)).toBe(false);
      expect(addedLater({ attachedAt: at('2026-08-04') }, started)).toBe(true);
      expect(addedLater({ attachedAt: null }, started)).toBe(false);
      expect(addedLater({ attachedAt: at('2026-08-04') }, null)).toBe(false);
   });
});

describe('issueForecast', () => {
   const now = at('2026-10-01');
   const ago = (n: number) => now - n * DAY;
   const open = (attached: number | null = 60) => ({
      state: 'open' as const,
      closedAt: null,
      attachedAt: attached == null ? null : ago(attached),
   });
   const closed = (daysAgo: number) => ({
      state: 'done' as const,
      closedAt: ago(daysAgo),
      attachedAt: ago(60),
   });
   const day = (secs: number) => dateWords(secs, now);

   it('runs the open issues at the last four weeks’ pace, closes less adds', () => {
      // 4 closed, 3 added: one fewer every four weeks, so 2 open take 8 weeks
      const issues = [
         ...[1, 2, 3, 4].map(closed),
         open(),
         open(5),
         open(10),
         // added in the window and already dropped
         { state: 'dropped' as const, closedAt: ago(2), attachedAt: ago(20) },
      ];
      // the dropped one counts as closed too: 5 closed, 3 added, 3 open
      expect(issueForecast(issues, null, now)?.text).toBe(
         `5 closed, 3 added in four weeks: done around ${day(now + 6 * 7 * DAY)}`
      );
      // a close before the four weeks doesn't set the pace
      expect(issueForecast([closed(40), closed(3), open()], null, now)?.text).toBe(
         `1 closed, none added in four weeks: done around ${day(now + 4 * 7 * DAY)}`
      );
   });

   it('says when the target falls before it', () => {
      expect(issueForecast([closed(3), open()], '2026-10-15', now)?.text).toMatch(
         /done around .+, after the target$/
      );
      expect(issueForecast([closed(3), open()], '2026-12-31', now)?.text).not.toMatch(/target/);
   });

   it('gives no day when issues arrive as fast as they close, or nothing moves', () => {
      expect(issueForecast([closed(3), open(3)], null, now)?.text).toBe(
         '1 closed, 1 added in four weeks: issues arrive as fast as they close'
      );
      expect(issueForecast([closed(3), open(3), open(9)], null, now)?.text).toBe(
         '1 closed, 2 added in four weeks: issues arrive faster than they close'
      );
      expect(issueForecast([open(), open(null)], null, now)?.text).toBe(
         'no issue closed or added in four weeks'
      );
      // nothing open: no forecast
      expect(issueForecast([closed(3)], null, now)).toBeNull();
   });

   it('only counts when nothing has closed yet, with no pace to compare', () => {
      // a project whose issues all just arrived isn't losing ground
      expect(issueForecast([open(3), open(9)], null, now)?.text).toBe(
         'none closed, 2 added in four weeks'
      );
   });
});

describe('dateWords', () => {
   const now = at('2026-10-01');

   it('says a day as one phrase, with its year only when it isn’t this one', () => {
      const thisYear = dateWords(at('2026-09-21'), now);
      expect(thisYear).not.toMatch(/2026| /);
      expect(thisYear).toMatch(/21/);
      const before = dateWords(at('2024-03-03'), now);
      expect(before).toMatch(/2024/);
      expect(before).not.toMatch(/ /);
   });
});

describe('durationWords', () => {
   it('says a median the way a person would, never "0.3 days"', () => {
      expect(durationWords(0.01)).toBe('under an hour');
      expect(durationWords(0.04)).toBe('about an hour');
      expect(durationWords(0.3)).toBe('about 7 hours');
      expect(durationWords(6.1)).toBe('6 days');
      expect(durationWords(27.6)).toBe('28 days');
   });
});

describe('withBoardStates', () => {
   const ref = (number: number, state: IssuePull['state']) => ({ ...pr(number, state) });
   const page = {
      issues: [
         { ref: { repo: 'iFixit/ifixit', number: 50 }, prs: [ref(1, 'open'), ref(2, 'open')] },
      ],
      unlinked: [ref(3, 'closed'), ref(4, null)],
   } as unknown as ProjectWork;
   const board = new Map([[3, dp(3, 'needs_cr')]]);
   const gone = new Map([
      [1, { merged_at: '2026-10-01T00:00:00Z' } as PullData],
      [2, { merged_at: null } as unknown as PullData],
   ]);

   it('reads each PR’s state off the board, newer than the page’s', () => {
      const fresh = withBoardStates(
         page,
         r => board.get(r.number),
         r => gone.get(r.number)
      );
      // merged and closed since the page loaded; reopened; and one the board never read
      expect(fresh.issues[0].prs.map(p => p.state)).toEqual(['merged', 'closed']);
      expect(fresh.unlinked.map(p => p.state)).toEqual(['open', null]);
   });
});
