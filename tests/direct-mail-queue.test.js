const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  DIRECT_MAIL_FOLDER_NAME,
  DIRECT_MAIL_TAG_NAME,
} = require('../services/directMailQueue');

describe('directMailQueue', () => {
  it('uses stable folder and tag names', () => {
    assert.equal(DIRECT_MAIL_FOLDER_NAME, 'Direct Mail');
    assert.equal(DIRECT_MAIL_TAG_NAME, 'Direct Mail List');
  });
});
