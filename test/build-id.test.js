import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildIdOf } from '../lib/build-id.js';

test('buildIdOf changes with the built page and is undefined without one', () => {
   const file = join(mkdtempSync(join(tmpdir(), 'build-')), 'index.html');
   assert.equal(buildIdOf(file), undefined);
   writeFileSync(file, '<script src="/assets/a1.js">');
   const first = buildIdOf(file);
   assert.match(first, /^[0-9a-f]{12}$/);
   assert.equal(buildIdOf(file), first);
   writeFileSync(file, '<script src="/assets/b2.js">');
   assert.notEqual(buildIdOf(file), first);
});
