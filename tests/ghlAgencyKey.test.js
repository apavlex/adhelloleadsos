const test = require('node:test');
const assert = require('node:assert/strict');
const ghlClient = require('../services/ghlClient');

function stubFetch(handler) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), auth: init.headers.Authorization });
    return handler(url, init);
  };
  return { calls, restore: () => { global.fetch = original; } };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const env = { GHL_API_KEY: 'loc-token', GHL_LOCATION_ID: 'loc1', GHL_AGENCY_API_KEY: 'agency-token' };

test('creating a sub-account uses the agency key; contact calls keep the location key', async () => {
  const fetch = stubFetch(() => jsonResponse(200, { id: 'newLoc' }));
  try {
    await ghlClient.createLocation({ name: 'Copeland & Co. Interiors', companyId: 'co1' }, env);
    await ghlClient.searchLocations({ companyId: 'co1' }, env);
    await ghlClient.getLocation('loc1', env);
  } finally {
    fetch.restore();
  }
  assert.deepEqual(fetch.calls.map((c) => c.auth), ['Bearer agency-token', 'Bearer agency-token', 'Bearer loc-token']);
});

test('a scope rejection on sub-account creation explains how to get an agency key', async () => {
  const fetch = stubFetch(() => jsonResponse(401, { message: 'The token is not authorized for this scope.' }));
  try {
    await assert.rejects(
      () => ghlClient.createLocation({ name: 'X', companyId: 'co1' }, { GHL_API_KEY: 'loc-token', GHL_LOCATION_ID: 'loc1' }),
      /agency-level token[\s\S]*locations\.write[\s\S]*Agency API key/,
    );
  } finally {
    fetch.restore();
  }
  assert.equal(fetch.calls[0].auth, 'Bearer loc-token');
});
