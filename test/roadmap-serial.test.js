import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidesGoing } from '../controllers/roadmap.js';

test('a status or project edit runs with initiative closes; others do not', () => {
   assert.equal(decidesGoing({ status: 'active' }), true);
   assert.equal(decidesGoing({ project: 'workbench' }), true);
   assert.equal(decidesGoing({ project: null }), true);
   assert.equal(decidesGoing({ name: 'New name', weeks: 4 }), false);
});
