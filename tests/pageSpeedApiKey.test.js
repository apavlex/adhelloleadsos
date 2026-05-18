const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('resolvePageSpeedApiKey', () => {
  let prevMaps;
  let prevPs;
  let prevGp;

  beforeEach(() => {
    prevMaps = process.env.GOOGLE_MAPS_API_KEY;
    prevPs = process.env.PAGESPEED_API_KEY;
    prevGp = process.env.GOOGLE_PAGESPEED_API_KEY;
  });

  afterEach(() => {
    if (prevMaps === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = prevMaps;
    if (prevPs === undefined) delete process.env.PAGESPEED_API_KEY;
    else process.env.PAGESPEED_API_KEY = prevPs;
    if (prevGp === undefined) delete process.env.GOOGLE_PAGESPEED_API_KEY;
    else process.env.GOOGLE_PAGESPEED_API_KEY = prevGp;
    delete require.cache[require.resolve('../services/pageSpeedInsights')];
  });

  it('prefers workspace PAGESPEED_API_KEY then env fallbacks', () => {
    process.env.PAGESPEED_API_KEY = 'env-ps';
    process.env.GOOGLE_MAPS_API_KEY = 'env-maps';
    const { resolvePageSpeedApiKey } = require('../services/pageSpeedInsights');
    assert.equal(resolvePageSpeedApiKey({ PAGESPEED_API_KEY: 'ws-key' }), 'ws-key');
    assert.equal(resolvePageSpeedApiKey({}), 'env-ps');
    delete process.env.PAGESPEED_API_KEY;
    assert.equal(resolvePageSpeedApiKey({}), 'env-maps');
  });
});
