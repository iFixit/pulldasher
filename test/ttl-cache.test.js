import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedValue } from '../lib/ttl-cache.js';

// lets the computations asked for start
const started = () => new Promise(setImmediate);

test('sharedValue computes once for everyone asking at once, keeps it, and forgets on request', async () => {
   let computed = 0;
   const releases = [];
   const value = sharedValue(60 * 1000, () => {
      const n = ++computed;
      return new Promise(resolve => releases.push(() => resolve(n)));
   });
   const asked = [value.get(), value.get(), value.get()];
   await started();
   assert.equal(computed, 1);
   releases.shift()();
   assert.deepEqual(await Promise.all(asked), [1, 1, 1]);
   assert.equal(await value.get(), 1);
   assert.equal(computed, 1);
   // a write lands while it's being read again: that read isn't kept
   value.forget();
   const during = value.get();
   value.forget();
   const after = value.get();
   await started();
   releases.shift()();
   releases.shift()();
   assert.equal(await during, 2);
   assert.equal(await after, 3);
   assert.equal(await value.get(), 3);
   assert.equal(computed, 3);
});

test('sharedValue reads again once its time is up, and after a failure', async () => {
   let computed = 0;
   const value = sharedValue(0, async () => {
      computed++;
      if (computed === 2) throw new Error('the database blinked');
      return computed;
   });
   assert.equal(await value.get(), 1);
   await assert.rejects(value.get(), /blinked/);
   assert.equal(await value.get(), 3);
});
