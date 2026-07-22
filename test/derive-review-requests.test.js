import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveReviewRequests } from '../lib/git-manager.js';

// Minimal stand-in for a github issues.listEvents entry. `requested_reviewer`
// is the shape used for an individual reviewer (a team request has
// `requested_team` instead, and is filtered out -- not exercised here since
// Pulldasher doesn't track per-team requests).
function requestedEvent({ at, actor, reviewer }) {
   return {
      event: 'review_requested',
      created_at: at,
      actor: { login: actor },
      requested_reviewer: { login: reviewer },
   };
}

function removedEvent({ at, actor, reviewer }) {
   return {
      event: 'review_request_removed',
      created_at: at,
      actor: { login: actor },
      requested_reviewer: { login: reviewer },
   };
}

test('a request followed by its removal nets to nothing', () => {
   const events = [
      requestedEvent({ at: '2024-01-01T00:00:00Z', actor: 'alice', reviewer: 'bob' }),
      removedEvent({ at: '2024-01-01T01:00:00Z', actor: 'alice', reviewer: 'bob' }),
   ];

   const result = deriveReviewRequests(events, [], 'pulldasher-bot');

   assert.deepEqual(result, []);
});

test('a request followed by its removal nets to nothing even when requested_reviewers still lists it stale', () => {
   // requestedReviewerLogins is authoritative for WHO -- if the payload still
   // (incorrectly) lists bob, the removed event doesn't erase him from the
   // output, it just leaves him with no matching event.
   const events = [
      requestedEvent({ at: '2024-01-01T00:00:00Z', actor: 'alice', reviewer: 'bob' }),
      removedEvent({ at: '2024-01-01T01:00:00Z', actor: 'alice', reviewer: 'bob' }),
   ];

   const result = deriveReviewRequests(events, ['bob'], 'pulldasher-bot');

   assert.deepEqual(result, [{ login: 'bob', at: null, self: false }]);
});

test('self is true for a GitHub-UI self-request (actor === reviewer)', () => {
   const events = [
      requestedEvent({ at: '2024-01-01T00:00:00Z', actor: 'carol', reviewer: 'carol' }),
   ];

   const result = deriveReviewRequests(events, ['carol'], 'pulldasher-bot');

   assert.deepEqual(result, [
      { login: 'carol', at: Math.floor(Date.parse('2024-01-01T00:00:00Z') / 1000), self: true },
   ]);
});

test("self is true for a pulldasher (bot-token) claim on someone else's behalf", () => {
   const events = [
      requestedEvent({ at: '2024-01-01T00:00:00Z', actor: 'pulldasher-bot', reviewer: 'dave' }),
   ];

   const result = deriveReviewRequests(events, ['dave'], 'pulldasher-bot');

   assert.deepEqual(result, [
      { login: 'dave', at: Math.floor(Date.parse('2024-01-01T00:00:00Z') / 1000), self: true },
   ]);
});

test('self is false when a third party (e.g. the PR author) requests someone else', () => {
   const events = [
      requestedEvent({ at: '2024-01-01T00:00:00Z', actor: 'author', reviewer: 'erin' }),
   ];

   const result = deriveReviewRequests(events, ['erin'], 'pulldasher-bot');

   assert.deepEqual(result, [
      { login: 'erin', at: Math.floor(Date.parse('2024-01-01T00:00:00Z') / 1000), self: false },
   ]);
});

test('a reviewer in requested_reviewers with no matching event gets at: null, self: false', () => {
   const result = deriveReviewRequests([], ['frank'], 'pulldasher-bot');

   assert.deepEqual(result, [{ login: 'frank', at: null, self: false }]);
});

test('a null botLogin (lookup never resolved) just means the bot case never matches', () => {
   const events = [
      requestedEvent({ at: '2024-01-01T00:00:00Z', actor: 'pulldasher-bot', reviewer: 'gina' }),
   ];

   const result = deriveReviewRequests(events, ['gina'], null);

   assert.deepEqual(result, [
      { login: 'gina', at: Math.floor(Date.parse('2024-01-01T00:00:00Z') / 1000), self: false },
   ]);
});

test('out-of-order events are still netted correctly (sorted by created_at first)', () => {
   const events = [
      removedEvent({ at: '2024-01-02T00:00:00Z', actor: 'alice', reviewer: 'holly' }),
      requestedEvent({ at: '2024-01-01T00:00:00Z', actor: 'alice', reviewer: 'holly' }),
   ];

   const result = deriveReviewRequests(events, [], 'pulldasher-bot');

   assert.deepEqual(result, []);
});

test('multiple reviewers are derived independently, preserving requestedReviewerLogins order', () => {
   const events = [
      requestedEvent({ at: '2024-01-01T00:00:00Z', actor: 'ivy', reviewer: 'ivy' }),
      requestedEvent({ at: '2024-01-01T01:00:00Z', actor: 'author', reviewer: 'jack' }),
   ];

   const result = deriveReviewRequests(events, ['jack', 'ivy', 'kim'], 'pulldasher-bot');

   assert.deepEqual(result, [
      { login: 'jack', at: Math.floor(Date.parse('2024-01-01T01:00:00Z') / 1000), self: false },
      { login: 'ivy', at: Math.floor(Date.parse('2024-01-01T00:00:00Z') / 1000), self: true },
      { login: 'kim', at: null, self: false },
   ]);
});
