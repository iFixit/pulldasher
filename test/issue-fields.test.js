import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
   fieldWrites,
   lastActors,
   mutationInput,
   orgFields,
   wantedFields,
} from '../lib/issue-fields.js';

const plan = over => ({ status: 'active', origin: null, start: '2026-09-28', weeks: 6, ...over });
const empty = { start: null, target: null, priority: null };

test('wantedFields dates a plan and ranks it now, next or later, a fire first', () => {
   const today = '2026-09-30';
   assert.deepEqual(wantedFields(plan(), today), {
      start: '2026-09-28',
      target: '2026-11-08',
      priority: 'High',
   });
   assert.equal(
      wantedFields(plan({ status: 'planned', start: '2026-11-02' }), today).priority,
      'Medium'
   );
   assert.equal(
      wantedFields(plan({ status: 'planned', start: '2027-03-01' }), today).priority,
      'Low'
   );
   assert.equal(
      wantedFields(plan({ status: 'planned', start: '2027-03-01', origin: 'fire' }), today)
         .priority,
      'Urgent'
   );
});

test('lastActors keeps who changed each field last, and skips other fields', () => {
   const event = (name, login) => ({ actor: { login }, issueField: { name } });
   assert.deepEqual(
      lastActors([
         event('Target date', 'job-bot'),
         event('Effort', 'alice'),
         event('Target date', 'alice'),
         event('priority', 'job-bot'),
      ]),
      { target: 'alice', priority: 'job-bot' }
   );
   assert.deepEqual(lastActors(undefined), {});
});

test('fieldWrites fills blanks and its own values, and leaves a person’s', () => {
   const wanted = { start: '2026-09-28', target: '2026-11-08', priority: 'High' };
   // nothing set yet: all three
   assert.deepEqual(fieldWrites({ current: empty, wanted, actors: {}, me: 'job-bot' }), {
      writes: ['start', 'target', 'priority'],
      kept: [],
   });
   const current = { start: '2026-09-28', target: '2026-11-20', priority: 'low' };
   const { writes, kept } = fieldWrites({
      current,
      wanted,
      // the job set the priority; alice moved the target
      actors: { start: 'job-bot', target: 'alice', priority: 'Job-Bot' },
      me: 'job-bot',
   });
   assert.deepEqual(writes, ['priority']);
   assert.deepEqual(kept, [{ key: 'target', value: '2026-11-20', by: 'alice' }]);
   // a field a person cleared stays clear; one set with no record isn't touched
   const cleared = fieldWrites({
      current: { ...empty, start: '2026-01-05' },
      wanted,
      actors: { target: 'alice' },
      me: 'job-bot',
   });
   assert.deepEqual(cleared.writes, ['priority']);
   assert.deepEqual(cleared.kept, [
      { key: 'start', value: '2026-01-05', by: null },
      { key: 'target', value: null, by: 'alice' },
   ]);
});

test('mutationInput sends days as dates and the priority as its option', () => {
   const fields = orgFields([
      { id: 'P', name: 'Priority', options: [{ id: 'hi', name: 'High' }] },
      { id: 'S', name: 'Start date' },
      { id: 'E', name: 'Effort', options: [] },
   ]);
   assert.deepEqual(Object.keys(fields), ['start', 'priority']);
   const wanted = { start: '2026-09-28', target: '2026-11-08', priority: 'High' };
   // the org has no Target date field, so it's left out
   assert.deepEqual(mutationInput('I_1', ['start', 'target', 'priority'], wanted, fields), {
      issueId: 'I_1',
      issueFields: [
         { fieldId: 'S', dateValue: '2026-09-28' },
         { fieldId: 'P', singleSelectOptionId: 'hi' },
      ],
   });
   // a priority with no such option is left out, not sent wrong
   assert.deepEqual(
      mutationInput('I_1', ['priority'], { ...wanted, priority: 'Urgent' }, fields).issueFields,
      []
   );
});
