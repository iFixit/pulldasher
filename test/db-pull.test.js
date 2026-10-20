import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import db from '../lib/db.js';
import DBPull from '../models/db_pull.js';

const pull = draft => ({
   data: {
      repo: 'o/r',
      number: 1,
      state: 'open',
      title: 't',
      body: '',
      draft,
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-28T10:00:00Z',
      milestone: {},
      head: { ref: 'f', sha: 'abc' },
      base: { ref: 'master' },
      user: { login: 'dana' },
   },
});

test('saving a pull stamps ready_at as it leaves draft, before draft takes the new flag', async t => {
   const sent = [];
   t.mock.method(db, 'query', async (sql, params) => sent.push({ sql, params }));
   await new DBPull(pull(false)).save();
   const [{ sql, params }] = sent;
   // a fresh row has none: ready_at isn't in what's inserted
   assert.equal('ready_at' in params[0], false);
   // on an update it's assigned first, so `draft` still reads the stored flag:
   // a stored draft saved as ready takes its update time, one saved as a
   // draft clears it, and otherwise it keeps what it had
   const update = sql.split('ON DUPLICATE KEY UPDATE ')[1];
   assert.equal(
      update,
      '`ready_at` = IF(? = 1, NULL, IF(`draft` = 1, COALESCE(?, UNIX_TIMESTAMP()), `ready_at`)), ?'
   );
   assert.deepEqual(params.slice(1, 3), [0, Date.parse('2026-09-28T10:00:00Z') / 1000]);
   mock.restoreAll();
});
