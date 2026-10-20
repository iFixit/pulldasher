import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import db, { retryIfIdleClosed } from '../lib/db.js';

const idleClosed = Object.assign(new Error('disconnected by the server'), { errno: 4031 });

test('a query on a connection MySQL closed for idling runs once more', async () => {
   let calls = 0;
   const rows = await retryIfIdleClosed(async () => {
      calls++;
      if (calls === 1) throw idleClosed;
      return 'rows';
   });
   assert.equal(rows, 'rows');
   assert.equal(calls, 2);
});

test('any other error is not retried', async () => {
   let calls = 0;
   const lost = Object.assign(new Error('lost'), { code: 'PROTOCOL_CONNECTION_LOST' });
   await assert.rejects(
      retryIfIdleClosed(async () => {
         calls++;
         throw lost;
      }),
      lost
   );
   assert.equal(calls, 1);
});

test('it retries only once', async () => {
   let calls = 0;
   await assert.rejects(
      retryIfIdleClosed(async () => {
         calls++;
         throw idleClosed;
      }),
      idleClosed
   );
   assert.equal(calls, 2);
});

test('queries are sent without a timeout, so a long migration can finish', async () => {
   mock.method(db.pool, 'query', async (sql, params) => [{ sql, params }]);
   const sent = await db.query('SELECT ?', [1]);
   mock.restoreAll();
   assert.deepEqual(sent, { sql: 'SELECT ?', params: [1] });
});
