import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { useBodyParsers } from '../lib/body-parsers.js';

// a JSON body just past the general 1 MB limit, the size of a big webhook
const big = JSON.stringify({ action: 'edited', body: 'x'.repeat(2 * 1024 * 1024) });

async function withServer(t) {
   const app = express();
   useBodyParsers(app);
   app.post('/hooks/main', (req, res) => res.json({ got: req.body.body.length }));
   app.post('/roadmap', (req, res) => res.json({ got: req.body.body.length }));
   const server = await new Promise(resolve => {
      const s = app.listen(0, () => resolve(s));
   });
   t.after(() => server.close());
   return `http://127.0.0.1:${server.address().port}`;
}

const post = (url, body, type) =>
   fetch(url, { method: 'POST', headers: { 'content-type': type }, body });

test('a webhook past 1 MB is parsed', async t => {
   const base = await withServer(t);
   const res = await post(`${base}/hooks/main`, big, 'application/json');
   assert.equal(res.status, 200);
   assert.equal((await res.json()).got, 2 * 1024 * 1024);
});

test('a form-encoded webhook past 1 MB is parsed', async t => {
   const base = await withServer(t);
   const form = new URLSearchParams({ body: 'x'.repeat(2 * 1024 * 1024) }).toString();
   const res = await post(`${base}/hooks/main`, form, 'application/x-www-form-urlencoded');
   assert.equal(res.status, 200);
});

test('other routes keep the 1 MB limit', async t => {
   const base = await withServer(t);
   const res = await post(`${base}/roadmap`, big, 'application/json');
   assert.equal(res.status, 413);
});
