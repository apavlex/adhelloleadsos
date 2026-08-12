const test = require('node:test');
const assert = require('node:assert/strict');
const { wantsJsonResponse } = require('../lib/httpRequest');

function mockReq(overrides) {
  const headers = overrides.headers || {};
  return {
    path: overrides.path || '/',
    xhr: overrides.xhr || false,
    get(name) {
      return headers[name.toLowerCase()] || headers[name] || '';
    },
  };
}

test('wantsJsonResponse for Drive API paths', () => {
  assert.equal(
    wantsJsonResponse(mockReq({ path: '/leads/google-drive/access-token' })),
    true
  );
  assert.equal(wantsJsonResponse(mockReq({ path: '/leads/drive-import/google' })), true);
});

test('wantsJsonResponse when Accept is application/json', () => {
  assert.equal(
    wantsJsonResponse(mockReq({ path: '/foo', headers: { accept: 'application/json' } })),
    true
  );
});

test('wantsJsonResponse for lead JSON API paths', () => {
  assert.equal(wantsJsonResponse(mockReq({ path: '/leads/search.json' })), true);
  assert.equal(wantsJsonResponse(mockReq({ path: '/leads/list.json' })), true);
});

test('wantsJsonResponse false for normal page navigation', () => {
  assert.equal(wantsJsonResponse(mockReq({ path: '/prospecting' })), false);
});
