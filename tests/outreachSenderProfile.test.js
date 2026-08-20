const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveOutreachSenderProfile,
  resolveSenderOfferKey,
  pitchFromOfferBlock,
} = require('../services/outreachSenderProfile');

describe('outreachSenderProfile', () => {
  const ws = {
    brandKit: { businessName: 'Agency Parent LLC' },
    salesScriptOfferCatalog: [
      {
        key: 'flooring',
        label: 'Premier Flooring Co',
        vertical: 'Flooring',
        senderBusinessName: 'Premier Flooring Co',
        auditLink: 'https://flooring.example/audit',
      },
      { key: 'reviews_app', label: 'ReviewBoost', vertical: 'SaaS / Reviews' },
    ],
    salesScriptBlockOverrides: {
      flooring: {
        valueProp: 'We help flooring contractors book more in-home estimates.',
      },
      reviews_app: {
        opening: 'Automate review requests after every job.',
      },
    },
    prospecting: {
      autoPool: { senderOfferKey: 'reviews_app' },
    },
  };

  it('resolveSenderOfferKey prefers lead prospecting stamp', () => {
    const key = resolveSenderOfferKey({
      lead: { prospecting: { senderOfferKey: 'flooring' } },
      folder: { outreachAutomation: { senderOfferKey: 'reviews_app' } },
      workspace: ws,
    });
    assert.equal(key, 'flooring');
  });

  it('resolveSenderOfferKey falls back folder then auto-pool', () => {
    assert.equal(
      resolveSenderOfferKey({
        lead: {},
        folder: { outreachAutomation: { senderOfferKey: 'flooring' } },
        workspace: ws,
      }),
      'flooring',
    );
    assert.equal(
      resolveSenderOfferKey({ lead: {}, folder: {}, workspace: ws }),
      'reviews_app',
    );
  });

  it('resolveOutreachSenderProfile maps catalog + scripts', () => {
    const profile = resolveOutreachSenderProfile(
      ws,
      { prospecting: { senderOfferKey: 'flooring' } },
      null,
    );
    assert.equal(profile.offerKey, 'flooring');
    assert.equal(profile.senderBusinessName, 'Premier Flooring Co');
    assert.equal(profile.vertical, 'Flooring');
    assert.equal(profile.auditLink, 'https://flooring.example/audit');
    assert.match(profile.pitch, /in-home estimates/);
  });

  it('pitchFromOfferBlock prefers valueProp over opening', () => {
    assert.equal(pitchFromOfferBlock({ valueProp: 'A', opening: 'B' }), 'A');
    assert.equal(pitchFromOfferBlock({ opening: 'Hello' }), 'Hello');
  });

  it('resolveOutreachSenderProfile uses first catalog key when none set', () => {
    const bare = {
      salesScriptOfferCatalog: [{ key: 'adhello', label: 'AdHello Consulting', vertical: 'Digital Marketing' }],
      salesScriptBlockOverrides: {},
    };
    const profile = resolveOutreachSenderProfile(bare, {}, null);
    assert.equal(profile.offerKey, 'adhello');
    assert.equal(profile.offerLabel, 'AdHello Consulting');
  });
});

describe('outreachSenderProfile with empty workspace catalog', () => {
  it('returns empty offer when workspace has no catalog', () => {
    const profile = resolveOutreachSenderProfile({ brandKit: { businessName: 'Test Co' } }, {}, null);
    assert.equal(profile.offerKey, '');
    assert.equal(profile.offerLabel, 'Test Co');
  });
});
