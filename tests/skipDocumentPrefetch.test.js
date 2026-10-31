const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isDocumentPrefetch } = require('../middleware/skipDocumentPrefetch');

function req(headers, extras) {
  const normalized = {};
  Object.keys(headers || {}).forEach((k) => {
    normalized[String(k).toLowerCase()] = headers[k];
  });
  return {
    method: 'GET',
    path: '/today',
    xhr: false,
    get(name) {
      return normalized[String(name || '').toLowerCase()] || '';
    },
    ...(extras || {}),
  };
}

describe('skipDocumentPrefetch', () => {
  it('detects Purpose / Sec-Purpose document prefetch', () => {
    assert.equal(isDocumentPrefetch(req({ purpose: 'prefetch' })), true);
    assert.equal(isDocumentPrefetch(req({ 'sec-purpose': 'prefetch' })), true);
    assert.equal(isDocumentPrefetch(req({ 'Sec-Purpose': 'prefetch' })), true);
  });

  it('allows real navigations and JSON', () => {
    assert.equal(isDocumentPrefetch(req({})), false);
    assert.equal(isDocumentPrefetch(req({ 'sec-fetch-mode': 'navigate' })), false);
    assert.equal(isDocumentPrefetch(req({ purpose: 'prefetch', accept: 'application/json' })), false);
    assert.equal(isDocumentPrefetch(req({ purpose: 'prefetch' }, { path: '/api/status' })), false);
    assert.equal(isDocumentPrefetch(req({ purpose: 'prefetch' }, { path: '/network/member-candidates.json' })), false);
    assert.equal(isDocumentPrefetch(req({ purpose: 'prefetch' }, { method: 'POST' })), false);
  });

  it('is wired early in server.js', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(require('node:path').join(__dirname, '../server.js'), 'utf8');
    assert.match(src, /skipDocumentPrefetch/);
    const demo = src.indexOf("require('./middleware/demoGuest')");
    const skip = src.indexOf("require('./middleware/skipDocumentPrefetch')");
    assert.ok(demo >= 0 && skip > demo, 'prefetch skip should run after demoGuest');
  });
});
