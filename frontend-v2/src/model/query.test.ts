import { describe, expect, it } from 'vitest';
import type { DerivedPull, Weight } from '../../../shared/model/status';
import { matchesQuery } from './query';

function fake(
   over: Partial<{
      title: string;
      repo: string;
      author: string;
      number: number;
      labels: string[];
      status: DerivedPull['status'];
      ageDays: number;
      weight: Weight;
      recrBy: string[];
      reqaBy: string[];
   }>
): DerivedPull {
   return {
      status: over.status ?? 'needs_cr',
      ageDays: over.ageDays ?? 0,
      ci: 'success',
      ciFailing: [],
      crBy: [],
      qaBy: [],
      crHave: 0,
      qaHave: 0,
      recrBy: over.recrBy ?? [],
      reqaBy: over.reqaBy ?? [],
      headPushedAt: null,
      signedOffAt: null,
      starved: false,
      starveScore: 0,
      weight: over.weight ?? 'M',
      conflict: false,
      mergeUnknown: false,
      dependent: false,
      sizeKnown: true,
      devBlockedBy: [],
      deployBlockedBy: [],
      qaingLogin: null,
      externalBlock: false,
      cryo: false,
      changesRequestedBy: [],
      engagedNoStamp: [],
      data: {
         title: over.title ?? 'Fix the store dropdown',
         repo: over.repo ?? 'acme/widgets',
         number: over.number ?? 12345,
         user: { login: over.author ?? 'alice' },
         labels: (over.labels ?? []).map(title => ({ title })),
         status: { cr_req: 1, qa_req: 1, unstamped_reviewers: [] },
      },
   } as unknown as DerivedPull;
}

describe('matchesQuery', () => {
   it('matches PR numbers, bare or #-prefixed', () => {
      expect(matchesQuery(fake({ number: 63495 }), '63495', 'viewer')).toBe(true);
      expect(matchesQuery(fake({ number: 63495 }), '#63495', 'viewer')).toBe(true);
      expect(matchesQuery(fake({ number: 111 }), '63495', 'viewer')).toBe(false);
   });

   it('bare terms AND across title, repo, author, labels', () => {
      const p = fake({ title: 'Store dropdown', author: 'alice', labels: ['QAE'] });
      expect(matchesQuery(p, 'store alice', 'viewer')).toBe(true);
      expect(matchesQuery(p, 'qae', 'viewer')).toBe(true);
      expect(matchesQuery(p, 'store bob', 'viewer')).toBe(false);
   });

   it('label:, status:, older:, repo:, author: tokens narrow one field', () => {
      const p = fake({ labels: ['QAE'], status: 'needs_recr', ageDays: 9, author: 'alice' });
      expect(matchesQuery(p, 'label:qae', 'viewer')).toBe(true);
      expect(matchesQuery(p, 'label:frontend', 'viewer')).toBe(false);
      expect(matchesQuery(p, 'status:needs-recr', 'viewer')).toBe(true);
      expect(matchesQuery(p, 'status:ready', 'viewer')).toBe(false);
      expect(matchesQuery(p, 'older:7', 'viewer')).toBe(true);
      expect(matchesQuery(p, 'older:7d', 'viewer')).toBe(true);
      expect(matchesQuery(p, 'older:30', 'viewer')).toBe(false);
      expect(matchesQuery(p, 'author:ali', 'viewer')).toBe(true);
      expect(matchesQuery(p, 'repo:widgets', 'viewer')).toBe(true);
   });

   it('an unknown key falls back to plain substring', () => {
      expect(matchesQuery(fake({ title: 'weird:token in title' }), 'weird:token', 'viewer')).toBe(
         true
      );
   });

   it('weight: matches a single class, a comma list (OR), case-insensitively', () => {
      const xs = fake({ weight: 'XS' });
      const s = fake({ weight: 'S' });
      const m = fake({ weight: 'M' });
      expect(matchesQuery(xs, 'weight:xs', 'viewer')).toBe(true);
      expect(matchesQuery(xs, 'weight:XS', 'viewer')).toBe(true);
      expect(matchesQuery(xs, 'weight:s', 'viewer')).toBe(false);
      expect(matchesQuery(xs, 'weight:xs,s', 'viewer')).toBe(true);
      expect(matchesQuery(s, 'weight:xs,s', 'viewer')).toBe(true);
      expect(matchesQuery(m, 'weight:xs,s', 'viewer')).toBe(false);
   });

   it('has:action matches when the viewer has an imperative move', () => {
      // author of a ready PR: the author's move is "Merge it"
      const ready = fake({ author: 'alice', status: 'ready' });
      expect(matchesQuery(ready, 'has:action', 'alice')).toBe(true);
      // author of a fresh needs_cr PR with no reviewers yet: pure wait, no action
      const waiting = fake({ author: 'alice', status: 'needs_cr' });
      expect(matchesQuery(waiting, 'has:action', 'alice')).toBe(false);
   });

   it('is:restamp matches a viewer owed in recrBy or reqaBy', () => {
      const p = fake({ recrBy: ['bob'], reqaBy: ['carol'] });
      expect(matchesQuery(p, 'is:restamp', 'bob')).toBe(true);
      expect(matchesQuery(p, 'is:restamp', 'carol')).toBe(true);
      expect(matchesQuery(p, 'is:restamp', 'dave')).toBe(false);
   });

   it('is:restamp asks nothing while the author owns the pull', () => {
      // same gate as reviewerMove: a draft / dev-blocked / red-CI pull owes
      // no re-stamp until the author's move lands
      expect(matchesQuery(fake({ status: 'ci_red', recrBy: ['bob'] }), 'is:restamp', 'bob')).toBe(
         false
      );
      expect(matchesQuery(fake({ status: 'draft', reqaBy: ['bob'] }), 'is:restamp', 'bob')).toBe(
         false
      );
      // parked pulls ask nothing of anyone
      expect(
         matchesQuery({ ...fake({ recrBy: ['bob'] }), cryo: true } as never, 'is:restamp', 'bob')
      ).toBe(false);
   });

   it('is:blocked matches dev_block and deploy_block statuses only', () => {
      expect(matchesQuery(fake({ status: 'dev_block' }), 'is:blocked', 'viewer')).toBe(true);
      expect(matchesQuery(fake({ status: 'deploy_block' }), 'is:blocked', 'viewer')).toBe(true);
      expect(matchesQuery(fake({ status: 'ready' }), 'is:blocked', 'viewer')).toBe(false);
   });

   it('unknown has:/is: values match nothing', () => {
      expect(matchesQuery(fake({}), 'has:bogus', 'viewer')).toBe(false);
      expect(matchesQuery(fake({}), 'is:bogus', 'viewer')).toBe(false);
   });

   it('composes with AND semantics: weight:xs is:blocked', () => {
      const match = fake({ weight: 'XS', status: 'dev_block' });
      const wrongWeight = fake({ weight: 'M', status: 'dev_block' });
      const wrongStatus = fake({ weight: 'XS', status: 'ready' });
      expect(matchesQuery(match, 'weight:xs is:blocked', 'viewer')).toBe(true);
      expect(matchesQuery(wrongWeight, 'weight:xs is:blocked', 'viewer')).toBe(false);
      expect(matchesQuery(wrongStatus, 'weight:xs is:blocked', 'viewer')).toBe(false);
   });
});
