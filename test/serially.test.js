import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serially } from '../lib/initiatives.js';

test('writes run one at a time, in order', async () => {
   const seen = [];
   const slow = () => new Promise(resolve => setTimeout(() => resolve(seen.push('a')), 20));
   await Promise.all([serially(slow), serially(async () => seen.push('b'))]);
   assert.deepEqual(seen, ['a', 'b']);
});

test('a failed write fails only its own request', async () => {
   await assert.rejects(
      serially(async () => {
         throw new Error('no');
      }),
      /no/
   );
   assert.equal(await serially(async () => 'next'), 'next');
});

test('a hung write fails after the limit and the next one still runs', async () => {
   const hung = serially(() => new Promise(() => {}), 30);
   const next = serially(async () => 'next', 30);
   await assert.rejects(hung, /timed out/);
   assert.equal(await next, 'next');
});
