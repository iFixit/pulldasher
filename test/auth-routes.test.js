import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import authManager from '../lib/authentication.js';

// Every board read in app.js must sit behind the sign-in gate that
// setupRoutes registers ahead of it. /initiatives once shipped without it and
// answered anonymous requests with every initiative's name, goal and owner.
test('every GET route app.js adds requires sign-in', () => {
   const gated = new Set();
   const stub = new Proxy({}, { get: (_, method) => path => method === 'get' && gated.add(path) });
   authManager.setupRoutes(stub);
   const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
   // the API checks its bearer token inline (apiAuth) instead
   const reads = [...source.matchAll(/app\.get\('([^']+)',\s*(\w+)/g)]
      .filter(m => m[2] !== 'apiAuth')
      .map(m => m[1]);
   assert.ok(reads.includes('/initiatives'));
   assert.deepEqual(
      reads.filter(path => !gated.has(path)),
      []
   );
});
