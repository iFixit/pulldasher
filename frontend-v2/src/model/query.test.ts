import { describe, expect, it } from 'vitest';
import type { DerivedPull } from './status';
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
   }>
): DerivedPull {
   return {
      status: over.status ?? 'needs_cr',
      ageDays: over.ageDays ?? 0,
      data: {
         title: over.title ?? 'Fix the store dropdown',
         repo: over.repo ?? 'acme/widgets',
         number: over.number ?? 12345,
         user: { login: over.author ?? 'alice' },
         labels: (over.labels ?? []).map(title => ({ title })),
      },
   } as unknown as DerivedPull;
}

describe('matchesQuery', () => {
   it('matches PR numbers, bare or #-prefixed', () => {
      expect(matchesQuery(fake({ number: 63495 }), '63495')).toBe(true);
      expect(matchesQuery(fake({ number: 63495 }), '#63495')).toBe(true);
      expect(matchesQuery(fake({ number: 111 }), '63495')).toBe(false);
   });

   it('bare terms AND across title, repo, author, labels', () => {
      const p = fake({ title: 'Store dropdown', author: 'alice', labels: ['QAE'] });
      expect(matchesQuery(p, 'store alice')).toBe(true);
      expect(matchesQuery(p, 'qae')).toBe(true);
      expect(matchesQuery(p, 'store bob')).toBe(false);
   });

   it('label:, status:, older:, repo:, author: tokens narrow one field', () => {
      const p = fake({ labels: ['QAE'], status: 'needs_recr', ageDays: 9, author: 'alice' });
      expect(matchesQuery(p, 'label:qae')).toBe(true);
      expect(matchesQuery(p, 'label:frontend')).toBe(false);
      expect(matchesQuery(p, 'status:needs-recr')).toBe(true);
      expect(matchesQuery(p, 'status:ready')).toBe(false);
      expect(matchesQuery(p, 'older:7')).toBe(true);
      expect(matchesQuery(p, 'older:7d')).toBe(true);
      expect(matchesQuery(p, 'older:30')).toBe(false);
      expect(matchesQuery(p, 'author:ali')).toBe(true);
      expect(matchesQuery(p, 'repo:widgets')).toBe(true);
   });

   it('an unknown key falls back to plain substring', () => {
      expect(matchesQuery(fake({ title: 'weird:token in title' }), 'weird:token')).toBe(true);
   });
});
