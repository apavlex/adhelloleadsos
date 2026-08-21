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
    delete require.cache[require.resolve('../services/signalwire')];
    delete require.cache[require.resolve('../services/phoneLineType')];
  });

  afterEach(() => {
    process.env = { ...origEnv };
    delete require.cache[require.resolve('../services/signalwire')];
    delete require.cache[require.resolve('../services/phoneLineType')];
  });

  it('normalizes carrier line types', () => {
    const phoneLineType = require('../services/phoneLineType');
    assert.equal(phoneLineType.normalizeLineType('mobile'), 'mobile');
    assert.equal(phoneLineType.normalizeLineType('landline'), 'landline');
    assert.equal(phoneLineType.normalizeLineType('voip'), 'voip');
    assert.equal(phoneLineType.normalizeLineType('wireless'), 'mobile');
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

  it('lookupPhoneLineType parses SignalWire carrier response', async () => {
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

  it('lookupBlockedReason mentions SignalWire when not configured', () => {
    const phoneLineType = require('../services/phoneLineType');
    const reason = phoneLineType.lookupBlockedReason();
    if (!require('../services/signalwire').configured()) {
      assert.match(String(reason || ''), /SignalWire|Phone bank|Integrations/i);
    }
  });
});
