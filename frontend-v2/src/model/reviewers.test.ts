import { describe, expect, it } from 'vitest';
import { hasReviewRequest, requestedReviewers, reviewRequestedFrom } from './reviewers';
import type { DerivedPull } from '../../../shared/model/status';

function pull(author: string, requested: string[] | undefined): DerivedPull {
   return {
      data: { repo: 'org/a', number: 1, user: { login: author }, requested_reviewers: requested },
   } as unknown as DerivedPull;
}

describe('requestedReviewers', () => {
   it('returns the requested logins, dropping the author', () => {
      expect(requestedReviewers(pull('alice', ['bob', 'alice', 'carol']))).toEqual([
         'bob',
         'carol',
      ]);
   });

   it('is empty when the field is absent (older servers)', () => {
      expect(requestedReviewers(pull('alice', undefined))).toEqual([]);
      expect(hasReviewRequest(pull('alice', undefined))).toBe(false);
   });
});

describe('reviewRequestedFrom', () => {
   it('is true only when the viewer is in the request list', () => {
      expect(reviewRequestedFrom(pull('alice', ['bob']), 'bob')).toBe(true);
      expect(reviewRequestedFrom(pull('alice', ['bob']), 'carol')).toBe(false);
   });

   it('never treats the author as requested from themselves', () => {
      expect(reviewRequestedFrom(pull('alice', ['alice']), 'alice')).toBe(false);
   });
});
