/**
 * Document Prefetch must NOT return 204 — that empty body can be reused as
 * the real navigation document (blank page after the nav spinner).
 * Warming is disabled on the client instead (see nav-prefetch.js).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('skipDocumentPrefetch retired', () => {
  it('middleware file is gone and server does not mount it', () => {
    const root = path.join(__dirname, '..');
    assert.equal(fs.existsSync(path.join(root, 'middleware/skipDocumentPrefetch.js')), false);
    const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    assert.doesNotMatch(server, /skipDocumentPrefetch/);
  });
});
