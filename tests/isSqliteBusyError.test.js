const test = require('node:test');
const assert = require('node:assert/strict');
const { isSqliteBusyError } = require('../lib/isSqliteBusyError');

test('isSqliteBusyError matches real SQLITE_BUSY / locked database only', () => {
  assert.equal(isSqliteBusyError({ code: 'SQLITE_BUSY', message: 'database is locked' }), true);
  assert.equal(isSqliteBusyError({ code: 'SQLITE_LOCKED', message: 'database table is locked' }), true);
  assert.equal(isSqliteBusyError(new Error('SQLITE_BUSY: database is locked')), true);
  assert.equal(isSqliteBusyError({ code: 'ENOTLOCKED', message: 'not locked' }), false);
  assert.equal(isSqliteBusyError({ message: 'Something blocked the request' }), false);
  assert.equal(isSqliteBusyError({ message: 'user account locked out' }), false);
  assert.equal(isSqliteBusyError({ message: 'busy_timeout pragma set' }), false);
  assert.equal(isSqliteBusyError(null), false);
});
