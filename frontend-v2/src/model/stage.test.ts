import { describe, expect, it } from 'vitest';
import type { DerivedPull, Status } from '../../../shared/model/status';
import type { IssuePull, ProjectWork } from '../../../shared/model/work';
import type { PullData } from '../../../shared/types';
import { holderWords, issueStanding, prStage, withBoardStates } from './stage';

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
