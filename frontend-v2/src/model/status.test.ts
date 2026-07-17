import { describe, expect, it } from 'vitest';
import type { PullData, Signature, SignatureType } from '../types';
import { ciVerdict, derive, reviewWeight } from './status';

const NOW = 1_800_000_000;

function sig(
   type: SignatureType,
   login: string,
   active: boolean,
   at = '2026-01-01T00:00:00Z'
): Signature {
   return {
      data: {
         repo: 'iFixit/ifixit',
         number: 1,
         user: { id: 1, login },
         type,
         created_at: at,
         active: active ? 1 : 0,
         comment_id: 1,
      },
   };
}

function pull(overrides: Partial<PullData> = {}): PullData {
   return {
      repo: 'iFixit/ifixit',
      number: 1,
      state: 'open',
      title: 'Test pull',
      body: '',
      draft: false,
      created_at: new Date((NOW - 86400) * 1000).toISOString(),
      updated_at: new Date((NOW - 86400) * 1000).toISOString(),
      closed_at: null,
      merged_at: null,
      mergeable: true,
      difficulty: null,
      additions: 10,
      deletions: 5,
      changed_files: 2,
      milestone: { title: null, due_on: null },
      head: { ref: 'branch', sha: 'abc', repo: { owner: { login: 'iFixit' } } },
      base: { ref: 'master' },
      user: { login: 'author' },
      cr_req: 1,
      qa_req: 1,
      status: {
         cr_req: 1,
         qa_req: 1,
         allCR: [],
         allQA: [],
         dev_block: [],
         deploy_block: [],
         commit_statuses: [],
      },
      labels: [],
      participants: [],
      ...overrides,
   };
}

function withStatus(
   overrides: Partial<PullData['status']>,
   base: Partial<PullData> = {}
): PullData {
   const p = pull(base);
   return { ...p, status: { ...p.status, ...overrides } };
}

describe('status derivation precedence', () => {
   it('draft wins over everything', () => {
      const p = withStatus({ dev_block: [sig('dev_block', 'x', true)] }, { draft: true });
      expect(derive(p, undefined, NOW).status).toBe('draft');
   });

   it('blocked wins over ci_red', () => {
      const p = withStatus({
         deploy_block: [sig('deploy_block', 'x', true)],
         commit_statuses: [ci('failure')],
      });
      expect(derive(p, undefined, NOW).status).toBe('blocked');
   });

   it('failing CI beats the review lanes', () => {
      const p = withStatus({ commit_statuses: [ci('failure')] });
      expect(derive(p, undefined, NOW).status).toBe('ci_red');
   });

   it('an invalidated CR makes needs_recr, and names who owes the re-stamp', () => {
      const p = withStatus({ allCR: [sig('CR', 'reviewer', false)] });
      const d = derive(p, undefined, NOW);
      expect(d.status).toBe('needs_recr');
      expect(d.recrBy).toEqual(['reviewer']);
   });

   it('a re-stamp by the same user returns the pull to the normal flow', () => {
      const p = withStatus({
         allCR: [sig('CR', 'reviewer', false), sig('CR', 'reviewer', true)],
      });
      const d = derive(p, undefined, NOW);
      expect(d.status).toBe('needs_qa');
      expect(d.recrBy).toEqual([]);
   });

   it("the author's own stale stamp never creates a re-stamp lane entry", () => {
      const p = withStatus({ allCR: [sig('CR', 'author', false)] });
      expect(derive(p, undefined, NOW).status).toBe('needs_cr');
   });

   it('CR done, QA missing → needs_qa; both → ready', () => {
      const crOnly = withStatus({ allCR: [sig('CR', 'r', true)] });
      expect(derive(crOnly, undefined, NOW).status).toBe('needs_qa');
      const both = withStatus({
         allCR: [sig('CR', 'r', true)],
         allQA: [sig('QA', 'q', true)],
      });
      expect(derive(both, undefined, NOW).status).toBe('ready');
   });

   it('honors cr_req > 1', () => {
      const p = withStatus({
         cr_req: 2,
         allCR: [sig('CR', 'r', true)],
      });
      expect(derive(p, undefined, NOW).status).toBe('needs_cr');
   });

   it('pending CI never hides a pull from review, but gates ready', () => {
      const needsCr = withStatus({ commit_statuses: [ci('pending')] });
      expect(derive(needsCr, undefined, NOW).status).toBe('needs_cr');

      const signedOff = withStatus({
         allCR: [sig('CR', 'r', true)],
         allQA: [sig('QA', 'q', true)],
         commit_statuses: [ci('pending')],
      });
      expect(derive(signedOff, undefined, NOW).status).toBe('ci_pending');
   });

   it('conflicts and a dependent base flag everywhere and block ready', () => {
      const conflicted = withStatus(
         { allCR: [sig('CR', 'r', true)], allQA: [sig('QA', 'q', true)] },
         { mergeable: false }
      );
      const d = derive(conflicted, undefined, NOW);
      expect(d.conflict).toBe(true);
      expect(d.status).toBe('blocked');

      const dependent = withStatus(
         { allCR: [sig('CR', 'r', true)], allQA: [sig('QA', 'q', true)] },
         { base: { ref: 'parent-feature' } }
      );
      const dd = derive(dependent, undefined, NOW);
      expect(dd.dependent).toBe(true);
      expect(dd.status).toBe('blocked');

      // still reviewable while CR is missing: conflict is a flag, not a gate
      const needsCr = pull({ mergeable: false });
      expect(derive(needsCr, undefined, NOW).status).toBe('needs_cr');
   });

   it('reads the v1 label conventions', () => {
      const labeled = pull({
         labels: [
            {
               title: 'QAing',
               number: 1,
               repo: 'iFixit/ifixit',
               user: 'tester',
               created_at: '2026-01-01T00:00:00Z',
            },
            {
               title: 'Cryogenic Storage',
               number: 1,
               repo: 'iFixit/ifixit',
               user: 'x',
               created_at: '2026-01-01T00:00:00Z',
            },
         ],
      });
      const d = derive(labeled, undefined, NOW);
      expect(d.qaingBy).toBe('tester');
      expect(d.cryo).toBe(true);
      expect(d.externalBlock).toBe(false);
   });

   it('names everyone holding a block', () => {
      const p = withStatus({
         dev_block: [sig('dev_block', 'holder', true)],
         deploy_block: [sig('deploy_block', 'ops', true)],
      });
      expect(derive(p, undefined, NOW).blockedBy).toEqual(['holder', 'ops']);
   });

   it('a lifted (inactive) block no longer blocks', () => {
      const p = withStatus({ dev_block: [sig('dev_block', 'holder', false)] });
      const d = derive(p, undefined, NOW);
      expect(d.status).toBe('needs_cr');
      expect(d.blockedBy).toEqual([]);
   });

   it('unknown mergeability is flagged, not asserted', () => {
      const p = withStatus(
         { allCR: [sig('CR', 'r', true)], allQA: [sig('QA', 'q', true)] },
         { mergeable: null }
      );
      const d = derive(p, undefined, NOW);
      expect(d.mergeUnknown).toBe(true);
      expect(d.conflict).toBe(false);
      expect(d.status).toBe('ready');
   });
});

function ci(state: 'success' | 'failure' | 'pending' | 'error', context = 'build', sha = 'abc') {
   return {
      data: {
         sha,
         target_url: null,
         description: '',
         state,
         context,
         started_at: NOW - 3600,
         completed_at: null,
      },
   } as const;
}

describe('ciVerdict', () => {
   it('no statuses, nothing required → none', () => {
      expect(ciVerdict(pull())).toBe('none');
   });

   it("ignored statuses don't fail the build", () => {
      const p = withStatus({
         commit_statuses: [ci('success'), ci('failure', 'stress-test')],
      });
      expect(ciVerdict(p, { name: 'iFixit/ifixit', ignoredStatuses: ['stress-test'] })).toBe(
         'success'
      );
      expect(ciVerdict(p, { name: 'iFixit/ifixit' })).toBe('failing');
   });

   it("a configured-required status that hasn't reported is pending", () => {
      const p = withStatus({ commit_statuses: [ci('success', 'build')] });
      expect(
         ciVerdict(p, {
            name: 'iFixit/ifixit',
            requiredStatuses: ['build', 'tests'],
         })
      ).toBe('pending');
   });

   it('only statuses on the current head count when any exist', () => {
      const p = withStatus({
         commit_statuses: [ci('failure', 'build', 'old-sha'), ci('success')],
      });
      expect(ciVerdict(p, { name: 'iFixit/ifixit' })).toBe('success');
   });
});

describe('starvation and weight', () => {
   it('an old un-CRed pull is starved; a reviewed one never is', () => {
      const old = new Date((NOW - 10 * 86400) * 1000).toISOString();
      const p = pull({ created_at: old });
      const d = derive(p, undefined, NOW);
      expect(d.starved).toBe(true);
      expect(d.starveScore).toBeGreaterThan(0);

      const reviewed = withStatus({ allCR: [sig('CR', 'r', false)] }, { created_at: old });
      expect(derive(reviewed, undefined, NOW).starved).toBe(false);
   });

   it('weight scales with size and sprawl', () => {
      expect(reviewWeight(pull({ additions: 5, deletions: 0 }))).toBe('XS');
      expect(reviewWeight(pull({ additions: 400, deletions: 100 }))).toBe('M');
      expect(reviewWeight(pull({ additions: 400, deletions: 100, changed_files: 40 }))).toBe('L');
      expect(reviewWeight(pull({ additions: 5000, deletions: 0 }))).toBe('XL');
   });
});
