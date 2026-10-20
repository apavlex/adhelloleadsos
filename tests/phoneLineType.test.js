const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('phoneLineType', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env.SIGNALWIRE_SPACE_URL = 'https://test-space.signalwire.com';
    process.env.SIGNALWIRE_PROJECT_ID = 'proj_test';
    process.env.SIGNALWIRE_TOKEN = 'token_test';
    process.env.SIGNALWIRE_FROM_NUMBER = '+15551234567';
    process.env.SIGNALWIRE_ENABLED = '1';
    process.env.PHONE_LINE_TYPE_LOOKUP_ENABLED = '1';
    process.env.PHONE_LINE_TYPE_PROVIDER = 'outscraper';
    delete process.env.OUTSCRAPER_API_KEY;
    delete require.cache[require.resolve('../services/signalwire')];
    delete require.cache[require.resolve('../services/outscraperClient')];
    delete require.cache[require.resolve('../services/phoneLineType')];
  });

  afterEach(() => {
    process.env = { ...origEnv };
    delete require.cache[require.resolve('../services/signalwire')];
    delete require.cache[require.resolve('../services/outscraperClient')];
    delete require.cache[require.resolve('../services/phoneLineType')];
  });

  it('normalizes carrier line types', () => {
    const phoneLineType = require('../services/phoneLineType');
    assert.equal(phoneLineType.normalizeLineType('mobile'), 'mobile');
    assert.equal(phoneLineType.normalizeLineType('landline'), 'landline');
    assert.equal(phoneLineType.normalizeLineType('voip'), 'voip');
    assert.equal(phoneLineType.normalizeLineType('wireless'), 'mobile');
    assert.equal(phoneLineType.normalizeLineType('cellphone'), 'mobile');
    assert.equal(phoneLineType.normalizeLineType(''), 'unknown');
  });

  it('needsRefresh when phone changes or cache is stale', () => {
    const phoneLineType = require('../services/phoneLineType');
    const lead = {
      phone: '+15551234567',
      phoneLineType: 'mobile',
      phoneLineTypeCheckedAt: new Date().toISOString(),
      phoneLineTypePhoneNorm: '5551234567',
    };
    assert.equal(phoneLineType.needsRefresh(lead, null), false);
    assert.equal(
      phoneLineType.needsRefresh({ ...lead, phone: '+15559876543' }, lead),
      true,
    );
    const stale = {
      ...lead,
      phoneLineTypeCheckedAt: new Date(Date.now() - 40 * 86400000).toISOString(),
    };
    assert.equal(phoneLineType.needsRefresh(stale, null), true);
  });

  it('blocks SMS for landline numbers', () => {
    const phoneLineType = require('../services/phoneLineType');
    assert.equal(phoneLineType.isSmsAllowed({ phoneLineType: 'landline' }), false);
    assert.equal(phoneLineType.isSmsAllowed({ phoneLineType: 'mobile' }), true);
    assert.equal(phoneLineType.isSmsAllowed({ phoneLineType: 'voip' }), true);
    assert.equal(phoneLineType.isSmsAllowed({ phoneLineType: 'unknown' }), true);
  });

  it('prefers call-first for landline and unknown', () => {
    const phoneLineType = require('../services/phoneLineType');
    assert.equal(phoneLineType.prefersCallFirst({ phoneLineType: 'landline' }), true);
    assert.equal(phoneLineType.prefersCallFirst({ phoneLineType: 'unknown' }), true);
    assert.equal(phoneLineType.prefersCallFirst({ phoneLineType: 'mobile' }), false);
  });

  it('tagNamesForLineType maps mobile to SMS safe + Cellphone', () => {
    const phoneLineType = require('../services/phoneLineType');
    assert.deepEqual(phoneLineType.tagNamesForLineType('mobile'), [
      phoneLineType.TAG_SMS_SAFE,
      phoneLineType.TAG_CELLPHONE,
    ]);
    assert.deepEqual(phoneLineType.tagNamesForLineType('landline'), [phoneLineType.TAG_LANDLINE]);
    assert.deepEqual(phoneLineType.tagNamesForLineType('voip'), [phoneLineType.TAG_VOIP]);
    assert.deepEqual(phoneLineType.tagNamesForLineType('unknown'), []);
  });

  it('lookupPhoneLineType parses SignalWire carrier response when Outscraper is off', async () => {
    const phoneLineType = require('../services/phoneLineType');
    const mockFetch = async (url) => {
      assert.match(url, /lookup\/phone_number\/%2B15551234567/);
      assert.match(url, /include=carrier/);
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            carrier: { name: 'Verizon Wireless', type: 'mobile' },
          }),
      };
    };
    const result = await phoneLineType.lookupPhoneLineType('+1 (555) 123-4567', {
      fetch: mockFetch,
    });
    assert.equal(result.lineType, 'mobile');
    assert.equal(result.carrier, 'Verizon Wireless');
    assert.equal(result.source, 'signalwire');
  });

  it('prefers Outscraper phones-enricher when configured', async () => {
    process.env.OUTSCRAPER_API_KEY = 'test_outscraper_key';
    delete require.cache[require.resolve('../services/outscraperClient')];
    delete require.cache[require.resolve('../services/phoneLineType')];
    const outscraper = require('../services/outscraperClient');
    const phoneLineType = require('../services/phoneLineType');
    const orig = outscraper.fetchPhonesEnricher;
    outscraper.fetchPhonesEnricher = async () => ({
      query: '15551234567',
      carrierName: 'T-Mobile',
      carrierType: 'mobile',
    });
    try {
      const result = await phoneLineType.lookupPhoneLineType('+15551234567', {
        integrationEnv: { OUTSCRAPER_API_KEY: 'test_outscraper_key' },
        fetch: async () => {
          throw new Error('SignalWire should not be called');
        },
      });
      assert.equal(result.lineType, 'mobile');
      assert.equal(result.carrier, 'T-Mobile');
      assert.equal(result.source, 'outscraper');
    } finally {
      outscraper.fetchPhonesEnricher = orig;
    }
  });

  it('falls back to SignalWire when Outscraper fails', async () => {
    process.env.OUTSCRAPER_API_KEY = 'test_outscraper_key';
    delete require.cache[require.resolve('../services/outscraperClient')];
    delete require.cache[require.resolve('../services/phoneLineType')];
    const outscraper = require('../services/outscraperClient');
    const phoneLineType = require('../services/phoneLineType');
    const orig = outscraper.fetchPhonesEnricher;
    outscraper.fetchPhonesEnricher = async () => {
      throw new Error('Outscraper down');
    };
    try {
      const result = await phoneLineType.lookupPhoneLineType('+15551234567', {
        integrationEnv: { OUTSCRAPER_API_KEY: 'test_outscraper_key' },
        fetch: async () => ({
          ok: true,
          text: async () =>
            JSON.stringify({
              carrier: { name: 'AT&T', type: 'landline' },
            }),
        }),
      });
      assert.equal(result.lineType, 'landline');
      assert.equal(result.carrier, 'AT&T');
      assert.equal(result.source, 'signalwire');
    } finally {
      outscraper.fetchPhonesEnricher = orig;
    }
  });

  it('refreshIfNeeded skips when cache is still valid', async () => {
    const phoneLineType = require('../services/phoneLineType');
    const lead = {
      phone: '+15551234567',
      phoneLineType: 'mobile',
      phoneLineTypeCheckedAt: new Date().toISOString(),
      phoneLineTypePhoneNorm: '5551234567',
    };
    const patch = await phoneLineType.refreshIfNeeded(lead, null, {
      fetch: async () => {
        throw new Error('should not fetch');
      },
    });
    assert.equal(patch, null);
  });

  it('refreshIfNeeded returns unknown patch when lookup fails', async () => {
    const phoneLineType = require('../services/phoneLineType');
    const lead = { phone: '+15551234567' };
    const patch = await phoneLineType.refreshIfNeeded(lead, null, {
      fetch: async () => ({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ message: 'lookup failed' }),
      }),
    });
    assert.equal(patch.phoneLineType, 'unknown');
    assert.equal(patch.phoneLineTypePhoneNorm, '5551234567');
    assert.ok(patch.phoneLineTypeCheckedAt);
  });

  it('badgeForLead returns label and carrier title', () => {
    const phoneLineType = require('../services/phoneLineType');
    const badge = phoneLineType.badgeForLead({
      phone: '+15551234567',
      phoneLineType: 'landline',
      phoneCarrier: 'AT&T',
    });
    assert.equal(badge.label, 'Landline');
    assert.equal(badge.title, 'Landline · AT&T');
  });

  it('forceRefresh looks up even when cache is fresh', async () => {
    const phoneLineType = require('../services/phoneLineType');
    const lead = {
      phone: '+15551234567',
      phoneLineType: 'landline',
      phoneLineTypeCheckedAt: new Date().toISOString(),
      phoneLineTypePhoneNorm: '5551234567',
    };
    const patch = await phoneLineType.forceRefresh(lead, {
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            carrier: { type: 'mobile', name: 'Verizon' },
          }),
      }),
    });
    assert.ok(patch);
    assert.equal(patch.phoneLineType, 'mobile');
    assert.equal(patch.phoneCarrier, 'Verizon');
  });

  it('lookupBlockedReason is null when SignalWire is configured', () => {
    const phoneLineType = require('../services/phoneLineType');
    assert.equal(phoneLineType.lookupBlockedReason(null), null);
  });

  it('lookupBlockedReason mentions Outscraper or SignalWire when neither configured', () => {
    delete process.env.SIGNALWIRE_PROJECT_ID;
    delete process.env.SIGNALWIRE_TOKEN;
    delete process.env.SIGNALWIRE_SPACE_URL;
    delete process.env.OUTSCRAPER_API_KEY;
    delete require.cache[require.resolve('../services/signalwire')];
    delete require.cache[require.resolve('../services/outscraperClient')];
    delete require.cache[require.resolve('../services/phoneLineType')];
    const phoneLineType = require('../services/phoneLineType');
    const reason = phoneLineType.lookupBlockedReason(null);
    assert.match(String(reason || ''), /Outscraper|SignalWire/i);
  });

  it('flattenPhonesEnricherPayload reads flat Outscraper rows', () => {
    const outscraper = require('../services/outscraperClient');
    const row = outscraper.flattenPhonesEnricherPayload([
      { query: '12812368208', carrier_name: 'AERIAL', carrier_type: 'mobile' },
    ]);
    assert.equal(row.carrier_type, 'mobile');
    assert.equal(row.carrier_name, 'AERIAL');
  });
});
