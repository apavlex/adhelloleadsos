const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { assertPreviewUrl, isBlockedHost } = require('../services/websitePreview');

describe('websitePreview', () => {
  it('normalizes http(s) URLs', () => {
    assert.equal(assertPreviewUrl('atileinstallation.com'), 'https://atileinstallation.com/');
    assert.equal(assertPreviewUrl('https://example.com/path'), 'https://example.com/path');
  });

  it('blocks localhost and private hosts', () => {
    assert.equal(assertPreviewUrl('http://localhost/admin'), '');
    assert.equal(assertPreviewUrl('http://127.0.0.1'), '');
    assert.equal(isBlockedHost('192.168.1.1'), true);
    assert.equal(isBlockedHost('example.com'), false);
  });

  it('rejects invalid URLs', () => {
    assert.equal(assertPreviewUrl(''), '');
    assert.equal(assertPreviewUrl('not a url!!!'), '');
  });
});
